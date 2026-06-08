# 管线状态持久化（强制）

## 核心理念

九阶段流程不是一次性执行的线性脚本，而是一个**可中断、可恢复**的状态机。主会话崩溃或用户中断后，新的会话应能从断点继续，而不是从头开始。

v2 schema 把状态拆为三段：
- **global** — 项目级一次性阶段（Detect/Analyze/Build/Validate），整个项目只跑一次
- **modules** — 按测试模块分（每个模块独立 Plan/Generate/Execute/Report），互不覆盖
- **publishes** — 发布历史（append-only 数组），与阶段正交，记录每次发布覆盖的模块

这样多模块并行/迭代时，不同模块的进度独立追踪，不再因为切换模块而丢失另一个模块的进度。

## 状态文件

```
test_project/<NN-Project>/.pipeline-state.json
```

### Schema (v2)

```json
{
  "schemaVersion": 2,
  "project": "<NN-Project>",
  "updatedAt": "<ISO 时间戳>",
  "global": {
    "Detect":   { "status": "pending|running|completed|failed|skipped", "at": "...", "reason": "...", "output": "..." },
    "Analyze":  { "status": "...", "at": "...", "reason": "...", "output": "..." },
    "Build":    { "status": "...", "at": "...", "reason": "...", "output": "..." },
    "Validate": { "status": "...", "at": "...", "reason": "...", "output": "..." }
  },
  "modules": {
    "<module-name>": {
      "Plan":     { "status": "...", "at": "...", "approvedBy": "user", "approvedAt": "...", "tcRange": "TC-001 ~ TC-018" },
      "Generate": { "status": "...", "at": "...", "tcCount": 23, "mode": "direct-generation|recording" },
      "Execute":  { "status": "...", "at": "...", "lastRunAt": "..." },
      "Report":   { "status": "..." }
    }
  },
  "publishes": [
    {
      "id": 1,
      "version": "v1.0.0",
      "modules": ["role-management"],
      "commit": "f59a24c",
      "archive": "build/v1.0.0.tar.gz",
      "parts": ["v1.0.0.tar.gz.part-aa", "v1.0.0.tar.gz.part-ab"],
      "releasedAt": "2026-05-28T17:00:00+08:00",
      "releaseUrl": "https://gitee.com/xxx/releases/tag/v1.0.0"
    }
  ]
}
```

### 阶段名称映射

| 作用域 | 阶段 | 备注 |
|--------|------|------|
| global | `Detect`   | scan.sh 执行结果 |
| global | `Analyze`  | 项目环境分析（analyzer agent）：源码/端口/凭据/中间件推断，写 environment.json.analyzer.* |
| global | `Build`    | 部署验证（deployer agent）：编译验证+归档+组装 dev/；remote 模式额外+远程部署 |
| global | `Validate` | 环境验证（validator agent）：启动服务 → 健康检查 → 出环境验证报告 |
| modules | `Plan`     | 模块测试计划 |
| modules | `Generate` | 测试代码生成 |
| modules | `Execute`  | 测试执行 |
| modules | `Report`   | 报告生成 |
| (独立) | `publishes` | 不是阶段，是发布历史数组 |

## 模块名约定（强制）

**模块名是 `modules` 对象的 key**，来源是 `plans/NN-{name}.md` 文件去掉 `NN-` 序号：

- `01-role-management.md` → key 为 `role-management`
- `02-user-management.md` → key 为 `user-management`

**plans 目录是模块名的唯一真源**。不要在状态文件、scan-logs、summary 中独立维护模块列表。

## progress.txt 与 pipeline-state 的边界（强制）

**职责分离，避免双源**：

| 数据 | 持有方 | 说明 |
|------|--------|------|
| TC 级用例进度（PASS/FAIL/SKIP） | `results/{module}/progress.txt` | 用例级 |
| 模块在管线中的位置 | `modules.<name>.Plan/Generate/Execute/Report.status` | 流程级 |
| 模块最近一次执行时间 | `modules.<name>.Execute.lastRunAt` | 流程级辅助信息 |
| 发布历史 | `publishes[]` | 流程级，独立维度 |

