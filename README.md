# PM - 自动化测试智能体中枢

PM（Project Manager）是一个 AI 驱动的自动化测试平台。它监控外部项目仓库的代码变更，通过多 Agent 协作自动生成测试计划、编写测试脚本、执行并修复失败的测试，最终将问题反馈回原项目。

核心思路：**人只做决策，Agent 做执行** —— 从变更检测到测试报告，全程由专职 Agent 分阶段完成，用户只需审阅和确认。

## 核心特性

- **仓库监控** — 定时扫描已注册项目（每 30 分钟），通过 `.last_hash` 比对自动检测新提交，含自动续签机制
- **用户案例驱动** — 用户可在 `case/` 目录放入业务案例文件，planner 优先读取并转化为测试计划
- **智能规划** — Planner Agent 浏览被测应用，自动探索页面结构和交互流程，生成四级测试计划
- **自动生成** — Generator Agent 按计划在浏览器中录制操作，生成 Playwright 测试脚本
- **自我修复** — Healer Agent 自动运行失败测试、定位根因、修复代码并验证通过
- **远程部署** — Builder Agent 通过 SSH 在远程服务器部署环境，支持本地构建和远程部署两种模式
- **四级测试** — L1 单元测试 → L2 接口测试（Vitest） → L3 E2E 测试 → L4 UI 测试，按需覆盖
- **可中断恢复** — v2 管线状态持久化（global 项目级 + modules 模块级 + publishes 历史），崩溃或中断后从断点继续；多模块进度独立

## 架构总览

```
┌──────────────────────────────────────────────────────────────┐
│                       用户（审阅 & 确认）                       │
│            case/ 目录放入业务案例 → planner 优先读取            │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
         ┌─────▼─────┐             ┌──────▼──────┐
         │  scan.sh   │             │  主会话调度   │
         │  变更检测    │             │  九阶段管线   │
         └─────┬──────┘             └──────┬──────┘
               │                           │
               ▼                    ┌──────▼──────┐
    ┌─────────────────┐            │ 环境就绪？    │
    │  变更报告         │            │ → 三段检查    │
    │  scan-logs/*.md    │───────────▶│ analyzer     │
    └─────────────────┘            │ → deployer   │
                                   │ → validator  │
                                   └──────┬──────┘
                                          │ 已就绪
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
                              ┌───────────┴───────────┐
                              ▼                       ▼
                       ┌──────────┐          ┌──────────────┐
                       │ 结果报告  │          │ 构建发布      │
                       │ results/ │          │ → Publisher   │
                       │ + 邮件通知│          │   Agent       │
                       └──────────┘          └──────────────┘
```

### 九阶段流程

```
Detect → Analyze → Build → Validate → Plan → Generate → Execute → Report → Publish
 扫描    分析     构建    验证      规划    生成      执行      汇报      发布
```

- **Detect** — `scan.sh` 定时扫描，检测到变更生成报告到 `scan-logs/`
- **Analyze / Build / Validate** — 项目级阶段：analyzer 分析源码 → deployer 验证部署能力 → validator 环境验证
- **Plan / Generate / Execute / Report** — 模块级阶段（v2 `modules.<name>`），按模块独立追踪，互不覆盖
- **Plan** — planner 优先读取 `case/` 用户案例，生成测试计划，用户多轮确认
- **Generate** — generator 按计划录制操作，生成测试脚本
- **Execute** — 运行测试，失败交 healer 自动修复
- **Report** — 自动生成 progress.txt、report.md、summary.md，可选邮件通知
- **Publish** — 不是阶段是操作，全部通过后编译打包，上传到 Gitee Release，成功后写入 `publishes[]` 历史

测试执行管线：`planner → generator → healer（按需）`

### 目录结构

```
pm/
├── repository/                    # 外部项目只读克隆（gitignore）
│   ├── README.md                 # 项目注册表（scan.sh 管理）
│   └── <NN-Project>/              # Git clones，禁止修改源码
│       └── .last_hash             # 上次扫描的 commit hash
│
├── test_project/                  # 测试产物（gitignore，仅注册表提交）
│   ├── README.md                 # 测试工程注册表
│   └── <NN-Project>/
│       ├── playwright.config.ts   # 项目级 Playwright 配置（独立 baseURL）
│       ├── vitest.config.ts       # 项目级 Vitest 配置（L2 API 测试）
│       ├── plans/                 # 测试计划（00-test-plan.md + 模块详细计划）
│       ├── case/                  # 用户案例（planner 最高优先读取，禁止覆盖）
│       ├── start.sh               # 一键启动脚本（deployer agent 生成）
│       ├── test-config/
│       │   ├── environment.json   # 环境唯一真实来源（技术栈、端口、凭据、中间件）
│       │   └── auth.json          # 登录认证状态（seed 生成）
│       ├── tests/
│       │   ├── seed.spec.ts       # 登录种子（Planner/Generator/Healer 共享）
│       │   └── {level}/{module}/  # unit/api/e2e/ui 按模块分目录
│       │       └── tc-{编号}-{简称}.spec.ts
│       ├── .pipeline-state.json   # 管线状态（v2：global/modules/publishes）
│       ├── build/                 # 构建部署产物（deployer agent 生成）
│       │   ├── version-log.json   # 构建版本追踪（追加式）
│       │   ├── deploy-config.json # 部署配置快照（可复用）
│       │   ├── nginx.conf         # Nginx 配置
│       │   └── artifacts/         # 构建归档（tar.gz + manifest.json）
│       ├── scan-logs/             # 变更报告（scan.sh 生成）
│       └── results/               # 测试执行结果（按模块分目录）
│           ├── summary.md         # 汇总报告
│           └── <module>/          # progress.txt + report.md + screenshots/
│
├── .claude/
│   ├── rules/                     # 项目规则（00-08，自动加载）
│   ├── agents/                    # Agent 定义
│   │   ├── project-manage-analyzer.md   # Analyzer（环境分析）
│   │   ├── project-manage-deployer.md    # Deployer（验证部署能力）
│   │   ├── project-manage-validator.md  # Validator（启动验证）
│   │   ├── playwright-test-planner.md   # Planner Agent
│   │   ├── playwright-test-generator.md # Generator Agent
│   │   ├── playwright-test-healer.md    # Healer Agent
│   │   └── test-result-publisher.md     # Publisher Agent
│   ├── skills/pm/                 # /pm 项目注册管理 Skill
│   └── scripts/
│       ├── scan.sh               # 仓库扫描脚本
│       ├── runner.sh             # 日常启停服务
│       ├── init-dirs.mjs         # 项目目录初始化（幂等）
│       ├── migrate-pipeline-state.mjs # 管线状态迁移（v1 → v2）
│       ├── generate-report.mjs   # Playwright 报告解析
│       └── notify.mjs            # 测试报告邮件通知
│
├── .mcp.json                      # MCP Server 配置（Playwright + SSH）
├── playwright.config.ts           # Playwright 全局配置（参考模板）
└── package.json                   # Node.js 依赖
```

