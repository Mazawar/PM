# CLAUDE.md

## Quick Start

新环境首次使用请按顺序执行：

```bash
# 1. 安装项目依赖
npm install

# 2. 安装 Playwright 浏览器
npx playwright install chromium

# 3. 安装 OfficeCli（文档生成工具）
# Windows (PowerShell):
irm https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.ps1 | iex
# macOS / Linux:
curl -fsSL https://raw.githubusercontent.com/iOfficeAI/OfficeCLI/main/install.sh | bash

# 4. 配置 SSH（可选，如需远程管理）
cp .env.example .env
# 编辑 .env 填写 SSH_SERVER_* 变量

# 5. 启动 Claude Code，智能体会自动加载 .mcp.json 中的 MCP Server
```

## Project Overview

PM (Project Manager) 是自动化测试智能体中枢。监控外部项目仓库、检测代码变更、生成测试计划、执行测试、反馈问题。

核心技术栈：Playwright + MCP Server + Agent 协作。

## Architecture

```
pm/
├── repository/                # 外部项目只读克隆（不提交）
│   ├── README.md             # 项目注册表（scan.sh 管理）
│   └── <NN-Project>/          # Git clones，禁止修改源码
├── test_project/              # 测试产物（每个 repository 条目对应一个目录）
│   ├── README.md             # 测试项目注册表
│   └── <NN-Project>/
│       ├── playwright.config.ts # 项目级 Playwright 配置（独立 baseURL）
│       ├── vitest.config.ts   # 项目级 Vitest 配置（L2 API 测试）
│       ├── plans/             # 测试计划（00-test-plan.md + 模块详细计划）
│       ├── case/              # 用户提供的业务案例（planner 优先读取，禁止覆盖）
│       ├── test-config/       # 环境配置（environment.json、auth.json）
│       ├── tests/             # 测试代码（unit/api/e2e/ui 各层级按模块分子目录）
│       │   ├── seed.spec.ts  # 登录种子文件（Planner/Generator 共享）
│       │   └── {level}/{module}/tc-{编号}-{简称}.spec.ts
│       ├── .pipeline-state.json # 管线状态（v2：global/modules/publishes 三段）
│       ├── build/            # 构建部署产物（deployer agent 生成）
│       │   ├── version-log.json    # 构建版本追踪总表
│       │   ├── deploy-config.json  # 部署配置快照（可复用）
│       │   ├── nginx.conf          # Nginx 配置文件
│       │   └── artifacts/          # 构建归档（不可删除）
│       │       ├── <timestamp>-<commit>.tar.gz
│       │       └── <timestamp>-<commit>.manifest.json
│       ├── scan-logs/         # 变更报告（scan.sh 生成）
│       └── results/           # 测试执行结果（按模块分目录）
├── docs/                      # 项目文档（agents.md）
├── .claude/
│   ├── rules/                 # 项目规则（自动加载，00-08）
│   ├── agents/                # Agent 定义（analyzer/deployer/validator/planner/generator/healer/publisher）
│   ├── skills/pm/             # 项目注册管理 skill
│   └── scripts/
│       ├── scan.sh            # 仓库扫描脚本
│       ├── init-dirs.mjs      # 项目目录初始化（幂等）
│       ├── migrate-pipeline-state.mjs # 管线状态迁移（v1 → v2）
│       ├── generate-report.mjs # Playwright 报告解析（生成 progress/report/summary）
│       └── notify.mjs         # 测试报告邮件通知
├── .mcp.json                  # MCP Server 配置（Playwright + SSH）
└── playwright.config.ts       # Playwright 全局配置（参考模板）
```

## Project Configuration

每个项目（`test_project/<NN-Project>/`）包含以下配置文件，由 `project-manage-analyzer` / `project-manage-deployer` / `project-manage-validator` 三段 agent 生成：