**禁止**在 pipeline-state 中存：
- 具体 TC 编号（如 `currentTc: "TC-005"`）— 那是 progress.txt 的职责
- 用例 PASS/FAIL 计数 — 那是 progress.txt 解析的产物
- 重试次数 — healer 内部状态，不持久化到文件

## publishes 段（强制）

**不是阶段** — 是发布历史记录，与 Detect/Analyze/Build/Validate/Plan/Generate/Execute/Report 正交。

### 字段约定

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 自增 | append 时自动生成 |
| `version` | 用户输入 | SemVer 字符串（如 `v1.0.0`） |
| `modules` | 当前已完成的模块列表 | 此次发布覆盖的测试模块 |
| `commit` | `repository/<NN-Project>` HEAD 的短 hash（`git rev-parse --short HEAD`） | publisher 获取 |
| `archive` | 发布包文件名 | 格式：`<VERSION>.tar.gz`（如 `v0.0.2.tar.gz`），不包含分片后缀 |
| `parts` | 分片文件列表 | publisher 写入，如 `["v0.0.2.tar.gz.part-aa", "v0.0.2.tar.gz.part-ab"]`；单文件（未分包）时为空数组 |
| `releasedAt` | 实际发布时间 | ISO 时间戳 |
| `releaseUrl` | Gitee Release 链接 | publisher 写入 |

### 写入规则

- **append-only** — 永不修改、删除已有记录
- 仅在 publisher 成功发布到 Gitee Release 后写入
- 主会话通过 `appendPublish()` 函数追加
- 模块列表基于"哪些模块的 Execute + Report 都已完成"

## 状态转换规则

### 正常流程

```
pending → running → completed
                  → skipped（附 reason）
```

### 失败处理

```
running → failed（附 reason）
```

**失败后的传播规则**：

| 失败作用域/阶段 | 影响 | 处理 |
|----------------|------|------|
| global.Analyze  | 阻断后续所有阶段 | 主会话向用户报告，等待指示 |
| global.Build    | 阻断后续所有阶段 | 主会话向用户报告，等待指示 |
| global.Validate | 不阻断后续 Plan/Generate/Execute | 提示用户：本地服务未起，可重跑 Validate 或继续测试 |
| modules.<name>.Plan | 仅阻断该模块的 Generate | 重新规划或调整范围 |
| modules.<name>.Generate | 仅阻断该模块的 Execute | 修复后重试 |
| modules.<name>.Execute | 进入该模块的 Report（含失败数据）| 不阻断，Report 正常生成 |
| modules.<name>.Report | 不阻断后续 | 必须生成，即使全部失败 |

**多模块独立**：模块 A 的失败不影响模块 B 的进度。各模块独立判断和恢复。

## 阶段可见性（与规则 06 一致）

主会话进入或跳过阶段时，**必须同步更新** `pipeline-state.json` 并输出标记。

**global 阶段**：

```
## Detect — 扫描项目变更                 → status: "running" → "completed"
## Analyze — 跳过（已配置）              → status: "skipped"
## Build — 跳过（已构建）                → status: "skipped"
## Validate — 跳过（已验证）             → status: "skipped"
```

**modules 阶段**（按模块分）：

```
## role-management / Plan — 创建测试计划    → status: "completed"
## role-management / Generate — 生成测试代码  → status: "completed"
## role-management / Execute — 执行测试       → status: "running"
## role-management / Report — 生成测试报告    → status: "pending"
## user-management / Plan — 创建测试计划      → status: "pending"
```

## 主会话启动流程

1. **调用 migration 脚本**：
   ```bash
   node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project>
   ```
   - 文件不存在 → 自动创建 v2 模板
   - v1 文件 → 备份为 `.pipeline-state.v1.bak.json`，写入 v2 模板（旧状态不还原）
   - v2 文件 → 跳过
2. 读取 v2 文件，定位当前焦点：
   - `global` 中如有 `running` 状态 → 从该 global 阶段继续
   - 否则扫描 `modules`，找到**最早**的非 completed 阶段所在模块作为当前焦点
