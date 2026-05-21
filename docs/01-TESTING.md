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
│   ├── test-plan.md            # 测试计划（含 TC 编号）
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
        ├── progress.txt        # 执行进度追踪
        ├── report.md           # 人类可读测试报告
        └── screenshots/        # 测试截图
```

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

路径：`test_project/<NN-Project>/results/latest/progress.txt`

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

进度文件是跨迭代的**唯一状态来源**，不依赖记忆。

### 测试报告（report.md）

路径：`test_project/<NN-Project>/results/latest/report.md`

```markdown
# 测试报告

## 概要
- 测试需求: <描述>
- 目标应用: <URL>
- 测试时间: <YYYY-MM-DD HH:mm>
- 执行结果: <通过数>/<总数> 通过（通过率 XX%）

## 结果概览

| # | 用例编号 | 用例名称 | 结果 | 截图 |
|---|---------|---------|------|------|
| 1 | TC-001 | 正常登录 | PASS | ![](screenshots/tc-001-result.png) |
| 2 | TC-002 | 新增用户 | FAIL | ![](screenshots/tc-002-error.png) |

## 详细结果

### TC-001: 正常登录 - PASS
**步骤**:
1. 打开登录页面 → ![](screenshots/tc-001-login-page.png)
2. 输入账号密码并提交 → ![](screenshots/tc-001-submit.png)
3. 验证跳转到首页 → ![](screenshots/tc-001-home.png)
**预期**: 登录成功，跳转到首页
**实际**: 与预期一致

---

### TC-002: 新增用户 - FAIL
**步骤**:
1. 打开用户管理页面 → ![](screenshots/tc-002-user-page.png)
2. 点击新增按钮 → ![](screenshots/tc-002-dialog.png)
3. 填写表单并提交 → ![](screenshots/tc-002-error.png)
**预期**: 新增成功提示
**实际**: 表单校验失败，提示"用户名已存在"
**错误信息**: 用户名 test_user 已被占用

---

## 缺陷汇总

| # | 严重程度 | 用例 | 描述 | 建议 |
|---|---------|------|------|------|
| 1 | 高 | TC-002 | 用户名唯一性校验未提示 | 增加前端校验 |

## 环境信息
- 浏览器: Chromium
- 分辨率: 1920x1080
- 操作系统: <自动检测>
```

### 截图规范

路径：`test_project/<NN-Project>/results/latest/screenshots/`

命名格式：`tc-{编号}-{简称}.png`

示例：`tc-001-login-page.png`、`tc-002-error.png`

截图要求：
- 每个用例至少 3 张：初始页面、关键操作后、最终结果
- 页面跳转后必须截图
- 错误/异常状态必须截图
- 截图失败标注 `（截图未生成）`
- 所有截图必须本次执行实时截取，禁止引用历史报告

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
