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
│   ├── templates/             # 测试用例模板（L1-L4）
│   └── <NN-Project>/
│       ├── test-config/       # 测试计划、环境配置
│       │   ├── test-plan.md   # 总计划（模块索引）
│       │   └── plans/         # 按模块拆分的详细计划
│       ├── tests/             # 测试代码（{module}-{scenario}.spec.ts）
│       ├── reports/           # 变更报告 + summary.md
│       └── results/            # 测试执行结果（按模块分目录）
│           ├── summary.md     # 汇总报告
│           └── <module>/      # progress.txt + report.md + screenshots/
├── docs/                      # 项目文档
│   ├── 00-README.md           # 文档索引
│   ├── 01-TESTING.md          # 测试框架规则
│   └── 02-WORKFLOW.md         # Agent 交互流程
├── .claude/
│   ├── agents/                # Playwright Agent 定义
│   │   ├── playwright-test-planner.md    # 阶段二：测试计划生成
│   │   ├── playwright-test-generator.md  # 阶段三：测试代码生成
│   │   └── playwright-test-healer.md     # 阶段四：失败测试修复
│   ├── scripts/scan.sh        # 仓库扫描脚本
│   ├── test-artifacts/        # Playwright 运行时产物（trace、截图）
│   └── scheduled_tasks.json   # 定时任务配置（提交到版本库）
├── .mcp.json                  # Playwright MCP Server 配置
├── playwright.config.ts       # Playwright 全局配置
└── package.json               # Node.js 依赖（@playwright/test）
```

### Key Invariants

- `repository/` 与 `test_project/` 条目 1:1 对应（如 `01-RuoYi-Vue`）
- `repository/` 只读 — 仅 `git clone` / `git pull`，禁止修改源码
- 所有测试代码和产物在 `test_project/` 下
- 仅注册表文件（READEME.md）、docs、templates、scripts、agent 定义、配置文件提交到版本库

## Agent Pipeline

测试任务由三个专用 Agent 分阶段完成，主会话只负责调度和确认：

```
planner → generator → healer（按需）
  规划        生成        修复
