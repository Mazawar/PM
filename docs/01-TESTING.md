# 自动化测试框架规则

## 1. 技术栈与测试框架映射

| 技术栈 | 单元测试 | 接口/集成测试 | E2E 测试 | UI 自动化 |
|--------|----------|--------------|----------|-----------|
| Java / Spring Boot | JUnit5 + Mockito | Spring Boot Test + REST Assured | TestContainers + REST Assured | Selenium / Playwright |
| Python | pytest + unittest.mock | pytest + requests | pytest + Playwright | Playwright |
| Node.js / Vue / React | Jest + Testing Library | Supertest / MSW | Playwright / Cypress | Playwright / Cypress |
| Go | testing + testify | httptest + testify | Playwright | Playwright |
| 通用 API | — | Postman/Newman, curl | — | — |

### 框架选择原则

- **优先使用项目已有的测试框架** — 检查项目 `pom.xml` / `package.json` / `go.mod` / `requirements.txt` 中的测试依赖
- **无测试依赖时按上表推荐** — Agent 自动识别项目语言后选择对应框架
- **UI 测试统一优先 Playwright** — 跨浏览器、多语言支持、录制回放

## 2. 测试层级定义

### L1 - 单元测试

- **目标**: 验证单个函数、方法、类的逻辑正确性
- **范围**: 不依赖外部服务（数据库、API、文件系统），使用 mock/stub
- **执行速度**: 毫秒级
- **触发条件**: 变更涉及核心业务逻辑、工具类、数据处理函数

### L2 - 接口/集成测试

- **目标**: 验证 API 端点、模块间协作、数据库交互
- **范围**: 真实或容器化的中间件（数据库、缓存），mock 外部第三方服务
- **执行速度**: 秒级
- **触发条件**: 变更涉及 Controller、Service 层、API 接口、数据库操作

### L3 - E2E 流程测试

- **目标**: 验证完整业务流程从前到后的正确性
- **范围**: 完整的应用栈，真实环境或接近真实的环境
- **执行速度**: 分钟级
- **触发条件**: 变更涉及跨模块业务流程、关键用户路径

### L4 - UI 自动化测试

- **目标**: 验证页面交互、表单提交、数据展示、响应式布局
- **范围**: 浏览器中完整的前端交互
- **执行速度**: 分钟级
- **触发条件**: 变更涉及前端页面、组件、路由、样式

## 3. 测试目录结构

```
test_project/<NN-Project>/
├── test-config/                # 测试配置与计划
│   ├── test-plan.md            # 总测试计划（索引 + 概览）
│   ├── plans/                  # 按模块拆分的详细计划
│   │   ├── user-management.md  # 用户管理测试计划
│   │   ├── role-management.md  # 角色管理测试计划
│   │   └── <module>.md         # 其他模块
│   └── environment.json        # 环境配置（URL、端口、凭证占位）
├── tests/                      # 测试脚本代码
│   ├── unit/                   # L1 单元测试
│   ├── api/                    # L2 接口/集成测试
│   ├── e2e/                    # L3 E2E 流程测试
│   └── ui/                     # L4 UI 自动化测试
├── reports/                    # 扫描变更报告（脚本自动生成）
│   ├── 2026-05-21_103500.md   # 原始变更报告
│   └── summary.md             # Agent 分析的变更汇总
└── results/                    # 测试执行结果
    └── latest/                 # 最近一次执行结果
        ├── summary.md          # 汇总报告（聚合所有模块）
        ├── user-management/    # 按功能模块分目录
        │   ├── progress.txt
        │   ├── report.md
        │   └── screenshots/
        ├── role-management/
        │   ├── progress.txt
        │   ├── report.md
        │   └── screenshots/
        └── menu-management/
            ├── progress.txt
            ├── report.md
            └── screenshots/
```

### 测试文件命名规范

测试文件名必须包含**模块前缀**，格式：`{module}-{scenario}.spec.ts`

```
tests/
├── e2e/
│   ├── user-lifecycle.spec.ts          # 用户管理 - 生命周期
│   ├── user-search.spec.ts             # 用户管理 - 搜索筛选
│   ├── role-lifecycle.spec.ts          # 角色管理 - 生命周期
│   ├── role-search.spec.ts             # 角色管理 - 搜索筛选
│   └── menu-crud.spec.ts              # 菜单管理 - 增删改查
└── ui/
    ├── user-form-ui.spec.ts            # 用户管理 - 表单 UI
    ├── role-dialog-ui.spec.ts          # 角色管理 - 对话框 UI
    └── menu-tree-ui.spec.ts           # 菜单管理 - 树形控件 UI
```