| 文件 | 说明 |
|------|------|
| `playwright.config.ts` | 项目级 Playwright 配置（独立 baseURL、JSON reporter、setup/chromium 双 project） |
| `vitest.config.ts` | 项目级 Vitest 配置（L2 API 测试） |
| `test-config/environment.json` | 环境唯一真实来源（端口、凭据、技术栈、中间件、启动命令、healthCheck、dbConfig、login） |
| `test-config/auth.json` | 登录认证状态（seed.spec.ts 生成，chromium project 自动加载） |
| `tests/seed.spec.ts` | 登录种子文件（Planner/Generator/Healer 共享，自动登录） |
| `case/` | 用户案例目录（业务案例、测试场景，planner 最高优先读取） |
| `.pipeline-state.json` | 管线状态文件（v2 schema：global 项目级 + modules 模块级 + publishes 历史，破坏性升级会备份为 .pipeline-state.v1.bak.json） |
| `build/version-log.json` | 构建版本追踪总表（每次构建追加一条记录） |
| `build/deploy-config.json` | 部署配置快照（可复用，下次构建跳过已安装组件） |
| `build/nginx.conf` | Nginx 配置文件 |
| `build/artifacts/` | 构建归档目录（tar.gz + manifest.json，不可删除） |

`environment.json` 是环境的唯一真实来源，`playwright.config.ts` 的 `baseURL` 必须与其一致。修改时同步更新两者。

## Rules

详细规则定义在 `.claude/rules/` 下，自动加载：

| 文件 | 内容 |
|------|------|
| `00-README.md` | 规则索引：分层结构、管线阶段映射、Agent 与规则对应关系 |
| `01-pipeline-rules.md` | 管线状态持久化 + 主会话编排：v2 schema、九阶段流程、环境检查、调度管线、用户确认点 |
| `02-project-rules.md` | 项目结构、目录规范、注册表双写、Git 规则、禁止修改列表、文件保护 |
| `03-analyzer-rules.md` | analyzer agent：本地源码分析、远程探测、端口/技术栈/凭据/中间件/数据库推断 |
| `04-deployer-rules.md` | deployer agent：验证部署能力（编译验证、归档、组装 dev/、远程部署） |
| `05-validator-rules.md` | validator agent：环境验证、健康检查、环境验证报告、runner 工具 |
| `06-planner-rules.md` | planner agent：TC 编号、计划分层、用户案例优先级、用户确认流程 |
| `07-generator-rules.md` | generator agent：直接生成/录制模式、代码生成、等待策略、断言约束 |
| `08-healer-rules.md` | healer agent：修复流程、修复限制、结果更新、progress/report/截图规范 |

## Agent Pipeline 与九阶段流程

```
Detect → Analyze → Build → Validate → Plan → Generate → Execute → Report → Publish
 扫描    分析     构建    验证      规划    生成      执行      汇报      发布
```

- **Detect / Analyze / Build / Validate** 是项目级阶段（`global`，新三段于 2026-06-03 替代原 Setup/RemoteSetup）
- **Plan / Generate / Execute / Report** 是模块级阶段（`modules.<name>`），按模块独立追踪
- **Publish** 不是阶段是操作，成功后追加到 `publishes[]` 历史数组

测试执行管线：`planner → generator → healer（按需）`（按模块串行）

环境配置管线：`analyzer → [主会话问 buildMode] → deployer (按 mode 分支) → validator`（项目级）

构建发布管线：`Report → 用户确认 → publisher（编译打包 + 打 Tag + 上传 Gitee Release）`

主会话 **不直接编写或调试测试代码**，只做调度和确认：

1. 接收任务 → 环境检查（三层检查：analyzer/build/validate 缺失则启动对应 agent；三层都就绪才跳过）
2. **构建方式选择** — Analyze 完成后用 `AskUserQuestion` 询问用户「本地构建 or 远程部署？」，写 `environment.json.build.mode`
3. 启动 planner → **优先读取 `case/` 用户案例** → 审阅计划 → **用户多轮确认调整** → 确认后启动 generator
4. 首次运行测试 → 有失败则启动 healer
5. 汇总结果（自动运行 `generate-report.mjs`） → 向用户汇报
6. 测试全部通过后 **必须主动询问** 用户是否发布到 Git Release

