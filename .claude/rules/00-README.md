# 项目规则索引

本目录下所有 `.md` 文件由 Claude Code 自动加载，无需显式引用。

## 规则总览

```
基础层（项目不变量）
├── 01-pipeline-state       九阶段状态机、可中断恢复、状态转换规则
├── 02-project-invariants   目录结构、注册表双写、Git 规则、文件保护

Agent 约束层（环境配置，管线上游）
├── 03-setup-environment    DEPRECATED — 已拆分为 analyzer/builder/validator 三段（保留作为索引参考）
├── 03a-analyzer-rules      analyzer agent — 本地源码分析、写入 environment.json.analyzer
├── 03b-builder-rules       builder agent — 生产构建、归档、组装 build/dev/
├── 03c-validator-rules     validator agent — 启动服务、健康检查、登录验证、写 SETUP.md
├── 03d-runner-rules        runner.sh — 日常启停服务（工具，非 agent）

定义层（测试 & 产物规范）
├── 04-testing-framework    测试层级（L1-L4）、框架选择、覆盖要求、数据安全
├── 05-test-output          结果目录、文件命名、progress/report/截图规范

流程层（管线总纲）
├── 06-agent-workflow       主会话职责、调度管线、环境检查、用户确认点

Agent 约束层（测试执行 & 远程部署）
├── 07-agent-behavior       planner/generator/healer — 录制流程、等待策略、循环防护、用户确认
├── 08-remote-deployment    DEPRECATED 索引 — 已被 08a/08b/08c 三段替代（builder/validator 远程部分）
├── 08a-remote-analyzer-rules  远程探测（analyzer 阶段，remoteConfig.server 已绑定时）
├── 08b-remote-builder-rules   远程构建（builder agent mode=remote）
├── 08c-remote-validator-rules 远程验证（validator agent）
```

## 规则与管线阶段映射

| 管线阶段 | 适用规则 | Agent |
|---------|---------|-------|
| Detect | 02, 06 | scan.sh |
| Analyze | 02, 06, 03a, 08a | project-manage-analyzer |
| Build | 02, 06, 03b, 08b | project-manage-builder |
| Validate | 02, 06, 03c, 08c | project-manage-validator |
| Plan | 06, 07 | planner |
| Generate | 06, 07 | generator |
| Execute | 06, 07 | healer（按需） |
| Report | 05, 06 | 主会话 + generate-report.mjs |
| Publish | 06 | test-result-publisher |

全局规则（所有阶段）：01（管线状态）、02（项目不变量）

## 规则与 Agent 定义的关系

Agent 定义文件（`.claude/agents/`）声明**工作流步骤和模板**，规则文件定义**强制约束**：

| Agent 定义 | 约束规则 |
|-----------|---------|
| `project-manage-setup.md`（**DEPRECATED**） | `03-setup-environment.md`（索引，仅作历史参考） |
| `project-manage-analyzer.md` | `03a-analyzer-rules.md`、`08a-remote-analyzer-rules.md` |
| `project-manage-builder.md` | `03b-builder-rules.md`、`08b-remote-builder-rules.md` |
| `project-manage-validator.md` | `03c-validator-rules.md`、`08c-remote-validator-rules.md` |
| `remote-env-setup.md`（**DEPRECATED**） | `08a/08b/08c-remote-*-rules.md`（已拆分） |
| `playwright-test-planner.md` | `07-agent-behavior.md`（planner 部分） |
| `playwright-test-generator.md` | `07-agent-behavior.md`（generator 部分） |
| `playwright-test-healer.md` | `07-agent-behavior.md`（healer 部分） |
| `test-result-publisher.md` | `06-agent-workflow.md`（Publish 部分） |
