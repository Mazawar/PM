# Agent 调度与工作流规则

## 管线状态持久化

九阶段流程是**可中断、可恢复**的状态机。详细定义见 `01-pipeline-state.md`。

**核心规则**：
- v2 schema 把状态拆为 `global`（项目级：Detect/Setup/RemoteSetup）/ `modules`（按模块：Plan/Generate/Execute/Report）/ `publishes`（历史）三段
- 主会话通过 ESM 导入 `migrate-pipeline-state.mjs` 提供的 `readState` / `updateStage` / `appendPublish` 三个函数读写
- 新会话启动时**先调用 migrate 脚本**读取或迁移状态（v1 → v2 破坏性升级，备份为 `.pipeline-state.v1.bak.json`）
- Agent 不读写状态文件，仅主会话负责状态管理

## 九阶段流程

```
Detect → Setup → Remote Setup → Analyze → Plan → Generate → Execute → Report → Publish
 扫描     配置    远程部署(可选)   分析      规划    生成      执行      汇报      发布
```

1. **Detect** — `scan.sh` 检测变更，生成报告到 `test_project/<NN-Project>/reports/`
2. **Setup** — 每次测试前检查环境。无配置时启动 Setup Agent 分析项目环境、执行生产构建（编译 + 归档 + 组装 `build/dev/`）；配置存在但 `build/dev/` 缺失时（如远程部署场景），同样启动 Setup Agent 执行生产构建；配置和构建都就绪则跳过
3. **Remote Setup** — Setup 完成后（`build/dev/` 已就绪），询问用户是否远程部署。部署则启动 Remote Setup Agent，将本地已构建的 `build/dev/` 上传到远程服务器，安装系统运行时，配置环境并启动服务
4. **Analyze** — planner Agent 读变更报告，写 `test_project/<NN-Project>/reports/summary.md`（变更概述、影响范围、测试建议）；无变更报告时跳过此步骤，直接进入 Plan
5. **Plan** — planner agent 生成测试计划（优先读取 `case/` 目录中的用户案例），**用户多轮确认与调整**后才进入 Generate
6. **Generate** — generator agent 生成测试代码，**用户确认**
7. **Execute** — 运行测试，失败交 healer agent
8. **Report** — 主会话汇总结果（生成/更新 `test_project/<NN-Project>/results/` 下的 progress.txt、report.md、summary.md），向用户汇报
9. **Publish** — Report 阶段全部通过后，主会话**必须主动询问**用户是否发布；用户确认后启动 publisher agent，打包 build/dev 并上传附件到 Gitee Release

## 流程阶段可见性（强制）

每个阶段进入或跳过时，主会话**必须**输出一行状态标记：

| 阶段 | 进入时输出 | 跳过时输出 |
|------|-----------|-----------|
| Detect | `## Detect — 扫描项目变更` | `## Detect — 跳过（无变更检测需求）` |
| Setup | `## Setup — 检查环境配置` | `## Setup — 跳过（环境已配置，服务运行中）` |
| Remote Setup | `## Remote Setup — 配置远程环境` | `## Remote Setup — 跳过（用户选择本地构建）` |
| Analyze | `## Analyze — 分析变更报告` | `## Analyze — 跳过（无变更报告）` |
| Plan | `## Plan — 创建测试计划` | -（不可跳过） |
| Generate | `## Generate — 生成测试代码` | -（不可跳过） |
| Execute | `## Execute — 执行测试` | -（不可跳过） |
| Report | `## Report — 生成测试报告` | -（不可跳过） |
| Publish | `## Publish — 构建发布` | `## Publish — 跳过（用户未确认发布）` |

不可跳过的阶段若缺失说明流程出错，需中断并提示。

## 主会话职责（强制）

主会话 **不直接编写或调试测试代码**，只做：

1. 接收任务 → 环境检查（两层检查：配置缺失 **或** 构建产物 `build/dev/` 缺失 → 都启动 Setup Agent；两者都就绪才跳过）
2. **远程部署选择** — Setup 完成后，使用 `AskUserQuestion` 询问用户"是否需要部署到远程服务器？"
   - **本地测试** → 继续，服务已在本地运行，直接进入测试流程
   - **远程部署** → 启动 Remote Setup Agent（`Agent(subagent_type="remote-env-setup")`）
     - Agent 读取 environment.json，将本地 `build/dev/` 上传到远程服务器
     - 安装系统运行时（Node.js/MySQL/Nginx 等），配置 .env，初始化数据库，启动服务
     - 更新 environment.json 的 baseURL 为远程 URL（需用户确认）
     - 同步更新 playwright.config.ts
     - 完成后可继续在远程环境执行测试
   - **切换服务器** → 清空 remoteConfig，启动 Remote Setup Agent 执行重绑定
