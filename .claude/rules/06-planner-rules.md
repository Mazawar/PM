# planner 阶段规则（测试规划）

> 配套 agent: `playwright-test-planner`
> 规则编号：06（上接 05-validator，下接 07-generator）

## 核心职责

生成测试计划：探索应用 → 识别功能模块 → 生成 TC → 等待用户确认。

**优先读取 `case/` 用户案例**，其次读取变更报告，最后自主探索。

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

## 测试层级（规划用）

| 层级 | 名称 | 粒度 | 说明 |
|------|------|------|------|
| L2 | API | 秒级 | 真实中间件（DB、缓存），Mock 第三方服务 |
| L3 | E2E | 分钟级 | 完整应用栈，端到端业务流程 |

## 框架选择

优先使用项目已有测试框架（检查 pom.xml、package.json、go.mod、requirements.txt），否则按默认映射：

- Java/Spring → JUnit5 + Mockito / Spring Boot Test + REST Assured
- Python → pytest + unittest.mock / pytest + requests
- Node.js/Vue/React → **Vitest**（L2 API 测试）+ Playwright（L3 E2E 测试）
- Go → testing + testify

L2 API 测试统一 Vitest。

## 覆盖要求

| 层级 | 最低 | 目标 |
|------|------|------|
| L2 | 40% | 70%+ |
| L3 | 核心流程 100% | 所有关键路径 |

## TC 编号管理（强制）

- TC 编号 **全局唯一**，跨模块连续递增
- 生成前先读取 `00-test-plan.md`，确认已用最大编号，从下一个开始
- 每个模块分配编号范围，记录在总计划索引
- 预留编号间隙便于后续新增

### 测试 ID 格式

- 脚本文件：`TP-<project>-L<level>-<NNN>`（如 `TP-<NN-Project>-L3-003`）
- 计划与报告：`TC-XXX`（全局唯一，跨模块连续递增）

## 计划分层（强制）

- `test_project/<NN-Project>/plans/00-test-plan.md` — **仅** Application Overview + 模块索引表，禁止写详细步骤
- `test_project/<NN-Project>/plans/NN-{module}.md` — **所有**详细内容（TC 步骤、expect），NN 为两位序号
- 禁止在总计划中写详细步骤，禁止在模块计划中省略步骤

### 总计划模板（00-test-plan.md，强制）

```markdown
# <项目名> 测试计划

## Application Overview

- 目标应用: <URL>
- 技术栈: <前端框架 + 后端框架>
- 测试范围: <简述覆盖范围>

## 模块索引

| # | 模块 | 计划文件 | TC 范围 | 用例数 | 优先级 |
|---|------|---------|---------|--------|--------|
| 01 | <模块名> | 01-<module>.md | TC-001 ~ TC-018 | 18 | P0 |
| 02 | <模块名> | 02-<module>.md | TC-019 ~ TC-032 | 14 | P1 |

**总计**: <N> 个模块, <M> 个用例
```

**总计划中禁止出现的内容**：
- TC 详细步骤（Steps / expect）
- UI Map
- 测试数据
- 页面探索细节
- 任何超过上表的正文段落

## 用户案例读取优先级（强制）

输入来源按以下优先级：

1. **`case/` 目录中的用户案例** — 最高优先。用户提供的业务案例、测试场景、验收标准
2. **变更报告（`scan-logs/`）** — 次优先。scan.sh 检测到的代码变更
3. **自主探索** — 兜底。以上都没有时，通过浏览器探索应用

**案例解析原则**：
- 不假设文件格式或结构，自由解析
- 提取可识别的业务场景、操作步骤、验收条件、功能点列表
- 无法解析的内容忽略，不报错
- 用户案例中的具体步骤直接转化为 TC 步骤，减少自主探索量
- 案例覆盖的功能**必须全部纳入计划**，不能遗漏

## UI Map 录制（强制）

Planner 探索页面时**必须同步记录 UI Map**，供 Generator 直接生成代码，避免重新录制。

### 录制要求

