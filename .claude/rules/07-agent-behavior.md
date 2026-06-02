# Agent 行为约束规则

本文件定义 planner、generator、healer 的行为约束。
remote-env-setup 的约束已提取至 `.claude/rules/08-remote-deployment.md`。
Agent 定义文件（`.claude/agents/`）包含职责和工作流程，本文件补充强制约束。

---

## 浏览器会话管理（所有 Agent 通用，强制）

### 不假设浏览器状态

- Agent 启动时**必须**先调用 `browser_navigate` 导航到目标 URL（完整路径如 `http://localhost:{port}/login`，端口从 environment.json 获取）
- **禁止**假设浏览器处于任何特定页面（可能是 about:blank、登录页、或上一次操作的残留页）
- 即使 `setup_page` 已调用，也要在后续操作前确认页面 URL 正确

### 登录流程

- 每个需要认证的 Agent 必须自行完成登录，不依赖之前的会话状态
- 登录步骤：navigate → fill 账号 → fill 密码 → click 登录 → waitFor URL/dashboard
- 使用 `getByRole('textbox', { name: 'placeholder文字' })` 定位输入框，**不要**用 ref 编号（ref 会随页面刷新变化）

### 页面状态确认

- 在关键操作前用 `browser_snapshot` 确认当前页面状态（页面跳转后、弹窗出现/关闭后、操作结果不确定时）
- 不需要每步操作都 snapshot，避免不必要的开销
- 如果页面 URL 与预期不符，先 `browser_navigate` 修正再继续
- 遇到 about:blank → 立即 navigate 到目标 URL，不要尝试其他操作

---

## 循环防护（所有 Agent 通用，强制）

### 失败退避规则

- **同一操作**（相同工具 + 相同 target/selector）连续失败 **3 次** → 必须换策略（换 selector、换工具、跳过该步骤）
- **同一目标**（同一意图，如"点击登录按钮"）连续失败 **5 次** → 立即中止当前步骤，报告失败原因给主会话，**禁止继续重试**
- **总工具调用失败** 达到 **10 次** → 终止整个 Agent 执行，输出失败摘要

### 策略切换要求

- 元素定位失败时，必须按以下顺序尝试不同策略，**禁止连续两次使用相同策略**：
  1. role + name（如 `getByRole('textbox', { name: '...' })`）— 语义定位，最稳定
  2. placeholder / label（如 `getByPlaceholder('...')`）— 表单元素首选
  3. text content（如 `getByText('...', { exact: true })`）— 按钮/链接适用
  4. CSS selector（如 `input[data-testid="..."]`）— 前三种都不行时使用
  5. ref 精确引用（如 `e16`）— **最后手段**，ref 在页面刷新后会变化
  6. 跳过该步骤，在输出中标记为"未能定位"

### 操作超时

- 单个工具调用等待不超过 **30 秒**
- 页面加载等待不超过 **15 秒**
- 超时即视为失败，触发退避规则

### 失败报告格式

中止时必须输出结构化报告：
```
## Agent 执行失败
- 阶段：<当前执行阶段>
- 失败步骤：<步骤描述>
- 失败原因：<具体原因>
- 已尝试策略：<列举已尝试的定位/操作方式>
- 建议主会话：<修复建议>
```

---

## planner 约束

### TC 编号管理（强制）

- TC 编号 **全局唯一**，跨模块连续递增
- 生成前先读取 `00-test-plan.md`，确认已用最大编号，从下一个开始
- 每个模块分配编号范围，记录在总计划索引
- 预留编号间隙便于后续新增

### 计划分层（强制）

- `test_project/<NN-Project>/plans/00-test-plan.md` — **仅** Application Overview + 模块索引表
- `test_project/<NN-Project>/plans/NN-{module}.md` — **所有**详细内容（TC 步骤、expect），NN 为两位序号
- 禁止在总计划中写详细步骤，禁止在模块计划中省略步骤

### 用户案例读取优先级（强制）

planner 规划时，输入来源按以下优先级处理：

1. **`case/` 目录中的用户案例** — 最高优先。用户提供的业务案例、测试场景、验收标准
2. **变更报告（`reports/`）** — 次优先。scan.sh 检测到的代码变更
3. **自主探索** — 兜底。以上都没有时，通过浏览器探索应用

**案例解析原则**：
- 不假设文件格式或结构，自由解析
- 提取可识别的业务场景、操作步骤、验收条件、功能点列表
- 无法解析的内容忽略，不报错
- 用户案例中的具体步骤直接转化为 TC 步骤，减少自主探索量
- 案例覆盖的功能**必须全部纳入计划**，不能遗漏

### 用户确认流程（强制）

- 计划生成后**必须**等待用户确认，不直接进入 Generate 阶段
- 用户可要求多轮修改（增删 TC、修改步骤、调整优先级、补充场景），每轮修改后重新展示
- 主会话收到 planner 计划后展示给用户，用户确认后才启动 generator
- 未确认的计划不得进入 Generate 阶段

### 行为约束

- 优先覆盖用户案例（`case/`）中涉及的功能，其次覆盖变更报告涉及的模块
- 测试步骤可复现、无歧义
- 包含负面测试场景（异常输入、非法操作）
- 计划提交后等待用户确认，不直接进入执行
- 优先使用 `browser_snapshot`，除非必要不截图

---

## generator 约束

### 录制流程（强制 — Playwright 调试录制模式，每用例独立会话）

**核心原则：每个测试用例独立一个录制会话。录制时只操作不写代码，操作完后从日志提取代码，加断言/等待/截图后写入。然后开始下一个用例的新会话。**

**阶段一：录制操作（只操作，不写代码）**