3. 启动 planner → 启动前检查 `case/` 目录是否有用户案例文件，在 prompt 中告知 planner → planner 同时负责 Analyze（读变更报告）和 Plan（优先读 case/）→ 审阅计划 → **向用户展示摘要并请求确认** → 用户可要求多轮调整 → 确认后调用 `updateStage('module', '<name>', 'Plan', { status: 'completed', approvedBy: 'user', tcRange })` → 启动 generator
4. 首次运行测试 → 调用 `updateStage('module', '<name>', 'Execute', { status: 'running' })` → 跑测试 → 调用 generate-report.mjs 解析结果 → 有失败则启动 healer
5. 汇总结果 → 调 `updateStage('module', '<name>', 'Execute', { status: 'completed' })` → 调 `updateStage('module', '<name>', 'Report', { status: 'completed' })` → 向用户汇报
6. **Publish 询问** — 所有模块的 Report 全部通过后，必须主动询问"是否发布到 Git Release"，不可等待用户提出；有失败时询问"是否修复后发布"；用户确认后启动 publisher，发布成功调 `appendPublish({ version, modules, commit, archive, releaseUrl, releasedAt })` 追加到 `publishes[]`

**关键**：测试生成后运行若出现 **TimeoutError**，**必须委托 healer**，禁止主会话逐步排查。

## 测试前环境检查（强制）

每次测试前，主会话**必须**检查目标项目环境。如果执行远程部署，还需额外检查构建产物：

### 基础检查（所有场景）

1. **调用 migrate 脚本**初始化/读取 v2 状态：
   ```bash
   node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project>
   ```
2. 检查 `test_project/<NN-Project>/playwright.config.ts` 和 `test_project/<NN-Project>/test-config/environment.json` 是否存在
3. **不存在**（未配置）→ 启动 Setup Agent（`Agent(subagent_type="project-manage-setup")`）
   - Agent 分析源码、推断端口和凭据
   - 生成 `playwright.config.ts`、`environment.json`、`start.sh`、`SETUP.md`
   - 执行生产构建，组装 `build/dev/` 部署包
   - 验证环境 → 完成后通过 `updateStage('global', null, 'Setup', { status: 'completed' })` 更新状态
4. **已存在**（已配置）→ 读取 `environment.json` 中的 `healthCheck`
5. 用 curl 检查服务是否在运行：`curl -s -o /dev/null -w "%{http_code}" <healthCheck.url>`
6. 检查结果：
   - **通过** → 继续测试流程
   - **未通过** → 启动 Setup Agent，由 Agent 负责启动服务并验证（不是仅提示用户）

### 远程部署前置检查（当用户要求远程部署时追加）

在启动 Remote Setup Agent 之前，额外检查 `build/dev/` 是否存在且结构完整：
- `build/dev/software/package.json` — workspace 根存在
- `build/dev/software/apps/*/dist/` — 编译产物存在（按 techStack 检查）
- `build/dev/deploy.md` — 部署说明存在

**`build/dev/` 不完整 → 先启动 Setup Agent 执行生产构建，再启动 Remote Setup Agent。主会话禁止自行编译打包。**

## Report 阶段（强制）

测试运行完成后，无论通过或失败，**必须**生成结果文件。

### 结果文件生成（自动化优先）

使用自动化脚本从 Playwright JSON 报告生成结果文件：

```bash
node .claude/scripts/generate-report.mjs --project <NN-Project>
```

脚本自动解析 Playwright 输出，生成：
1. **`results/{module}/progress.txt`** — 每条 TC 的 PASS/FAIL/SKIP 状态
2. **`results/{module}/report.md`** — 模块详细报告（含截图引用、步骤详情）
3. **`results/summary.md`** — 聚合所有模块通过率

### 结果来源

- **healer 已运行** → healer 更新了 progress.txt 和 report.md，主会话运行脚本更新 summary.md
- **healer 未运行**（全通过或用户未批准 healer）→ 主会话运行脚本生成全部结果文件
- **脚本失败** → 主会话根据 Playwright 文本输出手动生成（兜底方案）

### 禁止空结果

**不允许**测试运行后 `test_project/<NN-Project>/results/` 目录下没有 progress.txt 和 report.md。即使全部通过也必须生成。

### 测试报告通知（可选）

结果文件生成后，主会话可调用通知脚本推送报告邮件：

```bash
node .claude/scripts/notify.mjs --project <NN-Project>           # 有失败时发送
node .claude/scripts/notify.mjs --project <NN-Project> --dry-run # 仅预览不发送
```

- 需先创建 `.claude/notify-config.json`（从 `notify-config.example.json` 复制并填写 SMTP 信息）
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
  - remote-setup: `Agent(subagent_type="remote-env-setup")` — 将本地已构建的部署包上传到远程服务器
- 测试运行必须使用项目级配置：
  ```bash
  npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
  ```

## 用户确认点

| 阶段 | 确认内容 |
|------|---------|
| Remote Setup 后 | 确认 environment.json 的 baseURL 变更（远程 IP） |
| Plan 后 | 测试计划的模块覆盖、TC 编号分配、用户案例覆盖度（可多轮调整） |
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

### `.last_hash`、`.pipeline-state.json` 和 `case/` 保护（强制）

- `test_project/<NN-Project>/.last_hash` 是扫描脚本的变更追踪基准，**任何 Agent 禁止删除或清空**
- `test_project/<NN-Project>/.pipeline-state.json` 是管线状态文件，**任何 Agent 禁止删除**（主会话可重置）
- `test_project/<NN-Project>/case/` 是用户案例目录，**任何 Agent 禁止删除、清空或覆盖其中文件**
- Setup Agent 创建目录时，若上述文件/目录已存在必须保留原内容
- `.last_hash` 仅 `scan.sh` 有权写入
- `.pipeline-state.json` 仅主会话有权写入
