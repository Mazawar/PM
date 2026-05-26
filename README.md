# PM - 自动化测试智能体中枢

PM（Project Manager）是一个 AI 驱动的自动化测试平台。它监控外部项目仓库的代码变更，通过多 Agent 协作自动生成测试计划、编写测试脚本、执行并修复失败的测试，最终将问题反馈回原项目。

核心思路：**人只做决策，Agent 做执行** —— 从变更检测到测试报告，全程由专职 Agent 分阶段完成，用户只需审阅和确认。

## 核心特性

- **仓库监控** — 定时扫描已注册项目，通过 `.last_hash` 比对自动检测新提交
- **智能规划** — Planner Agent 浏览被测应用，自动探索页面结构和交互流程，生成四级测试计划
- **自动生成** — Generator Agent 按计划在浏览器中录制操作，生成 Playwright 测试脚本
- **自我修复** — Healer Agent 自动运行失败测试、定位根因、修复代码并验证通过
- **四级测试** — L1 单元测试 → L2 接口测试 → L3 E2E 测试 → L4 UI 测试，按需覆盖

## 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                      用户（审阅 & 确认）                    │
└──────────────┬──────────────────────────┬───────────────┘
               │                          │
         ┌─────▼─────┐             ┌──────▼──────┐
         │  scan.sh   │             │  主会话调度   │
         │  变更检测    │             │  任务分派     │
         └─────┬──────┘             └──────┬──────┘
               │                           │
               ▼                    ┌──────▼──────┐
    ┌─────────────────┐            │  首次测试？    │
    │  变更报告         │            │  → Setup      │
    │  reports/*.md    │───────────▶│    Agent      │
    └─────────────────┘            └──────┬──────┘
                                          │ 已配置
                                   ┌──────▼──────┐
                                   │ Agent Pipeline │
                                   │                │
                                   │ planner → generator → healer  │
                                   │ (规划)     (生成)      (修复)  │
                                   └──────┬─────────────────────┘
                                          │
                                   ┌──────▼──────┐
                                   │  测试执行     │
                                   │  Playwright  │
                                   │  (项目级配置)  │
                                   └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │  结果报告     │
                                   │  results/    │
                                   └─────────────┘
```

### 七阶段流程

```
Detect → Setup → Analyze → Plan → Generate → Execute → Report
 扫描     配置     分析      规划    生成      执行      汇报
```

- **Setup** 仅首次测试触发，由 Setup Agent 自动分析源码、推断端口、生成环境配置
- 测试执行管线：`planner → generator → healer（按需）`

### 目录结构

```
pm/
├── repository/                    # 外部项目只读克隆（gitignore）
│   ├── README.md                 # 项目注册表（scan.sh 管理）
│   └── <NN-Project>/              # Git clones，禁止修改源码
│       └── .last_hash             # 上次扫描的 commit hash
│
├── test_project/                  # 测试产物（gitignore，仅注册表和模板提交）
│   ├── README.md                 # 测试工程注册表
│   └── <NN-Project>/
│       ├── playwright.config.ts   # 项目级 Playwright 配置（独立 baseURL）
│       ├── start.sh               # 一键启动脚本（Setup Agent 生成）
│       ├── test-config/           # 测试计划
│       │   ├── test-plan.md       # 总计划索引（模块索引表）
│       │   ├── plans/             # 按模块拆分的详细计划
│       │   └── environment.json   # 环境配置（技术栈、端口、凭据、中间件）
│       ├── tests/                 # 测试代码（{module}-{scenario}.spec.ts）
│       ├── SETUP.md                # 环境启动报告（Setup Agent 生成）
│       ├── reports/               # 变更报告
│       └── results/               # 测试执行结果（按模块分目录）
│           ├── summary.md         # 汇总报告
│           └── <module>/          # progress.txt + report.md + screenshots/
│
├── docs/                          # 项目文档
│   ├── 00-README.md               # 文档索引
│   ├── 01-TESTING.md              # 测试框架规则
│   └── 02-WORKFLOW.md             # Agent 交互流程
│
├── .claude/
│   ├── agents/                    # Agent 定义
│   │   ├── project-manage-setup.md  # Setup Agent
│   │   ├── playwright-test-planner.md
│   │   ├── playwright-test-generator.md
│   │   └── playwright-test-healer.md
│   ├── skills/pm/                 # /pm 项目注册管理 Skill
│   ├── scripts/scan.sh            # 仓库扫描脚本
│   └── test-artifacts/            # Playwright 运行时产物（gitignore）
│
├── .mcp.json                      # Playwright MCP Server 配置
├── playwright.config.ts           # Playwright 全局配置
└── package.json                   # Node.js 依赖
```

### Agent 协作流程

四个专职 Agent 按阶段工作，主会话只负责调度和确认：

| 阶段 | Agent | 职责 | 输出 |
|------|-------|------|------|
| 配置 | **Setup** | 首次测试时分析源码、推断端口、生成环境配置 | `playwright.config.ts`、`environment.json`、`start.sh` |
| 规划 | **planner** | 浏览应用、探索页面、生成测试计划 | `test-config/plans/{module}.md` |
| 生成 | **generator** | 按计划在浏览器录制操作、生成测试脚本 | `tests/{module}-{scenario}.spec.ts` |
| 修复 | **healer** | 运行失败测试、定位错误、修复并验证 | 修复后的 `.spec.ts` + `results/` |

### 关键设计

- **repository 与 test_project 1:1 对应** — 如 `repository/01-RuoYi-Vue` 对应 `test_project/01-RuoYi-Vue`
- **repository 只读** — 仅 `git clone` / `git pull`，禁止修改源码
- **约定大于配置** — 每个项目独立 `playwright.config.ts` + `environment.json`，首次测试时自动生成
- **测试结果按模块隔离** — 每个模块独立的 `progress.txt`、`report.md`、`screenshots/`，互不覆盖
- **MCP Server 驱动浏览器** — Agent 通过 Playwright MCP Server 控制浏览器，实现录制和回放

## 快速开始

### 环境准备

```bash
# 安装依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium
```

### 注册项目

使用 `/pm` Skill 管理项目注册（自动双写两个注册表）：

```
/pm add [name] [url]    # 添加项目（首次测试时自动配置环境）
/pm del <name>          # 删除项目
/pm list                # 列出已注册项目
```

### 扫描变更

```bash
bash .claude/scripts/scan.sh
```

### 执行测试

```bash
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 测试框架 | Playwright |
| Agent 通信 | MCP Server + Claude Code |
| 配置语言 | TypeScript / JSON |
| 扫描脚本 | Bash |
| 版本管理 | Git |

## 文档

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | [README.md](docs/00-README.md) | 文档索引 |
| 01 | [TESTING.md](docs/01-TESTING.md) | 测试框架规则 — 多语言框架映射、四级测试定义、用例格式 |
| 02 | [WORKFLOW.md](docs/02-WORKFLOW.md) | 交互流程规范 — 七阶段协议（含环境自动分析） |

## 许可

ISC
