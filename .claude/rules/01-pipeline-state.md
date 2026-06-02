# 管线状态持久化（强制）

## 核心理念

九阶段流程不是一次性执行的线性脚本，而是一个**可中断、可恢复**的状态机。主会话崩溃或用户中断后，新的会话应能从断点继续，而不是从头开始。

## 状态文件

```
test_project/<NN-Project>/.pipeline-state.json
```

### Schema

```json
{
  "version": 1,
  "project": "<NN-Project>",
  "currentStage": "<当前阶段名>",
  "updatedAt": "<ISO 时间戳>",
  "stages": {
    "Detect": {
      "status": "pending|running|completed|failed|skipped",
      "at": "<ISO 时间戳>",
      "reason": "<跳过/失败原因>",
      "output": "<阶段产出描述>"
    },
    "Setup": { "..." : "..." },
    "RemoteSetup": { "..." : "..." },
    "Analyze": { "..." : "..." },
    "Plan": {
      "status": "completed",
      "at": "...",
      "output": "plans/00-test-plan.md + 20 模块计划",
      "approvedBy": "user",
      "approvedAt": "<用户确认时间>"
    },
    "Generate": { "..." : "..." },
    "Execute": { "..." : "..." },
    "Report": { "..." : "..." },
    "Publish": { "..." : "..." }
  }
}
```

### 阶段名称映射

| 规则 06 阶段 | state key | 备注 |
|-------------|-----------|------|
| Detect | `Detect` | scan.sh 执行结果 |
| Setup | `Setup` | 环境配置 |
| Remote Setup | `RemoteSetup` | 远程部署 |
| Analyze | `Analyze` | 变更分析 |
| Plan | `Plan` | 测试计划 |
| Generate | `Generate` | 代码生成 |
| Execute | `Execute` | 测试执行 |
| Report | `Report` | 报告生成 |
| Publish | `Publish` | 构建发布 |

## 状态转换规则

### 正常流程

```
pending → running → completed
                  → skipped（附 reason）
```

### 失败处理

```
running → failed（附 reason）
```

**失败后的传播规则：**

| 失败阶段 | 影响 | 处理 |
|---------|------|------|
| Setup | 阻断后续所有阶段 | 主会话向用户报告，等待指示 |
| RemoteSetup | 降级到本地构建或终止 | 询问用户 |
| Plan | 阻断 Generate | 重新规划或调整范围 |
| Generate | 阻断 Execute | 修复后重试 |
| Execute | 进入 Report（含失败数据）| 不阻断，Report 正常生成 |
| Report | 不阻断后续 | 必须生成，即使全部失败 |

### 阶段可见性（与规则 06 一致）

主会话进入或跳过阶段时，**必须同步更新** `.pipeline-state.json` 并输出标记：

```
## Detect — 扫描项目变更          → status: "running" → "completed"
## Setup — 跳过（环境已配置）     → status: "skipped"
```

## 主会话启动流程

1. 读取 `test_project/<NN-Project>/.pipeline-state.json`
2. **文件不存在** → 初始化（所有阶段 pending），从 Detect 开始
3. **文件存在，currentStage 有值** → 检查该阶段状态：
   - `running` → 上次中断，从该阶段重新开始
   - `completed`/`skipped` → 从下一个 pending 阶段继续
   - `failed` → 向用户报告失败原因，等待指示
4. **文件存在，所有阶段 completed** → 上次已完成，询问用户是否开始新一轮

## 状态文件管理

- **创建时机**：首次进入 Detect 阶段时初始化
- **更新时机**：每个阶段开始和结束时
- **清理时机**：用户确认开始新一轮测试时，重置所有阶段为 pending
- **禁止删除**：与 `.last_hash` 同级保护，任何 Agent 禁止删除或清空
- **不提交 git**：已 gitignore（运行时状态，不属于版本库）

## Agent 联动

主会话启动 Agent 时，在 prompt 中传递当前阶段信息：

```
当前管线状态：Execute 阶段已完成，进入 Report 阶段。
管线状态文件：test_project/<NN-Project>/.pipeline-state.json
```

Agent 不读写状态文件，仅主会话负责状态管理。
