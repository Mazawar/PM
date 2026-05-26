# CLAUDE.md

## Project Overview

PM (Project Manager) 是自动化测试智能体中枢。监控外部项目仓库、检测代码变更、生成测试计划、执行测试、反馈问题。

核心技术栈：Playwright + MCP Server + Agent 协作。

## Architecture

```
pm/
├── repository/                # 外部项目只读克隆（不提交）
│   ├── READEME.md             # 项目注册表（scan.sh 管理）
│   └── <NN-Project>/          # Git clones，禁止修改源码
├── test_project/              # 测试产物（每个 repository 条目对应一个目录）
│   ├── READEME.md             # 测试项目注册表
│   └── <NN-Project>/
│       ├── playwright.config.ts # 项目级 Playwright 配置（独立 baseURL）
│       ├── start.sh           # 一键启动脚本（Setup Agent 生成）
│       ├── test-config/       # 测试计划、环境配置（environment.json）
│       ├── tests/             # 测试代码（{module}-{scenario}.spec.ts）
│       ├── SETUP.md          # 环境启动报告（Setup Agent 生成）
│       ├── reports/           # 变更报告
│       └── results/           # 测试执行结果（按模块分目录）
├── docs/                      # 项目文档
├── .claude/
│   ├── rules/                 # 项目规则（自动加载）
│   ├── agents/                # Playwright Agent 定义
│   ├── skills/pm/             # 项目注册管理 skill
│   └── scripts/scan.sh        # 仓库扫描脚本
├── .mcp.json                  # Playwright MCP Server 配置
└── playwright.config.ts       # Playwright 全局配置
```

## Project Configuration

每个项目（`test_project/<NN-Project>/`）包含以下配置文件，由 Setup Agent 生成：

| 文件 | 说明 |
|------|------|
| `playwright.config.ts` | 项目级 Playwright 配置（独立 baseURL、outputDir） |
| `test-config/environment.json` | 环境配置（端口、凭据、技术栈、中间件、启动命令、healthCheck） |
| `start.sh` | 一键启动脚本（端口检查 + 健康检查） |
| `SETUP.md` | 环境启动报告（实际验证结果） |

`environment.json` 是环境的唯一真实来源，`playwright.config.ts` 的 `baseURL` 必须与其一致。修改时同步更新两者。

## Rules

详细规则定义在 `.claude/rules/` 下，自动加载：

| 文件 | 内容 |
|------|------|
| `01-project-invariants.md` | 项目结构、目录规范、注册表双写、Git 规则 |
| `02-testing-framework.md` | 测试层级定义、框架选择、覆盖要求、测试数据安全 |
| `03-test-output.md` | 结果目录结构、文件命名、progress/report 格式、截图规范 |
| `04-agent-workflow.md` | 七阶段流程、主会话职责、调度管线、环境检查、用户确认点、禁止修改列表 |
| `05-agent-behavior.md` | planner/generator/healer 各 Agent 行为约束 |

## Agent Pipeline 与七阶段流程

```
Detect → Setup → Analyze → Plan → Generate → Execute → Report
 扫描     配置     分析      规划    生成      执行      汇报
```

测试执行管线：`planner → generator → healer（按需）`

主会话 **不直接编写或调试测试代码**，只做调度和确认：

1. 接收任务 → 环境检查（无配置启动 Setup Agent，已配置则跳过）
2. 启动 planner → 审阅计划 → 确认后启动 generator
3. 首次运行测试 → 有失败则启动 healer
4. 汇总结果 → 向用户汇报

- **Setup** 在每次测试前检查环境：无配置时启动 Setup Agent 分析源码、推断端口；已配置且服务运行则跳过
- 每次测试前**必须**检查目标服务是否运行（读取 environment.json 的 healthCheck）

## Commands

### 仓库扫描

```bash
bash .claude/scripts/scan.sh          # 扫描所有项目变更
```

### 项目注册

```
/pm add [name] [url]    # 添加项目（名称和地址可选，缺省时交互询问，类型从地址自动推断）
/pm del <name>          # 删除项目（需确认）
/pm list                # 列出已注册项目
```

### 测试执行

```bash
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

### 测试报告邮件通知

```bash
node .claude/scripts/notify.mjs --project <NN-Project>           # 有失败时发送
node .claude/scripts/notify.mjs --project <NN-Project> --dry-run # 仅预览不发送
```

- 配置文件：`.claude/scripts/notify-config.json`（从 `notify-config.example.json` 复制并填写 SMTP 信息）
- 含 SMTP 密码，已 gitignore
- 默认仅失败时发送（`sendOn.onFail: true`），可配置 `sendOn.always: true` 每次都发

## Git Conventions

- 提交信息用中文，简洁描述变更目的
- `repository/`、`test_project/` 测试产物、`.omc/`、`node_modules/`、`*.log`、`.claude/test-artifacts/` 已 gitignore
- `.claude/scheduled_tasks.json` **提交到版本库**
