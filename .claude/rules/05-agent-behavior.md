# Agent 行为约束规则

本文件定义 planner、generator、healer 三个专用 Agent 的行为约束。
Agent 定义文件（`.claude/agents/`）包含职责和工作流程，本文件补充强制约束。

---

## planner 约束

### TC 编号管理（强制）

- TC 编号 **全局唯一**，跨模块连续递增
- 生成前先读取 `test-plan.md`，确认已用最大编号，从下一个开始
- 每个模块分配编号范围，记录在总计划索引
- 预留编号间隙便于后续新增

### 计划分层（强制）

- `plans/test-plan.md` — **仅** Application Overview + 模块索引表
- `plans/{module}.md` — **所有**详细内容（TC 步骤、expect）
- 禁止在总计划中写详细步骤，禁止在模块计划中省略步骤

### 行为约束

- 优先覆盖变更报告涉及的模块和功能
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
3. 每步操作后调 `browser_snapshot` 确认页面状态
4. 操作失败时调整选择器重试（最多 3 次）
5. **此阶段只执行浏览器操作，不写测试代码**

**阶段二：生成代码（从录制日志提取 + 组装）**

6. 当前用例操作完成后，调 `generator_read_log` 获取 Playwright 自动生成的代码
7. 从日志提取各步骤的操作代码，直接使用其中的选择器
8. 在操作代码间插入：
   - `expect()` 断言 — 按测试计划预期
   - `await page.waitForTimeout(1000)` — 每次 click 类操作后
   - `page.screenshot({ path: ... })` — 关键节点
9. 组装完整文件（头部注释 + imports + describe 包裹 + test.step 结构）
10. 调用 `generator_write_test` 写入文件

**阶段三：下一个用例**

11. 重复阶段一和阶段二，开始新的录制会话（新的 `generator_setup_page`）

**禁止**：一个录制会话做多个测试用例的操作后再统一生成代码。

### 选择器（强制）

选择器全部来自 Playwright 调试录制自动生成的代码，不自行构造、不凭记忆写选择器。

### 代码生成（强制）

- 文件头部必须包含完整元信息注释（TEST-ID, MODULE, TC 映射）
- 使用 `test.describe()` + `test.step('TC-XXX: ...')` 结构，一个文件包含多个 `test()` 块
- 文件命名：`{module}.spec.ts`（一个模块所有 TC 写入同一个文件，如 `member.spec.ts` 包含全部增删改查搜索分页测试）
- 写入 `tests/e2e/` 或 `tests/ui/` 子目录
- 用 `page.screenshot()` 主动截图，不依赖自动截图
- 代码中的选择器必须来自 `generator_read_log` 的录制输出，禁止凭记忆重构

### 测试数据

- 使用 `test_` 前缀
- 文件开头添加 cleanup 步骤，清理残留数据
- 只新增，不修改/删除已有数据

## 固定等待约束（强制）

- 每次 `page.click()` 或 `page.locator().click()` 后必须跟 `await page.waitForTimeout(1000)`

- 表单提交、登录、弹窗确认等操作后**必须**等待
- 页面跳转操作后**必须**等待
- 任何用户点击类操作后**必须**等待

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

- `test_project/<NN-Project>/tests/`、`results/`、`playwright.config.ts`、`test-config/environment.json`
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
