# 管线状态持久化（强制）

## 核心理念

九阶段流程不是一次性执行的线性脚本，而是一个**可中断、可恢复**的状态机。主会话崩溃或用户中断后，新的会话应能从断点继续，而不是从头开始。

v2 schema 把状态拆为三段：
- **global** — 项目级一次性阶段（Detect/Setup/RemoteSetup），整个项目只跑一次
- **modules** — 按测试模块分（每个模块独立 Plan/Generate/Execute/Report），互不覆盖
- **publishes** — 发布历史（append-only 数组），与阶段正交，记录每次发布覆盖的模块

这样多模块并行/迭代时，不同模块的进度独立追踪，不再因为切换模块而丢失另一个模块的进度。

## 状态文件

```
test_project/<NN-Project>/.pipeline-state.json
```

### Schema (v2)

```json
{
  "schemaVersion": 2,
  "project": "<NN-Project>",
  "updatedAt": "<ISO 时间戳>",
  "global": {
    "Detect":      { "status": "pending|running|completed|failed|skipped", "at": "...", "reason": "...", "output": "..." },
    "Setup":       { "status": "...", "at": "...", "reason": "...", "output": "..." },
    "RemoteSetup": { "status": "...", "at": "...", "reason": "...", "output": "..." }
  },
  "modules": {
    "<module-name>": {
      "Plan":     { "status": "...", "at": "...", "approvedBy": "user", "approvedAt": "...", "tcRange": "TC-001 ~ TC-018" },
      "Generate": { "status": "...", "at": "...", "tcCount": 23, "mode": "direct-generation|recording" },
      "Execute":  { "status": "...", "at": "...", "lastRunAt": "..." },
      "Report":   { "status": "..." }
    }
  },
  "publishes": [
    {
      "id": 1,
      "version": "v1.0.0",
      "modules": ["role-management"],
      "commit": "f59a24c",
      "archive": "build/artifacts/20260528-170000-f59a24c.tar.gz",
      "releasedAt": "2026-05-28T17:00:00+08:00",
      "releaseUrl": "https://gitee.com/xxx/releases/tag/v1.0.0"
    }
  ]
}
```

### 阶段名称映射

| 作用域 | 阶段 | 备注 |
|--------|------|------|
| global | `Detect` | scan.sh 执行结果 |
| global | `Setup` | 项目环境配置 |
| global | `RemoteSetup` | 远程部署 |
| modules | `Plan` | 模块测试计划 |
| modules | `Generate` | 测试代码生成 |
| modules | `Execute` | 测试执行 |
| modules | `Report` | 报告生成 |
| (独立) | `publishes` | 不是阶段，是发布历史数组 |

## 模块名约定（强制）

**模块名是 `modules` 对象的 key**，来源是 `plans/NN-{name}.md` 文件去掉 `NN-` 序号：

- `01-role-management.md` → key 为 `role-management`
- `02-user-management.md` → key 为 `user-management`

**plans 目录是模块名的唯一真源**。不要在状态文件、reports、summary 中独立维护模块列表。

## progress.txt 与 pipeline-state 的边界（强制）

**职责分离，避免双源**：

| 数据 | 持有方 | 说明 |
|------|--------|------|
| TC 级用例进度（PASS/FAIL/SKIP） | `results/{module}/progress.txt` | 用例级 |
| 模块在管线中的位置 | `modules.<name>.Plan/Generate/Execute/Report.status` | 流程级 |
| 模块最近一次执行时间 | `modules.<name>.Execute.lastRunAt` | 流程级辅助信息 |
| 发布历史 | `publishes[]` | 流程级，独立维度 |

**禁止**在 pipeline-state 中存：
- 具体 TC 编号（如 `currentTc: "TC-005"`）— 那是 progress.txt 的职责
- 用例 PASS/FAIL 计数 — 那是 progress.txt 解析的产物
- 重试次数 — healer 内部状态，不持久化到文件

## publishes 段（强制）

**不是阶段** — 是发布历史记录，与 Detect/Setup/Plan/Generate/Execute/Report 正交。

### 字段约定

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 自增 | append 时自动生成 |
| `version` | 用户输入 | SemVer 字符串（如 `v1.0.0`） |
| `modules` | 当前已完成的模块列表 | 此次发布覆盖的测试模块 |
| `commit` | `repository/<NN-Project>` HEAD 的短 hash（`git rev-parse --short HEAD`） | publisher 获取 |
| `archive` | 发布包文件名 | 格式：`<VERSION>.tar.gz`（如 `v0.0.2.tar.gz`） |
| `releasedAt` | 实际发布时间 | ISO 时间戳 |
| `releaseUrl` | Gitee Release 链接 | publisher 写入 |

### 写入规则