### Agent 协作

七个专职 Agent 按阶段工作，主会话只负责调度和确认：

| 阶段 | Agent | 职责 | 输出 |
|------|-------|------|------|
| 分析 | **analyzer** | 只读分析源码、推断端口/技术栈/凭据、远程探测 | `environment.json.analyzer.*`、`playwright.config.ts` |
| 构建 | **deployer** | 验证部署能力：编译验证、归档、组装 dev/、远程部署（SSH） | `build/` 下全部产物、`start.sh`、部署验证报告 |
| 验证 | **validator** | 环境验证、健康检查、出具报告 | 环境验证报告、`auth.json` |
| 规划 | **planner** | 优先读 case/ 用户案例，浏览应用，生成测试计划 | `plans/NN-{module}.md`（含 UI Map） |
| 生成 | **generator** | 按计划在浏览器录制操作、生成测试脚本 | `tests/{level}/{module}/tc-*.spec.ts` |
| 修复 | **healer** | 运行失败测试、定位错误、修复并验证（每 TC 最多 3 次） | 修复后的 `.spec.ts` + `results/` |
| 发布 | **publisher** | 编译打包前后端、上传到 Gitee Release | Tag + Release + 附件 |

### 关键设计

- **repository 与 test_project 1:1 对应** — 如 `repository/01-oa-llm` 对应 `test_project/01-oa-llm`
- **repository 只读** — 仅 `git clone` / `git pull`，禁止修改源码
- **case/ 用户案例最高优先** — planner 规划时 case/ > 变更报告 > 自主探索
- **约定大于配置** — 每个项目独立 `playwright.config.ts` + `environment.json`，首次测试时自动生成
- **管线可中断恢复** — `.pipeline-state.json` 记录 v2 状态（global 项目级 + modules 模块级 + publishes 历史），新会话从断点继续；多模块进度独立，互不覆盖
- **测试结果按模块隔离** — 每个模块独立的 `progress.txt`、`report.md`、`screenshots/`，互不覆盖
- **MCP Server 驱动浏览器** — Agent 通过 Playwright MCP Server 控制浏览器，实现录制和回放
- **构建归档不可删除** — `build/artifacts/` 下每次构建的 tar.gz + manifest.json 永久保留

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

### 放入用户案例（可选）

将业务案例文件放入 `test_project/<NN-Project>/case/` 目录，planner 规划时会优先读取：

```
test_project/01-oa-llm/case/
├── 立项管理流程.md       # 任意格式，自由内容
└── 验收标准.txt
```

### 扫描变更

```bash
bash .claude/scripts/scan.sh
```

定时扫描（每 30 分钟）含自动续签，7 天过期前自动重建。

### 执行测试

```bash
# L3/L4 E2E 测试
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts

# L2 API 测试
npx vitest run --config=test_project/<NN-Project>/vitest.config.ts
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 测试框架 | Playwright（E2E/UI）+ Vitest（API） |
| Agent 通信 | MCP Server + Claude Code |
| 远程管理 | SSH MCP（37 个工具） |
| 配置语言 | TypeScript / JSON |
| 扫描脚本 | Bash |
| 版本管理 | Git + Gitee Release |

## 文档

项目规则定义在 `.claude/rules/` 下（自动加载），主要文档：

| 编号 | 文档 | 说明 |
|------|------|------|
| 00 | `00-README.md` | 规则索引：分层结构、管线阶段映射 |
| 01 | `01-pipeline-rules.md` | 管线状态 + 主会话编排：v2 schema、九阶段流程、环境检查、调度管线 |
| 02 | `02-project-rules.md` | 项目结构、目录规范、注册表双写、文件保护 |
| 03 | `03-analyzer-rules.md` | analyzer：本地分析 + 远程探测、端口/技术栈/凭据推断 |
| 04 | `04-deployer-rules.md` | deployer：验证部署能力（编译验证+归档+远程部署） |
| 05 | `05-validator-rules.md` | validator：环境验证 + 健康检查 + 环境验证报告 + runner 工具 |
| 06 | `06-planner-rules.md` | planner：TC 编号、计划分层、用户案例优先级、Seed 生成 |
| 07 | `07-generator-rules.md` | generator：直接生成/录制模式、等待策略、断言约束 |
| 08 | `08-healer-rules.md` | healer：修复流程、结果更新、progress/report 规范 |

## 许可

ISC