- 每个探索的页面，记录导航路径、页面 URL、关键交互元素及其定位方式
- 定位方式优先级：`getByRole` + name → `getByPlaceholder` / label → `getByText` → CSS selector
- 动态行为（弹窗、加载状态、分页）必须记录在「注意事项」中
- 所有记录写入模块计划文件 `plans/NN-{module}.md` 的 `## UI Map` 章节

### UI Map 格式

每个页面/功能独立一个 UI Map 块：

```markdown
## UI Map

### 导航路径
首页 > 系统管理 > 角色管理

### 页面 URL
/system/role

### 关键元素
| 元素 | 定位方式 | 备注 |
|------|---------|------|
| 新增按钮 | `getByRole('button', { name: '新增' })` | 页面顶部 |
| 搜索框 | `getByPlaceholder('请输入角色名称')` | 配合搜索按钮 |
| 数据表格 | `getByRole('table')` | el-table, 含分页 |
| 确认弹窗 | `getByRole('dialog')` | 删除/提交后弹出 |

### 注意事项
- 表格分页在底部，数据多时需翻页
- 删除操作有二次确认弹窗
```

### 禁止

- 禁止省略 UI Map — 没有 UI Map 的计划视为不完整
- 禁止猜测选择器 — 必须从 `browser_snapshot` 实际观察记录

## UI 问题标注

探索时发现 UI 问题（布局错乱、缺失标签、无障碍问题、视觉不一致），截图并记录到 `results/.ui/report.md`。

### 格式

```markdown
# UI 审查报告

- 项目: <NN-Project>
- 审查时间: <YYYY-MM-DD HH:mm>
- 审查范围: 测试规划阶段探索发现

## 问题

### UI-001: <问题标题>
- **页面**: /system/role
- **严重程度**: 高/中/低
- **截图**: ![](screenshots/ui-001-xxx.png)
- **描述**: <观察到的现象>
- **建议**: <推荐修复方式>
```

### 约束

- 问题独立编号：`UI-NNN`，与 TC 编号无关
- 截图存放在 `results/.ui/screenshots/`
- **有内容时才创建报告**，无问题不创建空文件
- 这是观察报告，不是测试用例，不生成脚本

## 用户确认流程（强制）

- 计划生成后**必须**等待用户确认，不直接进入 Generate 阶段
- 用户可要求多轮修改（增删 TC、修改步骤、调整优先级、补充场景），每轮修改后重新展示
- 主会话收到 planner 计划后展示给用户，用户确认后才启动 generator
- 未确认的计划不得进入 Generate 阶段

## 行为约束

- 优先覆盖用户案例（`case/`）中涉及的功能，其次覆盖变更报告涉及的模块
- 测试步骤可复现、无歧义
- 包含负面测试场景（异常输入、非法操作）
- 计划提交后等待用户确认，不直接进入执行
- 优先使用 `browser_snapshot`，除非必要不截图

## Seed 文件生成（强制）

Plan 阶段结束时，检查 `tests/seed.spec.ts` 是否存在：
- **已存在** → 复用，不覆盖
- **不存在** → 基于探索到的登录流程生成

**用户确认计划后才生成**，不在探索过程中生成。

### 模板

```typescript
// TEST-ID: TP-<NN-Project>-SEED
// TEST-NAME: 登录种子
// TEST-LEVEL: SEED
// MODULE: auth

import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

setup('登录并保存认证状态', async ({ page }) => {
  await page.goto('<baseURL><login.url>');
  await page.getByPlaceholder('<usernamePlaceholder>').fill('<credentials.username>');
  await page.getByPlaceholder('<passwordPlaceholder>').fill('<credentials.password>');
  await page.getByRole('button', { name: '<submitButton>' }).click();
  await page.waitForURL('**/<登录后路径>**');
  const authPath = path.resolve(__dirname, '..', 'test-config', 'auth.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  await page.context().storageState({ path: authPath });
});
```

### 约束

- 选择器从探索应用时实际使用的为准，不猜测
- `storageState` 写到 `test-config/auth.json`（chromium project 自动加载）
- 生成后验证 seed 能正常执行

## 测试数据安全

- 所有测试数据使用 `test_` 前缀
- 优先创建新数据，避免修改/删除已有数据
