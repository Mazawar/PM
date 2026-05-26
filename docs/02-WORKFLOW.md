# Agent 测试交互流程规范

## 七阶段流程

```
Detect → Setup → Analyze → Plan → Generate → Execute → Report
 扫描     配置     分析      规划    生成      执行      汇报
```

### 阶段一：Detect 变更检测

**触发条件**: `scan.sh` 定时或手动执行

**职责**:
1. 拉取所有注册项目的最新代码
2. 对比上次 hash，检测新提交
3. 生成变更报告到 `test_project/<NN>/reports/`

### 阶段二：Setup 环境配置（仅首次）

**触发条件**: 用户首次要求测试某项目，检测到 `playwright.config.ts` 不存在

**职责**（Setup Agent）：
1. 分析仓库源码，识别技术栈（前端框架、后端框架、数据库、中间件）
2. 从配置文件自动推断端口（vite.config.ts、.env、application.yml 等）
3. 生成环境配置文件：
   - `playwright.config.ts` — 项目级 Playwright 配置，独立 baseURL
   - `test-config/environment.json` — 端口、凭据、技术栈、中间件、启动命令、健康检查
   - `start.sh` — 一键启动脚本（端口检查 + 健康检查）
4. 验证环境（服务可达性、页面加载、登录验证）
5. 输出 `SETUP.md` 启动报告

**约定大于配置**：端口信息优先从源码推断，推断不了再询问用户。

### 阶段三：Analyze 变更分析

**触发条件**: 扫描脚本检测到新提交并生成报告

**Agent 职责**:
1. 读取 `reports/` 下最新报告
2. 分析变更内容，写入 `summary.md`
3. 根据变更内容判断影响的测试层级

**输出**: `summary.md` 包含变更概述、影响范围、测试建议、潜在风险

### 阶段四：Plan 测试计划

**触发条件**: 变更分析完成 或 用户直接指定测试任务

**Agent 职责**:
1. 基于 `summary.md` 或用户需求生成测试计划
2. 写入 `test-config/test-plan.md`（模块索引）和 `test-config/plans/{module}.md`（详细步骤）
3. 每个场景分配 **TC-XXX** 编号（全局唯一，跨层级连续）
4. 向用户展示计划并等待确认

**测试计划格式**:

```markdown
# 测试计划 - <项目名称>

## Application Overview
（项目描述、技术栈、被测地址、登录凭证）

## 模块索引

| 模块 | 计划文件 | TC 范围 | 用例数 | 优先级 |
|------|---------|---------|--------|--------|

## Test Scenarios（详细步骤在各模块计划文件中）
```

**用户交互**: 向用户展示测试计划，确认后进入生成阶段。

### 阶段五：Generate 生成测试用例

**触发条件**: 用户确认测试计划

**Agent 职责**:
1. 使用 `playwright-test-generator` agent 按计划生成测试代码
2. 测试代码写入 `tests/e2e/` 或 `tests/ui/` 对应目录
3. 向用户展示用例概览

**失败处理**: 生成后首次运行若有失败，委托 `playwright-test-healer` 修复，不在主会话手动调试。

### 阶段六：Execute 执行测试

**触发条件**: 用户确认测试用例

**环境检查（每次测试前，强制）**:
1. 读取 `test-config/environment.json` 中的 `healthCheck`
2. 用 curl 检查服务是否在运行
3. 未通过 → 提示用户先启动服务（`bash test_project/<NN>/start.sh`）

**执行命令**:
```bash
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

**输出结构（强制）**:

测试结果按**功能模块**分目录存放，互不覆盖：

```
results/
├── summary.md                      # 汇总报告（聚合所有模块）
├── user-management/                # 用户管理模块
│   ├── progress.txt                # TC-001~TC-007 进度
│   ├── report.md                   # 用户管理详细报告
│   └── screenshots/                # 用户管理截图
├── role-management/                # 角色管理模块
│   ├── progress.txt
│   ├── report.md
│   └── screenshots/
└── <module-name>/
    ├── progress.txt
    ├── report.md
    └── screenshots/
```

**关键规则**：
- 测试新模块 → 创建新目录，不删除已有模块结果
- 重新测试同一模块 → 覆盖该模块结果，其他模块不受影响
- 截图只能引用同模块同目录下的文件，禁止跨模块复用

**执行约束**：
- 每次迭代最多执行 5 个用例
- 优先按 TC 编号顺序
- 每完成一个用例立即追加 progress.txt
- 所有操作通过浏览器 UI，禁止直接调 API
- 禁止跳过用例（除页面 404 / 功能未实现等客观原因）

### 阶段七：Report 结果汇报

**Agent 职责**:
1. 更新各模块 `report.md` 和 `results/summary.md`
2. 向用户展示测试结果概要
3. 失败用例附上截图和错误详情

**用户决策点**:
- 全部通过 → 结束 或 提交 issue
- 有失败 → healer 修复 / 记录 issue / 调整用例

---

## Agent 调度管线

```
planner → generator → healer（按需）
  规划      生成       修复
```

- Setup Agent 由环境检查流程触发（无配置时自动启动，已配置则跳过）
- Agent 始终 **先提议，等用户确认** 后再执行
- 主会话 **不直接编写或调试测试代码**，只做调度和确认

---

## 异常处理

| 场景 | 处理方式 |
|------|---------|
| 测试环境无法启动 | 记录错误，报告用户，等待用户配置 |
| 服务未运行 | 提示用户先启动服务（`bash test_project/<NN>/start.sh`） |
| 测试框架未安装 | 自动安装（需用户确认），或提示用户手动安装 |
| 外部依赖不可用 | 跳过依赖该服务的用例，标记为 SKIP |
| 执行超时 | 单个用例超时 5 分钟自动终止，标记为 ERROR |
| TimeoutError | 必须委托 healer agent，禁止主会话逐步排查 |