模块前缀为功能的英文短名，kebab-case 格式。同一模块的文件共享前缀，便于筛选和批量执行。

### 结果目录组织规则

- **按模块分目录**：`results/latest/{module}/`，每个模块独立存放 progress、report、screenshots
- **互不覆盖**：测试新模块时创建新目录，不删除已有模块的结果
- **同模块覆盖**：重新测试同一模块时覆盖该模块的结果
- **汇总报告**：`results/latest/summary.md` 聚合所有模块的测试结果概要

## 4. 用例编号规范

### 计划内编号（test-plan.md）

测试计划中每个场景使用 **TC-XXX** 编号，全局唯一，跨层级连续编号：

```markdown
#### TC-001: 用户数据层 Mapper 单元测试
#### TC-002: 用户业务层 Service 单元测试
#### TC-003: 用户列表查询接口测试
...
```

### 脚本文件编号

测试脚本文件头使用 **TP 编号**，对应项目、层级和序号：

```
TP-<项目编号>-L<层级>-<序号>
```

示例：`TP-01-RuoYi-Vue-L3-001` = 项目01、L3 E2E、第1个用例

### 对应关系

一个 TC 可能对应一个或多个测试文件中的 test case。执行智能体以 TC 编号跟踪进度，脚本文件以 TP 编号组织代码。

## 测试计划格式规范

### 总计划（test-plan.md）

`test-config/test-plan.md` 是所有模块的索引和概览，不包含详细步骤：

```markdown
# <项目名称> 测试计划

## Application Overview
- 被测应用: <URL>
- 技术栈: <描述>
- 登录凭证: <账号/密码>

## 模块索引

| 模块 | 计划文件 | TC 范围 | 用例数 | 优先级 |
|------|---------|---------|--------|--------|
| 用户管理 | [plans/user-management.md](plans/user-management.md) | TC-001~TC-007 | 7 | P0 |
| 角色管理 | [plans/role-management.md](plans/role-management.md) | TC-008~TC-029 | 22 | P0 |
| 菜单管理 | [plans/menu-management.md](plans/menu-management.md) | TC-030~TC-044 | 15 | P1 |
```

### 模块计划（plans/{module}.md）

每个模块一个独立文件，包含详细测试场景。TC 编号全局连续，各模块分配编号范围：

```markdown
# <模块名称> 测试计划

## 模块概述
- 功能入口: <导航路径>
- 核心功能: <列举>
- 优先级: P0/P1/P2

## Test Scenarios

### L3 E2E 测试

#### TC-001: <用例名称>
**Steps:**
  1. 操作步骤
    - expect: 预期结果
  2. 操作步骤
    - expect: 预期结果

#### TC-002: <用例名称>
**Steps:**
  1. ...

### L4 UI 测试

#### TC-005: <用例名称>
**Steps:**
  1. ...
```

### TC 编号分配规则

- TC 编号全局唯一，跨模块连续递增（TC-001、TC-002...TC-999）
- 每个模块在总计划中分配编号范围（如角色管理 TC-008~TC-029）
- 模块内按层级分组（L3 在前，L4 在后），组内按编号递增
- 预留编号间隙便于后续新增用例

## 5. 测试用例格式

每个测试文件头部必须包含元信息注释：

```typescript
// TEST-ID: TP-<项目编号>-L<层级>-<序号>
// TEST-NAME: <测试名称>
// TEST-LEVEL: L1|L2|L3|L4
// TEST-TARGET: <测试目标模块/接口/页面>
// TEST-PREREQUISITE: <前置条件>
// TEST-STEPS: <步骤概述>
// TEST-EXPECTED: <预期结果>
```

## 6. 执行输出规范

### 进度文件（progress.txt）

路径：`test_project/<NN-Project>/results/latest/{module}/progress.txt`

每行一条记录，格式：`TC-XXX:状态`

```
TC-001:PASS
TC-002:PASS
TC-003:FAIL
TC-004:SKIP
```

状态取值：
- `PASS` — 所有断言通过
- `FAIL` — 断言失败或操作异常
- `SKIP` — 仅当页面 404 / 功能未实现等客观原因，必须在报告中注明原因

进度文件是跨迭代的**唯一状态来源**，不依赖记忆。每个模块独立一个 progress.txt。

### 模块测试报告（report.md）