- **append-only** — 永不修改、删除已有记录
- 仅在 publisher 成功发布到 Gitee Release 后写入
- 主会话通过 `appendPublish()` 函数追加
- 模块列表基于"哪些模块的 Execute + Report 都已完成"

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

**失败后的传播规则**：

| 失败作用域/阶段 | 影响 | 处理 |
|----------------|------|------|
| global.Setup | 阻断后续所有阶段 | 主会话向用户报告，等待指示 |
| global.RemoteSetup | 降级到本地构建或终止 | 询问用户 |
| modules.<name>.Plan | 仅阻断该模块的 Generate | 重新规划或调整范围 |
| modules.<name>.Generate | 仅阻断该模块的 Execute | 修复后重试 |
| modules.<name>.Execute | 进入该模块的 Report（含失败数据）| 不阻断，Report 正常生成 |
| modules.<name>.Report | 不阻断后续 | 必须生成，即使全部失败 |

**多模块独立**：模块 A 的失败不影响模块 B 的进度。各模块独立判断和恢复。

## 阶段可见性（与规则 06 一致）

主会话进入或跳过阶段时，**必须同步更新** `pipeline-state.json` 并输出标记。

**global 阶段**：

```
## Detect — 扫描项目变更          → status: "running" → "completed"
## Setup — 跳过（环境已配置）     → status: "skipped"
## Remote Setup — 跳过（用户选择本地构建）  → status: "skipped"
```

**modules 阶段**（按模块分）：

```
## role-management / Plan — 创建测试计划    → status: "completed"
## role-management / Generate — 生成测试代码  → status: "completed"
## role-management / Execute — 执行测试       → status: "running"
## role-management / Report — 生成测试报告    → status: "pending"
## user-management / Plan — 创建测试计划      → status: "pending"
```

## 主会话启动流程

1. **调用 migration 脚本**：
   ```bash
   node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project>
   ```
   - 文件不存在 → 自动创建 v2 模板
   - v1 文件 → 备份为 `.pipeline-state.v1.bak.json`，写入 v2 模板（旧状态不还原）
   - v2 文件 → 跳过
2. 读取 v2 文件，定位当前焦点：
   - `global` 中如有 `running` 状态 → 从该 global 阶段继续
   - 否则扫描 `modules`，找到**最早**的非 completed 阶段所在模块作为当前焦点
3. 输出当前焦点状态：
   ```
   ## Current Focus
   - Global: <Detect|Setup|RemoteSetup> = <status>（或 all completed）
   - Modules:
     - role-management: Plan ✓ / Generate ✓ / Execute [running] / Report
     - user-management: Plan [pending] / Generate / Execute / Report
   ```
4. 等待用户指示或继续执行

## migration 流程

### v1 → v2 破坏性升级

- **触发**：脚本检测到 `schemaVersion` 字段缺失
- **动作**：
  1. 备份 v1 文件为 `test_project/<NN-Project>/.pipeline-state.v1.bak.json`
  2. 扫描 `tests/{e2e,ui}/` 子目录，自动填充 `modules` key（仅创建空 stage 模板，**不猜状态**）
  3. `publishes` 初始化为空数组
  4. `global` 三个阶段都是 `pending`
- **不还原**：v1 的旧状态不迁移到 v2（用户已确认走破坏性升级）

### migration 脚本

位置：`.claude/scripts/migrate-pipeline-state.mjs`

CLI 用法：
```bash
node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project>
node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project> --dry-run
```

ESM 导入（供其他脚本使用）：
```js
import { readState, updateStage, appendPublish } from './migrate-pipeline-state.mjs';
```

## 状态文件管理

- **创建时机**：migrate 脚本检测到文件不存在时自动创建
- **更新时机**：每个阶段开始和结束时（主会话负责）
- **清理时机**：用户确认开始新一轮测试时，由主会话通过 `updateStage()` 重置（不要直接重写整个文件）
- **禁止删除**：v2 文件本身禁止删除
- **不提交 git**：v2 文件已 gitignore（运行时状态，不属于版本库）
- **v1 备份文件**：`.pipeline-state.v1.bak.json` 由 `test_project/*` 通配忽略

## Agent 联动

主会话启动 Agent 时，在 prompt 中传递当前焦点信息：

```
当前管线状态：
- Global: Setup completed
- Current module focus: role-management
  - Plan: completed (approvedBy: user, tcRange: TC-001~TC-018)
  - Generate: completed (mode: direct-generation)
  - Execute: running
  - Report: pending
管线状态文件：test_project/01-oa-llm/.pipeline-state.json
```

Agent 不读写状态文件，仅主会话负责状态管理。Agent 执行完毕后，主会话根据 Agent 输出调用 `updateStage()` 更新对应阶段。
