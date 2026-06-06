# 项目规则索引

本目录下所有 `.md` 文件由 Claude Code 自动加载，无需显式引用。

## 规则总览

```
基础层（项目不变量）
├── 01-pipeline-rules        九阶段状态机、主会话职责、环境检查、调度管线、用户确认点
├── 02-project-rules         目录结构、注册表双写、Git 规则、文件保护、禁止修改列表

环境配置层（Agent 约束，管线上游）
├── 03-analyzer-rules       analyzer agent — 本地源码分析 + 远程探测，写 environment.json.analyzer
├── 04-deployer-rules       deployer agent — 验证部署能力（编译验证+归档+组装 dev/+远程部署+部署报告）
├── 05-validator-rules      validator agent — 环境验证 + 健康检查 + 环境验证报告（附录：runner 工具）

测试执行层（Agent 约束，管线下游）
├── 06-planner-rules        planner agent — TC 编号、计划分层、用户案例优先级、Seed 生成、用户确认流程
├── 07-generator-rules      generator agent — 直接生成/录制模式、代码生成、等待策略、断言约束
├── 08-healer-rules         healer agent — 修复流程、结果更新、progress/report/截图规范
```

| 管线阶段 | 适用规则 | Agent |
|---------|---------|-------|
| Detect | 01, 02 | scan.sh |
| Analyze | 01, 02, 03 | project-manage-analyzer |
| Build | 01, 02, 04 | project-manage-deployer |
| Validate | 01, 02, 05 | project-manage-validator |
| Plan | 01, 06 | planner |
| Generate | 01, 07 | generator |
| Execute | 01, 08 | healer（按需） |
| Report | 01, 08 | 主会话 + generate-report.mjs |
| Publish | 01 | test-result-publisher |

全局规则（所有阶段）：01（管线状态+编排）、02（项目不变量+文件保护）

## 规则与 Agent 定义的关系

Agent 定义文件（`.claude/agents/`）声明**工作流步骤和模板**，规则文件定义**强制约束**：

| Agent 定义 | 约束规则 |
|-----------|---------|
| `project-manage-analyzer.md` | `03-analyzer-rules.md` |
| `project-manage-deployer.md` | `04-deployer-rules.md` |
| `project-manage-validator.md` | `05-validator-rules.md` |
| `playwright-test-planner.md` | `06-planner-rules.md` |
| `playwright-test-generator.md` | `07-generator-rules.md` |
| `playwright-test-healer.md` | `08-healer-rules.md` |
| `test-result-publisher.md` | `01-pipeline-rules.md`（Publish 部分） |
