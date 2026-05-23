# Agent 调度与工作流规则

## 七阶段流程

```
Detect → Setup → Analyze → Plan → Generate → Execute → Report
 扫描     配置     分析      规划    生成      执行      汇报
```

1. **Detect** — `scan.sh` 检测变更，生成报告到 `reports/`
2. **Setup** — 每次测试前检查环境，无配置时启动 Setup Agent 分析项目环境
3. **Analyze** — Agent 读报告，写 `reports/summary.md`
4. **Plan** — planner agent 生成测试计划，**用户确认**
5. **Generate** — generator agent 生成测试代码，**用户确认**
6. **Execute** — 运行测试，失败交 healer agent
7. **Report** — 汇总结果，向用户汇报

## 主会话职责（强制）

主会话 **不直接编写或调试测试代码**，只做：

1. 接收任务 → 启动 planner
2. 审阅计划 → 确认后启动 generator
3. 首次运行测试 → 有失败则启动 healer
4. 汇总结果 → 向用户汇报

**关键**：测试生成后运行若出现 **TimeoutError**，**必须委托 healer**，禁止主会话逐步排查。

## 测试前环境检查（强制）

每次测试前，主会话**必须**检查目标项目环境：

1. 检查 `test_project/<NN>/playwright.config.ts` 和 `test-config/environment.json` 是否存在
2. **不存在**（未配置）→ 启动 Setup Agent（`Agent(subagent_type="project-manage-setup")`）
   - Agent 分析源码、推断端口和凭据
   - 生成 `playwright.config.ts`、`environment.json`、`start.sh`、`startup.md`
   - 验证环境 → 完成后继续测试流程
3. **已存在**（已配置）→ 读取 `environment.json` 中的 `healthCheck`
4. 用 curl 检查服务是否在运行：`curl -s -o /dev/null -w "%{http_code}" <healthCheck.url>`
5. 检查结果：
   - **通过** → 继续测试流程
   - **未通过** → 提示用户先启动服务，输出 `bash test_project/<NN>/start.sh`

## Agent 调度管线

测试执行管线（Setup 由环境检查流程按需触发，不在此管线中）：

```
planner → generator → healer（按需）
  规划      生成       修复
```

- Agent 始终 **先提议，等用户确认** 后再执行
- 未经用户批准不自动执行测试
- **项目编号传递**：主会话启动 Agent 时，**必须**在 prompt 中传递项目编号（如 `02-oa-llm`）和关键路径信息
- 启动命令：
  - planner: `Agent(subagent_type="playwright-test-planner")`
  - generator: `Agent(subagent_type="playwright-test-generator")`
  - healer: `Agent(subagent_type="playwright-test-healer")`
- 测试运行必须使用项目级配置：
  ```bash
  npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
  ```

## 用户确认点

| 阶段 | 确认内容 |
|------|---------|
| Plan 后 | 测试计划的模块覆盖和 TC 编号分配 |
| Generate 后 | 生成的测试代码 |
| Report 后 | 是否提交 issue 或进一步测试 |

## 禁止修改列表

所有 Agent 禁止修改以下文件：
- 项目根目录下的 `playwright.config.ts`（全局配置）、`package.json`、`.mcp.json`
- CLAUDE.md、`docs/`、agent 定义文件
- `.claude/rules/` 规则文件
- `repository/` 下的源码

**例外**：`test_project/<NN>/playwright.config.ts` 和 `test-config/environment.json` 由 Setup Agent 和 `healer` agent 管理。

### `.last_hash` 保护（强制）

- `test_project/<NN>/.last_hash` 是扫描脚本的变更追踪基准，**任何 Agent 禁止删除或清空**
- Setup Agent 创建目录时，若 `.last_hash` 已存在必须保留原内容
- 仅 `scan.sh` 有权写入 `.last_hash`
