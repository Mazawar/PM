# generator 阶段规则（测试代码生成）

> 配套 agent: `playwright-test-generator`
> 规则编号：07（上接 06-planner，下接 08-healer）

## 核心职责

根据 planner 生成的测试计划，生成 Playwright 测试代码。

## 共享约束

### 浏览器会话管理（强制）

- 启动时**必须**先调用 `browser_navigate` 导航到目标 URL（端口从 environment.json 获取）
- **禁止**假设浏览器处于任何特定页面
- 每个需要认证的操作必须自行完成登录（navigate → fill 账号 → fill 密码 → click 登录 → waitFor URL/dashboard）
- 使用 `getByRole('textbox', { name: 'placeholder文字' })` 定位输入框，**不要**用 ref 编号
- 关键操作前用 `browser_snapshot` 确认页面状态
- URL 与预期不符时先 `browser_navigate` 修正
- 遇到 about:blank → 立即 navigate

### 循环防护（强制）

- **同一操作**（相同工具 + 相同 target/selector）连续失败 **3 次** → 必须换策略
- **同一目标**（同一意图）连续失败 **5 次** → 中止当前步骤
- **总工具调用失败** 达 **10 次** → 终止整个执行

策略切换顺序（禁止连续两次使用相同策略）：
1. role + name — 语义定位，最稳定
2. placeholder / label — 表单元素首选
3. text content（`{ exact: true }`）— 按钮/链接
4. CSS selector（`input[data-testid="..."]`）
5. ref 精确引用 — **最后手段**，ref 会变
6. 跳过该步骤，标记"未能定位"

操作超时：单次调用 30 秒，页面加载 15 秒。

中止时输出结构化报告：
```
## Agent 执行失败
- 阶段：<当前执行阶段>
- 失败步骤：<步骤描述>
- 失败原因：<具体原因>
- 已尝试策略：<列举已尝试的定位/操作方式>
- 建议主会话：<修复建议>
```

## 生成模式选择（强制）

启动时**必须**先检查计划文件是否包含完整 UI Map：

1. 读取模块计划文件（`plans/NN-{module}.md`），查找 `UI Map` 章节
2. **有 UI Map** → **直接生成模式**
3. **无 UI Map** → **录制模式**

## 模式 A：直接生成（有 UI Map 时）

从 UI Map 提取选择器直接生成代码，**不执行浏览器操作**。

**流程**：
1. 读取计划文件中的 UI Map 和 TC 步骤
2. UI Map 定位方式转为 Playwright locator：
   - `getByRole('button', { name: '查询' })` → `page.getByRole('button', { name: '查询' })`
   - `getByPlaceholder('角色名称/权限字符')` → `page.getByPlaceholder('角色名称/权限字符')`
   - CSS selector（`page.locator('.el-table')`）→ 直接使用
3. TC 步骤转为 Playwright 操作代码
4. 插入 `expect()` 断言、智能等待、`page.screenshot()`
5. 调用 `generator_write_test` 写入文件
6. **不调用** `generator_setup_page`、`generator_read_log`

## 模式 B：录制模式（无 UI Map 时）

**核心原则：每个 TC 独立一个录制会话。录制时只操作不写代码，操作完后从日志提取代码。**

**阶段一：录制操作**
1. `generator_setup_page` 初始化新录制会话
2. 逐步骤执行 MCP 浏览器操作（navigate/click/fill/type/selectOption 等）
3. 仅在页面跳转后、弹窗出现/关闭后、结果不确定时 snapshot
4. 操作失败时调整选择器重试（最多 3 次）
5. **此阶段只执行浏览器操作，不写测试代码**

**阶段二：组装并写入**
6. `generator_read_log` 获取 Playwright 自动生成的代码
7. 提取操作代码，直接使用录制生成的选择器
8. 插入 `expect()` 断言、智能等待、`page.screenshot()`
9. 组装 `test()` 块，`generator_write_test` 立即写入

**阶段三：下一个用例**
10. 新的 `generator_setup_page`，重复阶段一和二

