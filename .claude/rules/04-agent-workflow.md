# Agent 调度与工作流规则

## 七阶段流程 + 发布阶段

```
Detect → Setup → Analyze → Plan → Generate → Execute → Report → Publish
 扫描     配置     分析      规划    生成      执行      汇报      发布
```

1. **Detect** — `scan.sh` 检测变更，生成报告到 `test_project/<NN-Project>/reports/`
2. **Setup** — 每次测试前检查环境，无配置时启动 Setup Agent 分析项目环境
3. **Analyze** — planner Agent 读变更报告，写 `test_project/<NN-Project>/reports/summary.md`（变更概述、影响范围、测试建议）；无变更报告时跳过此步骤，直接进入 Plan
4. **Plan** — planner agent 生成测试计划，**用户确认**
5. **Generate** — generator agent 生成测试代码，**用户确认**
6. **Execute** — 运行测试，失败交 healer agent
7. **Report** — 主会话汇总结果（生成/更新 `test_project/<NN-Project>/results/` 下的 progress.txt、report.md、summary.md），向用户汇报
8. **Publish** — Report 阶段全部通过后，主会话**必须主动询问**用户是否发布；用户确认后启动 publisher agent，编译打包项目并上传附件到 Gitee Release

## 流程阶段可见性（强制）

每个阶段进入或跳过时，主会话**必须**输出一行状态标记：

| 阶段 | 进入时输出 | 跳过时输出 |
|------|-----------|-----------|
| Detect | `## Detect — 扫描项目变更` | `## Detect — 跳过（无变更检测需求）` |
| Setup | `## Setup — 检查环境配置` | `## Setup — 跳过（环境已配置，服务运行中）` |
| Analyze | `## Analyze — 分析变更报告` | `## Analyze — 跳过（无变更报告）` |
| Plan | `## Plan — 创建测试计划` | -（不可跳过） |
| Generate | `## Generate — 生成测试代码` | -（不可跳过） |
| Execute | `## Execute — 执行测试` | -（不可跳过） |
| Report | `## Report — 生成测试报告` | -（不可跳过） |
| Publish | `## Publish — 构建发布` | `## Publish — 跳过（用户未确认发布）` |

不可跳过的阶段若缺失说明流程出错，需中断并提示。

## 主会话职责（强制）

主会话 **不直接编写或调试测试代码**，只做：

1. 接收任务 → 环境检查（无配置启动 Setup Agent，已配置则跳过）
2. 启动 planner → planner 同时负责 Analyze（读变更报告）和 Plan → 审阅计划 → 确认后启动 generator
3. 首次运行测试 → 有失败则启动 healer
4. 汇总结果 → 生成/更新 `test_project/<NN-Project>/results/` 下的 progress.txt、report.md、summary.md → 向用户汇报
5. **Publish 询问** — 测试**全部通过**后，必须主动询问"是否发布到 Git Release"，不可等待用户提出；有失败时询问"是否修复后发布"

**关键**：测试生成后运行若出现 **TimeoutError**，**必须委托 healer**，禁止主会话逐步排查。

## 测试前环境检查（强制）

每次测试前，主会话**必须**检查目标项目环境：

1. 检查 `test_project/<NN-Project>/playwright.config.ts` 和 `test_project/<NN-Project>/test-config/environment.json` 是否存在
2. **不存在**（未配置）→ 启动 Setup Agent（`Agent(subagent_type="project-manage-setup")`）
   - Agent 分析源码、推断端口和凭据
   - 生成 `playwright.config.ts`、`environment.json`、`start.sh`、`SETUP.md`
   - 验证环境 → 完成后继续测试流程
3. **已存在**（已配置）→ 读取 `environment.json` 中的 `healthCheck`
4. 用 curl 检查服务是否在运行：`curl -s -o /dev/null -w "%{http_code}" <healthCheck.url>`
5. 检查结果：
   - **通过** → 继续测试流程
   - **未通过** → 启动 Setup Agent，由 Agent 负责启动服务并验证（不是仅提示用户）

## Report 阶段（强制）

