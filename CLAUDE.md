# CLAUDE.md

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
│       ├── case/              # 用户案例（planner 优先读取，禁止覆盖）
│       ├── test-config/       # environment.json + auth.json
│       ├── tests/             # api/{module}/ + e2e/{module}/ + seed.spec.ts
│       ├── .pipeline-state.json # 管线状态（global/modules/publishes）
│       ├── build/             # 构建部署产物
│       │   ├── artifacts/     # 归档（不可删除）
│       │   └── dev/           # 完整部署包
│       ├── scan-logs/         # 变更报告
│       └── results/           # 测试结果（按模块分目录）
├── .claude/
│   ├── rules/                 # 自动加载（00-08 + references/）
│   ├── agents/                # Agent 定义
│   ├── skills/pm/             # /pm Skill
│   └── scripts/               # scan.sh, init-dirs.mjs, pipeline-state.mjs 等
├── .mcp.json                  # MCP Server 配置（Playwright + SSH）
└── playwright.config.ts       # 全局配置（参考模板）
```

## Project Configuration

每个项目的配置文件（由 analyzer/deployer/validator 三段 agent 生成）：

| 文件 | 说明 |
|------|------|
| `playwright.config.ts` | 项目级 Playwright 配置（独立 baseURL、JSON reporter、setup/chromium 双 project） |
| `vitest.config.ts` | 项目级 Vitest 配置（L2 API 测试） |
| `test-config/environment.json` | 环境唯一真实来源（端口、凭据、技术栈、中间件、启动命令、healthCheck、dbConfig、login） |
| `test-config/auth.json` | 登录认证状态（seed.spec.ts 生成） |
| `tests/seed.spec.ts` | 登录种子文件（Planner/Generator/Healer 共享） |
| `case/` | 用户案例（planner 最高优先读取，**禁止覆盖**） |
| `.pipeline-state.json` | 管线状态（global + modules + publishes） |
| `build/artifacts/` | 构建归档（不可删除） |

`environment.json` 是唯一真实来源，`playwright.config.ts` 的 `baseURL` 必须与其一致。

## Agent Pipeline

```
Detect → Analyze → Build → Validate → Plan → Generate → Execute → Report → Publish
 扫描    分析     构建    验证      规划    生成      执行      汇报      发布
```

- **Detect / Analyze / Build / Validate** — 项目级（`global`）
- **Plan / Generate / Execute / Report** — 模块级（`modules.<name>`），按模块独立追踪
- **Publish** — 不是阶段是操作，成功后追加到 `publishes[]`

测试执行管线：`planner → generator → healer（按需）`（按模块串行）

环境配置管线：`analyzer → [主会话问 buildMode] → deployer (按 mode 分支) → validator`

构建发布管线：`Report → 用户确认 → publisher（编译打包 + 打 Tag + 上传 Gitee Release）`

### 主会话职责

主会话 **不直接编写或调试测试代码**，只做调度和确认：

1. 接收任务 → 环境检查（三层：analyzer/build/validate 缺失则启动对应 agent）
2. Analyze 完成后询问构建模式（local/remote），写 `environment.json.build.mode`
3. 启动 planner → 优先读 `case/` → 审阅计划 → 用户确认 → 启动 generator
4. 运行测试 → 有失败启动 healer
5. 汇总结果（运行 `generate-report.mjs`）→ 向用户汇报
6. 全部通过后**必须主动询问**是否发布

### 关键约束

- **宿主环境**：`SETUP.md`（Node.js / Playwright / SSH 等安装指南）
- **环境检查**：每次测试前三层检查 + 确认服务运行（healthCheck）
- **case/ 优先级**：用户案例 > 变更报告 > 自主探索
- **规则索引**：`.claude/rules/00-README.md`
- **Agent 详情**：`docs/agents.md`

## Commands

```bash
# 仓库扫描
bash .claude/scripts/scan.sh [<项目名>]

# 项目目录初始化（幂等）
node .claude/scripts/init-dirs.mjs --project <NN-Project>

# 管线状态初始化（幂等，导出 readState / updateStage / appendPublish）
node .claude/scripts/pipeline-state.mjs --project <NN-Project>

# 测试执行
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
npx vitest run --config=test_project/<NN-Project>/vitest.config.ts

# 测试报告生成
node .claude/scripts/generate-report.mjs --project <NN-Project>

# 测试报告邮件通知
node .claude/scripts/notify.mjs --project <NN-Project>
```

项目注册使用 `/pm` Skill（add/del/list/track）。

## Git Conventions

- 提交信息用中文，简洁描述变更目的
- `repository/`、`test_project/` 测试产物、`.omc/`、`node_modules/`、`*.log`、`.claude/test-artifacts/` 已 gitignore
- `.claude/scheduled_tasks.json` **提交到版本库**