- **环境检查** 在每次测试前按三层走：analyzer 缺失 → `project-manage-analyzer`；build 缺失 → `project-manage-deployer`；validate 缺失 → `project-manage-validator`
- 每次测试前**必须**检查目标服务是否运行（读取 environment.json 的 healthCheck）
- **case/ 优先级**：用户案例 > 变更报告 > 自主探索
- **新三段 agent 详情**：`docs/agents.md`

## Commands

### SSH 远程管理

通过 MCP SSH Manager 管理远程服务器，配置文件为项目根目录 `.env`（已 gitignore）。

```bash
# 首次配置：复制模板并填写
cp .env.example .env
# 编辑 .env，添加 SSH_SERVER_* 变量
```

配置格式：`SSH_SERVER_<NAME>_<FIELD>=value`（NAME 用下划线，如 UBUNTU_DEV）

- 字段：HOST、USER、PASSWORD、KEYPATH、PORT、PROXYJUMP
- 示例见 `.env.example`

### 仓库扫描

```bash
bash .claude/scripts/scan.sh              # 扫描所有项目变更
bash .claude/scripts/scan.sh <项目名>      # 仅扫描指定项目（支持部分匹配，如 oa-llm 匹配 01-oa-llm）
```

定时扫描（每天 12:00）通过 `CronCreate` 配置，含自动续签机制（7 天过期前自动重建）。

### 项目目录初始化

```bash
node .claude/scripts/init-dirs.mjs --project <NN-Project>
```

幂等脚本，自动创建 case/、plans/、tests/、test-config/、results/、scan-logs/、build/artifacts/ 目录。已有文件不覆盖。

### 管线状态迁移（v1 → v2）

```bash
node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project>
node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project> --dry-run
```

- 检测到 v1（无 `schemaVersion` 字段）→ 备份为 `.pipeline-state.v1.bak.json` → 写入 v2 模板
- v2 文件已存在 → 跳过（幂等）
- 也可作为 ESM 模块导入，导出 `readState` / `updateStage` / `appendPublish` 供其他脚本使用

### 项目注册

```
/pm add [name] [url]    # 添加项目（名称和地址可选，缺省时交互询问，类型从地址自动推断）
/pm del <name>          # 删除项目（可选「彻底清理」删除磁盘目录）
/pm list                # 列出已注册项目
/pm track <name> [dirs] # 修改追踪目录
```

### 测试执行

```bash
# L3/L4 E2E 测试
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
# L2 API 测试
npx vitest run --config=test_project/<NN-Project>/vitest.config.ts
```

### 测试报告生成

```bash
node .claude/scripts/generate-report.mjs --project <NN-Project>
```

从 Playwright JSON 报告自动生成 results/ 下的 progress.txt、report.md、summary.md。

### 测试报告邮件通知

```bash
node .claude/scripts/notify.mjs --project <NN-Project>           # 有失败时发送
node .claude/scripts/notify.mjs --project <NN-Project> --dry-run # 仅预览不发送
```

- 配置文件：`.claude/notify-config.json`（从 `notify-config.example.json` 复制并填写 SMTP 信息）
- 含 SMTP 密码，已 gitignore
- 默认仅失败时发送（`sendOn.onFail: true`），可配置 `sendOn.always: true` 每次都发
- **项目级配置**：在 `test_project/<NN-Project>/test-config/environment.json` 中添加 `notification.recipients` 数组，优先于全局配置
  ```json
  "notification": {
    "recipients": ["someone@example.com"]
  }
  ```

## Git Conventions

- 提交信息用中文，简洁描述变更目的
- `repository/`、`test_project/` 测试产物、`.omc/`、`node_modules/`、`*.log`、`.claude/test-artifacts/` 已 gitignore
- `.claude/scheduled_tasks.json` **提交到版本库**