```

### playwright-test-planner
- **职责**: 浏览被测应用，探索页面结构和交互流程
- **输出**: 两层计划文件，严格分离：
  - `test-config/test-plan.md` — **总计划索引**（Application Overview + 模块索引表），禁止写详细步骤
  - `test-config/plans/{module}.md` — **模块详细计划**（TC 编号、Steps、expect），所有详细内容只在这里
- **触发**: 用户确认测试任务后

### playwright-test-generator
- **职责**: 按照已确认的测试计划，在浏览器中录制操作，生成测试脚本
- **输出**: `tests/<层级>/` 下的 `.spec.ts` 文件
- **触发**: 测试计划确认后

### playwright-test-healer
- **职责**: 运行失败的测试、定位错误原因、修复代码、验证通过
- **触发**: 测试脚本运行失败时自动启用，**不要在主会话中手动调试**
- **关键**: 测试生成后首次运行若失败，必须委托 healer 而非主会话逐步排查

### 主会话职责

主会话 **不直接编写或调试测试代码**，只做：
1. 接收任务 → 启动 planner
2. 审阅计划 → 确认后启动 generator
3. 首次运行测试 → 有失败则启动 healer
4. 汇总结果 → 向用户汇报

## Commands

### 仓库扫描

```bash
bash .claude/scripts/scan.sh          # 扫描所有项目变更
```

脚本流程：
1. 解析 `repository/READEME.md` 中 `<!-- projects-start -->` / `<!-- projects-end -->` 标记内的项目列表
2. 缺失的仓库自动 clone，已有的执行 pull
3. 通过 `.last_hash` 文件比较检测新提交
4. 生成变更报告到 `test_project/<project>/reports/<timestamp>.md`

### 项目注册

新项目必须同时添加到 `repository/READEME.md` 和 `test_project/READEME.md` 的 `<!-- projects-start -->` / `<!-- projects-end -->` 块内：

```
| NN-Name | ./NN-Name | https://repo-url | Git |
```

不要在标记外添加内容 — 扫描脚本只解析标记内的区域。

### 测试执行

```bash
npx playwright test test_project/<NN-Project>/tests/ --project=chromium
```

Playwright 运行时产物（trace、失败截图）输出到 `.claude/test-artifacts/`，不污染项目根目录。有意义的测试报告由 Agent 整理写入 `test_project/<项目>/results/`。

## Testing Framework

详见 `docs/01-TESTING.md`。要点：

- **4 级测试**: L1 (unit) → L2 (API) → L3 (E2E) → L4 (UI)
- **框架选择**: 优先使用项目已有测试框架，否则按 01-TESTING.md 映射表推荐
- **测试 ID**: `TP-<project>-L<level>-<NNN>`（脚本文件），`TC-XXX`（计划与报告）
- **执行顺序**: L1 全量 → L2/L3/L4 仅变更模块

### 执行输出结构（强制）

测试结果按**功能模块**分目录存放，互不覆盖：

```
results/
├── summary.md                  # 汇总报告（聚合所有模块结果）
├── user-management/            # 按模块分目录
│   ├── progress.txt            # TC 进度追踪
│   ├── report.md               # 模块详细报告
│   └── screenshots/            # 模块截图（禁止跨模块引用）
├── role-management/
│   ├── progress.txt
│   ├── report.md
│   └── screenshots/
└── <module>/                   # 更多模块...
```

- `progress.txt` 每模块独立，格式 `TC-XXX:PASS/FAIL/SKIP`
- `report.md` 每模块独立，按 `docs/02-WORKFLOW.md` 阶段四格式
- 截图每用例至少 3 张，**只能引用同模块目录**，禁止跨模块复用
- `summary.md` 汇总所有模块通过率，每次测试后更新
- 测试文件命名必须含模块前缀：`{module}-{scenario}.spec.ts`

### 测试文件命名

```
tests/e2e/user-lifecycle.spec.ts        # 用户管理 - 生命周期
tests/e2e/role-search.spec.ts           # 角色管理 - 搜索筛选
tests/ui/user-form-ui.spec.ts           # 用户管理 - 表单 UI
```

### Playwright 配置

- 全局配置: `playwright.config.ts`（项目根目录）
- MCP Server: `.mcp.json` 启动 `playwright run-test-mcp-server`
- 默认项目: `chromium`，headless 模式
- 超时: 60s

### RuoYi-Vue 已知模式

测试 RuoYi-Vue（Spring Boot + Vue + Element UI）时注意：
- 后端 API: `http://localhost:8080`，前端: `http://localhost:80`
- 登录用 API 方式（`POST /login` → 设置 `Admin-Token` cookie），不用 UI 登录
- Element UI 的 dialog 在 DOM 中持久存在，需用 `getDialog(page, title)` 按标题过滤
- `$prompt` 弹窗与 Playwright 不兼容，重置密码等操作改用 API
- 成功消息用宽泛匹配：`/成功/`

## Agent Workflow

详见 `docs/02-WORKFLOW.md`。核心流程：

1. **Detect** — scan.sh 检测变更，生成报告
2. **Analyze** — Agent 读取报告，写 `summary.md`
3. **Plan** — planner agent 生成测试计划，用户确认
4. **Generate** — generator agent 生成测试代码，用户确认
5. **Execute** — 运行测试，失败交 healer agent 修复
6. **Report** — 汇总结果，反馈给用户

Agent 始终 **先提议，等用户确认** 后再执行。未经用户批准不自动执行测试。

## Git Conventions

- 提交信息用中文，简洁描述变更目的
- `repository/` 内容和 `test_project/` 测试产物已 gitignore
- `.claude/scheduled_tasks.json` **提交到版本库**（共享定时配置）
- `.omc/`、`node_modules/`、`*.log`、`.claude/test-artifacts/`、`.playwright-mcp/`、`.claude/scheduled_tasks.lock` 已 gitignore