测试运行完成后，无论通过或失败，**主会话**必须生成/更新以下结果文件：

### 结果文件生成（每次测试后）

1. **`test_project/<NN-Project>/results/{module}/progress.txt`** — 根据 Playwright 输出填写每条 TC 状态（PASS/FAIL/SKIP）
2. **`test_project/<NN-Project>/results/{module}/report.md`** — 按规则 03 格式填写（含截图引用）
3. **`test_project/<NN-Project>/results/summary.md`** — 聚合所有模块通过率

### 结果来源

- **healer 已运行** → healer 更新了 progress.txt 和 report.md，主会话只需更新 summary.md
- **healer 未运行**（全通过或用户未批准 healer）→ 主会话根据 Playwright 输出生成全部结果文件

### 禁止空结果

**不允许**测试运行后 `test_project/<NN-Project>/results/` 目录下没有 progress.txt 和 report.md。即使全部通过也必须生成。

### 测试报告通知（可选）

结果文件生成后，主会话可调用通知脚本推送报告邮件：

```bash
node .claude/scripts/notify.mjs --project <NN-Project>           # 有失败时发送
node .claude/scripts/notify.mjs --project <NN-Project> --dry-run # 仅预览不发送
```

- 需先创建 `.claude/scripts/notify-config.json`（从 `notify-config.example.json` 复制并填写 SMTP 信息）
- 通知配置含 SMTP 密码，已 gitignore，不提交到版本库
- 默认仅在有失败用例时发送（`sendOn.onFail: true`），可配置 `sendOn.always: true` 每次都发

## Agent 调度管线

测试执行管线（Setup 由环境检查流程按需触发，不在此管线中）：

```
planner → generator → healer（按需）
  规划      生成       修复
```

构建发布管线（Report 后全部通过时，主会话**必须主动询问**，不可等待用户提出）：

```
                  ┌─ 用户确认 → publisher
Report → 用户询问 ┤                  构建 → 确认发布 → 打 Tag + Release + 上传附件
                  └─ 跳过
```

- Agent 始终 **先提议，等用户确认** 后再执行
- 未经用户批准不自动执行测试
- **项目编号传递**：主会话启动 Agent 时，**必须**在 prompt 中传递项目编号（如 `01-xxx`）和关键路径信息
- **项目编号验证**：Agent 启动后必须首先确认项目编号有效（检查 `test_project/<NN-Project>/` 目录存在），无效则立即报错退出，不继续执行
- 启动命令：
  - planner: `Agent(subagent_type="playwright-test-planner")`
  - generator: `Agent(subagent_type="playwright-test-generator")`
  - healer: `Agent(subagent_type="playwright-test-healer")`
  - publisher: `Agent(subagent_type="test-result-publisher")`
- 测试运行必须使用项目级配置：
  ```bash
  npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
  ```

## 用户确认点

| 阶段 | 确认内容 |
|------|---------|
| Plan 后 | 测试计划的模块覆盖和 TC 编号分配 |
| Generate 后 | 生成的测试代码 |
| Report 后 | 全部通过 → 是否发布到 Git Release / 跳过；有失败 → 是否修复后发布 / 提交 issue / 进一步测试 |
| Publish（构建后） | 确认发布到 Git Release（打 Tag + 创建 Release + 上传附件） |

## 禁止修改列表

所有 Agent 禁止修改以下文件：
- 项目根目录下的 `playwright.config.ts`（全局配置）、`package.json`、`.mcp.json`
- CLAUDE.md、`docs/`、agent 定义文件
- `.claude/rules/` 规则文件
- `repository/` 下的源码

**例外**：`test_project/<NN-Project>/playwright.config.ts` 和 `test_project/<NN-Project>/test-config/environment.json` 由 Setup Agent 和 `healer` agent 管理。

### `.last_hash` 保护（强制）

- `test_project/<NN-Project>/.last_hash` 是扫描脚本的变更追踪基准，**任何 Agent 禁止删除或清空**
- Setup Agent 创建目录时，若 `.last_hash` 已存在必须保留原内容
- 仅 `scan.sh` 有权写入 `.last_hash`
