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

- `test-config/test-plan.md` — **仅** Application Overview + 模块索引表
- `test-config/plans/{module}.md` — **所有**详细内容（TC 步骤、expect）
- 禁止在总计划中写详细步骤，禁止在模块计划中省略步骤

### 行为约束

- 优先覆盖变更报告涉及的模块和功能
- 测试步骤可复现、无歧义
- 包含负面测试场景（异常输入、非法操作）
- 计划提交后等待用户确认，不直接进入执行
- 优先使用 `browser_snapshot`，除非必要不截图

---

## generator 约束

### 录制流程（强制）

1. 调用 `generator_setup_page` 初始化
2. 按计划逐步在浏览器执行操作
3. 每个工具调用的 intent 使用步骤描述
4. 每步骤前加注释
5. 调用 `generator_read_log` 获取日志
6. 调用 `generator_write_test` 写入文件

### 代码生成（强制）

- 文件头部必须包含完整元信息注释（TEST-ID, MODULE, TC 映射）
- 使用 `test.describe()` + `test.step('TC-XXX: ...')` 结构
- 文件命名：`{module}-{scenario}.spec.ts`
- 写入 `tests/e2e/` 或 `tests/ui/` 子目录
- 用 `page.screenshot()` 主动截图，不依赖自动截图

### 测试数据

- 使用 `test_` 前缀
- 文件开头添加 cleanup 步骤
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