**禁止**：一个录制会话做多个 TC 后统一生成代码。

## 选择器来源（强制）

| 生成模式 | 选择器来源 | 规则 |
|---------|-----------|------|
| 直接生成 | 计划文件 UI Map | 直接转为 Playwright locator，不自行构造 |
| 录制模式 | `generator_read_log` 输出 | 使用录制自动生成的选择器，禁止凭记忆重构 |

## 代码生成（强制）

### 文件头部

```typescript
// TEST-ID: TP-<project>-L<level>-<序号>
// TEST-NAME: <测试名称>
// TEST-LEVEL: L1|L2|L3|L4
// TEST-TARGET: <目标页面/功能>
// MODULE: <模块名>
// TC: TC-XXX
```

### 代码结构

- 每个 TC 一个独立文件，只有一个 `test()` 块，**不加** `describe` 包裹
- `test.step('TC-XXX-N: 步骤描述', ...)` 标注每个步骤
- 每步骤前加注释，避免重复注释

### 文件命名与路径

- 文件命名：`tc-{编号}-{简称}.spec.ts`
- 模块目录 kebab-case（与 `plans/` 文件名去掉序号前缀后一致，如 `01-role-management` → `role-management`）
- 写入 `test_project/<NN-Project>/tests/` 对应层级（unit/api/e2e/ui）下的模块子文件夹
- 模块子文件夹由 `generator_write_test` 自动创建
- 禁止写入项目根目录的 `tests/` 或 `e2e/`

```
tests/
├── unit/{module}/tc-{编号}-{简称}.spec.ts
├── api/{module}/tc-{编号}-{简称}.spec.ts
├── e2e/{module}/tc-{编号}-{简称}.spec.ts
└── ui/{module}/tc-{编号}-{简称}.spec.ts
```

## 测试数据

- 使用 `test_` 前缀
- 文件开头添加 cleanup 步骤，清理残留数据
- 优先新增，避免修改/删除已有数据
- **例外**：healer 修复数据冲突时允许修改值（加 `Date.now()` 后缀），但不得删除其他 TC 数据

## 测试操作约束

- 使用浏览器 UI 操作，禁止直接 API 调用或数据库操作（除登录初始化等特殊场景）
- 每次迭代最多 5 个用例，按 TC 编号优先级执行
- 单个用例超时 5 分钟

## 等待策略（强制）

优先使用 Playwright 智能等待，只在无法用信号等待时才用固定等待。

| 场景 | 首选策略 | 示例 |
|------|---------|------|
| 页面跳转 | `await page.waitForURL('**/target')` | 登录后跳转、菜单导航 |
| API 响应 | `await page.waitForResponse('**/api/xxx')` | 表单提交、数据加载 |
| DOM 元素出现 | `await locator.waitFor({ state: 'visible' })` | 弹窗、加载完成 |
| DOM 元素消失 | `await loadingLocator.waitFor({ state: 'hidden' })` | loading 遮罩消失 |
| 网络空闲 | `await page.waitForLoadState('domcontentloaded')` | 页面初始加载 |
| 以上都不适用 | `await page.waitForTimeout(500)` | 兜底，最长 2000ms |

**禁止**：`waitForLoadState('networkidle')`、每个 click 后都加固定等待。

## 截图规范

- 每个用例至少 3 张：初始页面、关键操作后、最终结果
- 页面跳转后必须截图，错误/异常状态必须截图
- 命名：`tc-{编号}-{简称}.png`
- 路径**必须包含完整前缀**：`test_project/<NN-Project>/results/{module}/screenshots/tc-{编号}-{简称}.png`
- **禁止**使用缺少 `test_project/<NN-Project>/` 前缀的相对路径

## 断言约束（强制）

- **禁止**写"自适应"断言（根据实际结果动态改变预期）
- **禁止**在安全/认证测试中，实际违反安全要求时仍 PASS
- `expect` 必须与测试计划预期完全一致
- 失败即失败，不得宽容通过或降级处理