3. 输出当前焦点状态：
   ```
   ## Current Focus
   - Global: <Detect|Analyze|Build|Validate> = <status>（或 all completed）
   - Modules:
     - role-management: Plan ✓ / Generate ✓ / Execute [running] / Report
     - user-management: Plan [pending] / Generate / Execute / Report
   ```
4. 等待用户指示或继续执行

## 测试流程入口闸门（部署验证）

**部署验证（global.Build）和环境验证（global.Validate）共同构成测试流程的第一道闸门**，决定是否进入端到端测试：

```
扫描 → Analyze → Build → Validate ← 第一道闸门
                                  ├─ 全 PASS → 进入端到端测试（modules.<name>）
                                  └─ 有 FAIL（上游问题）→ 打回，不进入端到端
```

**主会话调度规则**：

1. Validate 阶段（validator agent）完成后，**必须**分别检查：
   - `results/.build/deploy/progress.txt`（deployer 输出 DEPLOY-001~010）
   - `results/.build/env/progress.txt`（validator 输出 ENV-001~004）
   - 两份全 PASS → 主会话可启动 planner
   - 任一 FAIL（归因为上游）→ **不**启动 planner，出具打回报告
   - 任一 FAIL（归因为平台）→ 平台侧修复后重跑对应阶段
2. 端到端测试通过后，**主会话主动询问**用户是否发布（不变）
3. `results/.build/` 下有**三份独立报告**：
   - 部署验证报告：`results/.build/deploy/report.md`（deployer 出，验证上游产物能不能跑）
   - 环境验证报告：`results/.build/env/report.md`（validator 出，验证环境能不能用）
   - 业务测试报告：`results/{module}/report.md`（验证跑起来的应用业务对不对）
4. `results/summary.md` 由 `generate-report.mjs` 合并三者统计

**关键不变量**：
- 部署验证不通过 = 上游问题，不替上游修
- 部署验证和环境验证是**两条独立管线**，互不阻断对方的报告产出

## migration 流程

### v1 → v2 破坏性升级

- **触发**：脚本检测到 `schemaVersion` 字段缺失
- **动作**：
  1. 备份 v1 文件为 `test_project/<NN-Project>/.pipeline-state.v1.bak.json`
  2. 扫描 `tests/{e2e,ui}/` 子目录，自动填充 `modules` key（仅创建空 stage 模板，**不猜状态**）
  3. `publishes` 初始化为空数组
  4. `global` 四个阶段都是 `pending`
- **不还原**：v1 的旧状态不迁移到 v2（用户已确认走破坏性升级）

### migration 脚本

位置：`.claude/scripts/migrate-pipeline-state.mjs`

CLI 用法：
```bash
node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project>
node .claude/scripts/migrate-pipeline-state.mjs --project <NN-Project> --dry-run
```

ESM 导入（供其他脚本使用）：
```js
import { readState, updateStage, appendPublish } from './migrate-pipeline-state.mjs';
```

## 状态文件管理

- **创建时机**：migrate 脚本检测到文件不存在时自动创建
- **更新时机**：每个阶段开始和结束时（主会话负责）
- **清理时机**：用户确认开始新一轮测试时，由主会话通过 `updateStage()` 重置（不要直接重写整个文件）
- **禁止删除**：v2 文件本身禁止删除
- **不提交 git**：v2 文件已 gitignore（运行时状态，不属于版本库）
- **v1 备份文件**：`.pipeline-state.v1.bak.json` 由 `test_project/*` 通配忽略

## 九阶段流程详细描述

```
Detect → Analyze → Build → Validate → Plan → Generate → Execute → Report → Publish
 扫描    分析     构建    验证      规划    生成      执行      汇报      发布
```

1. **Detect** — `scan.sh` 检测变更，生成报告到 `test_project/<NN-Project>/scan-logs/`
2. **Analyze** — `project-manage-analyzer` agent 读仓库源码、推断技术栈/端口/中间件/凭据，写 `environment.json.analyzer.*` 段、生成 `playwright.config.ts`、初始化目录
3. **Build** — 主会话询问构建模式（local | remote）→ 写 `environment.json.build.mode` → 启动 `project-manage-deployer` agent 验证部署能力
4. **Validate** — 启动 `project-manage-validator` agent：启动服务 → 健康检查 → 页面验证 → 登录验证 → 出环境验证报告
5. **Plan** — planner agent 生成测试计划（优先读取 `case/` 目录中的用户案例），**用户多轮确认与调整**后才进入 Generate
6. **Generate** — generator agent 生成测试代码，**用户确认**
7. **Execute** — 运行测试，失败交 healer agent
8. **Report** — 主会话汇总结果，向用户汇报
9. **Publish** — Report 全部通过后，主会话**必须主动询问**用户是否发布；用户确认后启动 publisher agent

