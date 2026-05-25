# 测试产物输出规范

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

## 文件命名

| 类型 | 格式 | 示例 |
|------|------|------|
| 测试文件 | `{module}-{scenario}.spec.ts` | `user-lifecycle.spec.ts` |
| 截图文件 | `tc-{编号}-{简称}.png` | `tc-001-login-page.png` |
| 模块目录 | kebab-case | `user-management/` |
| 模块名 | 与 `test-config/plans/` 文件名一致 | `role-management` |

测试文件必须写入 `tests/e2e/` 或 `tests/ui/` 子目录。

## 测试文件头部（强制）

```typescript
// TEST-ID: TP-<project>-L<level>-<序号>
// TEST-NAME: <测试名称>
// TEST-LEVEL: L1|L2|L3|L4
// TEST-TARGET: <目标页面/功能>
// MODULE: <模块名>
// TC: TC-XXX, TC-YYY  （本文件覆盖的 TC 编号）
```

代码结构：
- `test.describe()` 包裹，名称与计划一致
- `test.step('TC-XXX: 步骤描述', ...)` 标注每个步骤
- 每步骤前加注释，避免重复注释

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

## summary.md 格式

聚合所有模块的通过率，每次测试后更新。仅存放测试结果，变更分析写入 `reports/summary.md`。

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

## 截图规范（强制）

- 每个用例至少 3 张：初始页面、关键操作后、最终结果
- 页面跳转后必须截图
- 错误/异常状态必须截图
- 命名：`tc-{编号}-{简称}.png`

### 截图保存路径（强制）

`page.screenshot({ path })` 的路径相对于 CWD（项目根 `pm/`）解析，**必须包含完整前缀**：

```
test_project/<NN-Project>/results/{module}/screenshots/tc-{编号}-{简称}.png
```

示例：`test_project/02-oa-llm/results/annual-project-setup/screenshots/tc-001-login-page.png`

**禁止**使用缺少 `test_project/<NN>/` 前缀的相对路径（如 `results/screenshots/...`），这会导致截图写入错误位置。

### 报告中引用截图（强制）

`report.md` 中的截图引用使用相对于 `report.md` 所在目录的路径：

```markdown
![](screenshots/tc-xxx-xxx.png)
```

`report.md` 的"结果概览"表格中，截图列**必须**填写每个 TC 的关键截图引用，不得留空。

- 禁止跨模块引用截图
- 禁止跨 TC 复用截图
- 实时生成，禁止引用历史报告截图