1. 调用 `generator_setup_page` 初始化新录制会话
2. 逐步骤执行 MCP 浏览器操作（navigate/click/fill/type/selectOption 等）
3. **snapshot 策略**：不需要每步都 snapshot，仅在页面跳转后、弹窗出现/关闭后、操作结果不确定时 snapshot
4. 操作失败时调整选择器重试（最多 3 次）
5. **此阶段只执行浏览器操作，不写测试代码**

**阶段二：组装并写入（立即写入）**

6. 当前用例操作完成后，调 `generator_read_log` 获取 Playwright 自动生成的代码
7. 从日志提取各步骤的操作代码，直接使用其中的选择器
8. 在操作代码间插入：
   - `expect()` 断言 — 按测试计划预期
   - 智能等待 — 按下方"等待策略"选择合适的等待方式
   - `page.screenshot({ path: ... })` — 关键节点
9. 组装 `test()` 块，调用 `generator_write_test` 立即写入文件（每个 TC 一个独立文件，不加 describe 包裹）

**阶段三：下一个用例**

11. 重复阶段一和二，开始新的录制会话（新的 `generator_setup_page`）

**禁止**：一个录制会话做多个测试用例的操作后再统一生成代码。

### 选择器（强制）

选择器全部来自 Playwright 调试录制自动生成的代码，不自行构造、不凭记忆写选择器。

### 代码生成（强制）

- 文件头部必须包含完整元信息注释（TEST-ID, TEST-NAME, TEST-LEVEL, TEST-TARGET, MODULE, TC）
- 每个 TC 一个独立文件，使用 `test.step('TC-XXX-N: ...')` 结构，**不加** `describe` 包裹
- 文件命名：`{module}/tc-{编号}-{简称}.spec.ts`（如 `member/tc-001-add-member.spec.ts`）
- 写入 `test_project/<NN-Project>/tests/` 对应层级（unit/api/e2e/ui）下的模块子文件夹（`<NN-Project>` 由主会话传递，禁止省略）
- 用 `page.screenshot()` 主动截图，不依赖自动截图
- 代码中的选择器必须来自 `generator_read_log` 的录制输出，禁止凭记忆重构

### 测试数据

- 使用 `test_` 前缀
- 文件开头添加 cleanup 步骤，清理残留数据
- 优先新增，避免修改/删除已有数据
- **例外**：healer 修复数据冲突时允许修改测试数据值（如加 `Date.now()` 后缀保证唯一），但不得删除其他 TC 的数据

## 等待策略（强制，优先信号等待）

**原则**：优先使用 Playwright 的智能等待机制，只在确实无法用信号等待时才用固定等待。

### 等待策略选择顺序

| 场景 | 首选策略 | 示例 |
|------|---------|------|
| 页面跳转 | `await page.waitForURL('**/target')` | 登录后跳转、菜单导航 |
| API 响应 | `await page.waitForResponse('**/api/xxx')` | 表单提交、数据加载 |
| DOM 元素出现 | `await locator.waitFor({ state: 'visible' })` | 弹窗、加载完成 |
| DOM 元素消失 | `await loadingLocator.waitFor({ state: 'hidden' })` | loading 遮罩消失 |
| 网络空闲 | `await page.waitForLoadState('domcontentloaded')` | 页面初始加载 |
| 以上都不适用 | `await page.waitForTimeout(500)` | 兜底，时间缩短至 500ms |

### 何时用固定等待（兜底）

- 无法预判等待目标（如动画持续时间不确定）
- 混合信号（多个条件组合，信号等待反而不稳定）
- **固定等待时间建议 500ms**，最长不超过 2000ms

### 禁止

- 禁止使用 `waitForLoadState('networkidle')`（已废弃）
- 禁止在每个 click 后都加固定等待 — 优先让 Playwright 的 auto-wait 机制处理

## 断言与验证约束（强制）

- **禁止**写"自适应"断言，即根据实际结果动态改变预期
- **禁止**在安全/认证相关测试中，当实际行为违反安全要求时仍让测试 PASS
- **验证必须严格**：测试代码中的 `expect` 必须与测试计划中的预期完全一致
- **失败即失败**：当实际行为与安全要求不符时，必须让测试 FAIL，不得宽容通过或降级处理

---

## healer 约束

### 修复流程（强制）

1. `test_run` 运行全部测试，识别失败
2. `test_debug` 逐个调试
3. 用 Playwright 工具分析：snapshot、console、network
4. 系统化修复，不猜测
5. 每次修复后重新运行验证
6. 更新 `progress.txt`、`report.md`、`summary.md`

### 修复范围

- `test_project/<NN-Project>/tests/`、`test_project/<NN-Project>/results/`、`test_project/<NN-Project>/playwright.config.ts`、`test_project/<NN-Project>/test-config/environment.json`
- 从测试文件头 `// MODULE: xxx` 确定模块目录
- 截图只更新对应模块目录，禁止跨模块操作

### 修复原则

- 优先健壮、可维护的方案，避免临时补丁
- 允许 `test.fixme()` 标记应用 Bug（必须注释原因），禁止无理由的 `test.skip()`
- 不向用户提问，自主判断执行最合理方案
- 不使用 `waitFor` 的 `networkidle` 等废弃 API
- 逐个修复验证，不批量修改后再测

### 修复次数限制（强制）

- 每个 TC 最多 **3 次修复尝试**
- 3 次尝试后仍失败 → 用 `test.fixme()` 标记，注释原因（如"应用 Bug：xxx"）
- `progress.txt` 中保持 `FAIL` 状态不变
- `report.md` 中记录尝试次数和最终标记原因

### 输出更新

- 修复并通过 → `progress.txt` 中 `FAIL` 改 `PASS`
- 应用 Bug → 保持 `FAIL` 不变
- `report.md` 添加修复记录（原因、方式、验证结果）
- 全部修复后更新 `summary.md` 通过率