路径：`test_project/<NN-Project>/results/latest/{module}/report.md`

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
| 1 | TC-001 | xxx | PASS | ![](screenshots/tc-001-result.png) |
| 2 | TC-002 | xxx | FAIL | ![](screenshots/tc-002-error.png) |

## 详细结果

### TC-001: <名称> - PASS/FAIL
**步骤**:
1. 操作 → ![](screenshots/tc-001-xxx.png)
**预期**: ...
**实际**: ...

---

## 缺陷汇总

| # | 严重程度 | 用例 | 描述 | 建议 |
|---|---------|------|------|------|

## 修复记录

| # | 问题 | 修复方式 |
|---|------|---------|

## 环境信息
- 浏览器: Chromium
- 分辨率: 1920x1080
- 操作系统: <自动检测>
```

### 汇总报告（summary.md）

路径：`test_project/<NN-Project>/results/latest/summary.md`

聚合所有模块的测试结果，每次执行后更新：

```markdown
# 测试汇总报告

## 概要
- 目标应用: <URL>
- 测试时间: <YYYY-MM-DD HH:mm>
- 总体结果: <总通过数>/<总用例数> 通过（通过率 XX%）

## 模块结果概览

| 模块 | 通过/总数 | 通过率 | 详细报告 |
|------|----------|--------|---------|
| 用户管理 | 7/7 | 100% | [查看](user-management/report.md) |
| 角色管理 | 20/22 | 91% | [查看](role-management/report.md) |

## 所有缺陷汇总

| # | 严重程度 | 模块 | 用例 | 描述 | 建议 |
|---|---------|------|------|------|------|
```

### 截图规范

路径：`test_project/<NN-Project>/results/latest/{module}/screenshots/`

命名格式：`tc-{编号}-{简称}.png`

示例：`tc-001-login-page.png`、`tc-002-error.png`

截图要求：
- 每个用例至少 3 张：初始页面、关键操作后、最终结果
- 页面跳转后必须截图
- 错误/异常状态必须截图
- 截图失败标注 `（截图未生成）`
- 所有截图必须本次执行实时截取，禁止引用历史报告

**截图归属规则（强制）**：
- 截图必须存放在对应模块的 `screenshots/` 目录下
- 报告只能引用**同模块同目录**下的截图，禁止跨模块引用
- 截图文件名中的 TC 编号必须与报告中的 TC 编号一致
- 每个截图只能被一个 TC 引用，禁止多 TC 复用同一截图

## 7. 环境管理

### 测试环境配置

- 环境配置存放在 `test-config/environment.json`
- 敏感信息（密码、Token）使用占位符，运行时由用户提供
- 支持多环境：`environment-dev.json`、`environment-staging.json`

### 依赖服务

- 数据库优先使用 Docker / TestContainers
- Redis / MQ 等中间件同上
- 外部第三方 API 必须 mock

## 8. 测试执行规则

### 执行顺序

1. L1 单元测试 → 全量执行
2. L2 接口测试 → 仅执行变更涉及模块
3. L3 E2E 测试 → 仅执行变更涉及的流程
4. L4 UI 测试 → 仅执行变更涉及的页面

### 重试机制

- 操作失败时先获取最新页面快照
- 根据最新状态调整选择器后重试，最多 3 次
- 仍失败则标记为 FAIL 并继续下一个用例

### 数据安全

- 只通过新增操作测试，禁止修改/删除已有数据
- 测试数据使用统一前缀（如 `test_`）便于识别和清理

### 操作方式

- 所有操作通过浏览器 UI 完成，禁止直接调 API 或操作数据库
- 使用 CSS 选择器定位元素，只用快照中出现的 class/id
- 优先使用 `:has-text()` 定位按钮

## 9. 测试覆盖率要求

| 层级 | 最低覆盖率 | 目标覆盖率 |
|------|-----------|-----------|
| L1 单元测试 | 60% | 80%+ |
| L2 接口测试 | 40% | 70%+ |
| L3 E2E 测试 | 核心流程 100% | 关键路径全覆盖 |
| L4 UI 测试 | 主页面 100% | 核心交互全覆盖 |

> 覆盖率不是硬性指标，根据项目实际情况和用户要求调整。

## 10. 优先级定义

| 级别 | 说明 | 触发条件 |
|------|------|---------|
| P0 | 必须测试 | 变更涉及核心业务逻辑、安全相关、数据完整性 |
| P1 | 应该测试 | 变更涉及一般功能、API 接口、页面交互 |
| P2 | 可选测试 | 变更涉及样式调整、文档更新、配置变更 |