## 主会话职责（强制）

主会话 **不直接编写或调试测试代码**，只做：

1. 接收任务 → 环境检查（三层：analyzer 缺失 → `project-manage-analyzer`；build 缺失 → `project-manage-deployer`；validate 缺失 → `project-manage-validator`；三层都就绪才跳过）
2. **构建模式选择** — Analyze 完成后用 `AskUserQuestion` 询问"本地构建还是远程部署？"
3. 启动 planner → 检查 `case/` → 审阅计划 → **向用户展示并请求确认** → 确认后启动 generator
4. 首次运行测试 → 跑测试 → 解析结果 → 有失败则启动 healer
5. 汇总结果 → 向用户汇报
6. **Publish 询问** — 所有模块 Report 通过后，必须主动询问"是否发布"

**关键**：测试运行出现 **TimeoutError** → **必须委托 healer**，禁止主会话逐步排查。

## 测试前环境检查（强制）

### 基础检查（所有场景）

1. 调用 `migrate-pipeline-state.mjs --project <NN-Project>` 初始化/读取 v2 状态
2. 检查 `playwright.config.ts` 和 `environment.json` 是否存在
3. **analyzer 缺失** → 启动 `project-manage-analyzer` → 完成后 `updateStage('global', null, 'Analyze', { status: 'completed' })`
4. **build 缺失** → 启动 `project-manage-deployer` → 完成后 `updateStage('global', null, 'Build', { status: 'completed' })`
5. **validate 缺失** → 启动 `project-manage-validator` → 完成后 `updateStage('global', null, 'Validate', { status: 'completed' })`
6. **三层都就绪** → 读取 `healthCheck` → curl 检查服务
7. 服务未运行 → 启动 `project-manage-validator`

## Report 阶段（强制）

测试运行完成后，无论通过或失败，**必须**生成结果文件：

```bash
node .claude/scripts/generate-report.mjs --project <NN-Project>
```

生成 `results/{module}/progress.txt`、`results/{module}/report.md`、`results/summary.md`。

**禁止空结果**：即使全部通过也必须生成。

## Agent 调度管线

测试执行管线：`planner → generator → healer（按需）`

构建发布管线：`Report → 用户询问 → publisher`

- **项目编号传递**：主会话启动 Agent 时**必须**传递项目编号和关键路径
- **项目编号验证**：Agent 启动后必须首先确认项目编号有效
- 测试运行必须使用项目级配置：`npx playwright test --config=test_project/<NN-Project>/playwright.config.ts`

## 用户确认点

| 阶段 | 确认内容 |
|------|---------|
| Build+Validate 后（remote） | baseURL 变更 |
| Analyze 后 | analyzer 字段完整性 |
| Build 前 | 构建模式（local / remote） |
| Build 后 | 部署验证结果 |
| Validate 后 | baseURL |
| Plan 后 | 测试计划（可多轮调整） |
| Generate 后 | 测试代码 |
| Report 后 | 全通过 → 是否发布；有失败 → 是否修复 |
| Publish | 确认发布到 Git Release |

## Agent 联动

主会话启动 Agent 时，在 prompt 中传递当前焦点信息：

```
当前管线状态：
- Global: Analyze ✓ / Build ✓ / Validate [running]
- Current module focus: role-management
  - Plan: completed (approvedBy: user, tcRange: TC-001~TC-018)
  - Generate: completed (mode: direct-generation)
  - Execute: running
  - Report: pending
管线状态文件：test_project/01-oa-llm/.pipeline-state.json
```

Agent 不读写状态文件，仅主会话负责状态管理。Agent 执行完毕后，主会话根据 Agent 输出调用 `updateStage()` 更新对应阶段。
