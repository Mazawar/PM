# healer 阶段规则（测试修复与结果更新）

> 配套 agent: `playwright-test-healer`
> 规则编号：08（上接 07-generator，下接 Publish 阶段）

## 核心职责

运行失败的测试 → 诊断失败原因 → 修复测试代码 → 验证通过 → 更新结果文件。

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

## 修复流程（强制）

1. `test_run` 运行全部测试，识别失败
2. `test_debug` 逐个调试
3. 用 Playwright 工具分析：snapshot、console、network
4. 系统化修复，不猜测
5. 每次修复后重新运行验证
6. 更新 `progress.txt`、`report.md`、`summary.md`

## 修复范围

- `test_project/<NN-Project>/tests/`、`test_project/<NN-Project>/results/`、`test_project/<NN-Project>/playwright.config.ts`、`test_project/<NN-Project>/test-config/environment.json`
- 从测试文件头 `// MODULE: xxx` 确定模块目录
- 截图只更新对应模块目录，禁止跨模块操作

## 修复原则

- 优先健壮、可维护的方案，避免临时补丁
- 允许 `test.fixme()` 标记应用 Bug（必须注释原因），禁止无理由的 `test.skip()`
- 不向用户提问，自主判断执行最合理方案
- 不使用 `waitFor` 的 `networkidle` 等废弃 API
- 逐个修复验证，不批量修改后再测

## 修复次数限制（强制）

- 每个 TC 最多 **3 次修复尝试**
- 3 次后仍失败 → `test.fixme()` 标记，注释原因（如"应用 Bug：xxx"）
- `progress.txt` 中保持 `FAIL` 状态不变
- `report.md` 中记录尝试次数和最终标记原因

## 测试数据安全

- 所有测试数据使用 `test_` 前缀
- 优先创建新数据
- 修复数据冲突时允许修改测试数据值（加 `Date.now()` 后缀保证唯一），但不得删除其他 TC 依赖的数据

## 结果目录结构（强制）

```
results/
├── summary.md              # 汇总报告
├── {module}/               # 按功能模块分目录
│   ├── progress.txt        # TC 进度追踪
│   ├── report.md           # 模块详细报告
│   └── screenshots/        # 模块截图（禁止跨模块引用）
└── ...
```

- 新模块创建新目录，不删除已有模块结果
- 同模块重测时覆盖
- 截图只能引用同模块目录，禁止跨模块复用

## progress.txt 格式

```
TC-001:PASS
TC-002:FAIL
TC-003:PASS
```

- 状态：`PASS` | `FAIL` | `SKIP`（仅客观原因）
- 每行一条，TC 编号后紧跟冒号和状态
- 每个用例执行完立即更新

## report.md 格式

```markdown
# <模块名称> 测试报告

## 概要
- 测试需求: <描述>
- 目标应用: <URL>
- 测试时间: <YYYY-MM-DD HH:mm>
- 执行结果: <通过数>/<总数> 通过（通过率 XX%）

## 结果概览
| # | 用例编号 | 用例名称 | 结果 | 截图 |
|---|---------|---------|------|------|

## 详细结果
### TC-XXX: <名称> - PASS/FAIL
**步骤**: ...
**预期**: ...
**实际**: ...

## 缺陷汇总
| # | 严重程度 | 用例 | 描述 | 建议 |

## 修复记录
| # | 问题 | 修复方式 |

## 环境信息
- 浏览器: Chromium
- 分辨率: 1920x1080
```

`report.md` 的"结果概览"表格中，截图列**必须**填写每个 TC 的关键截图引用，不得留空。

## summary.md 格式

```markdown
# 测试汇总

- 项目: <NN-Project>
- 更新时间: <YYYY-MM-DD HH:mm>
- 总通过率: <通过数>/<总数>（XX%）

## 模块概览
| 模块 | 通过 | 失败 | 跳过 | 通过率 |
|------|------|------|------|--------|
| <module> | X | Y | Z | XX% |
```

仅存放测试结果，变更分析写入 `reports/summary.md`。

## 截图规范（强制）

- 每个用例至少 3 张：初始页面、关键操作后、最终结果
- 页面跳转后必须截图，错误/异常状态必须截图
- 命名：`tc-{编号}-{简称}.png`
- 路径**必须包含完整前缀**：`test_project/<NN-Project>/results/{module}/screenshots/tc-{编号}-{简称}.png`
- 截图引用使用相对于 report.md 的路径：`![](screenshots/tc-xxx-xxx.png)`
- 禁止跨模块引用截图、跨 TC 复用截图、引用历史截图

## 输出更新规则

- 修复并通过 → `progress.txt` 中 `FAIL` 改 `PASS`
- 应用 Bug → 保持 `FAIL` 不变
- `report.md` 添加修复记录（原因、方式、验证结果）
- 全部修复后更新 `summary.md` 通过率

## 等待策略（强制）

同 07-generator-rules.md，优先 Playwright 智能等待：

| 场景 | 首选策略 |
|------|---------|
| 页面跳转 | `await page.waitForURL('**/target')` |
| API 响应 | `await page.waitForResponse('**/api/xxx')` |
| DOM 元素出现 | `await locator.waitFor({ state: 'visible' })` |
| DOM 元素消失 | `await loadingLocator.waitFor({ state: 'hidden' })` |
| 网络空闲 | `await page.waitForLoadState('domcontentloaded')` |
| 以上都不适用 | `await page.waitForTimeout(500)`（最长 2000ms） |

**禁止**：`waitForLoadState('networkidle')`。

## 断言约束（强制）

- **禁止**写"自适应"断言
- **禁止**在安全/认证测试中，实际违反安全要求时仍 PASS
- 修复时不得降级断言标准

## 测试操作约束

- 使用浏览器 UI 操作，禁止直接 API 调用或数据库操作（除登录初始化等特殊场景）
- 不得跳过用例，除非有客观原因（404、功能未实现）
- 每次迭代最多 5 个用例，按 TC 编号优先级执行
- 单个用例超时 5 分钟
