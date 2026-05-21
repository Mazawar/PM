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
test_project/<项目编号>/
├── reports/                    # 扫描变更报告（脚本自动生成）
│   ├── 2026-05-21_103500.md   # 原始变更报告
│   └── summary.md             # Agent 分析的变更汇总
├── tests/                      # 测试代码
│   ├── unit/                   # L1 单元测试
│   ├── api/                    # L2 接口/集成测试
│   ├── e2e/                    # L3 E2E 流程测试
│   └── ui/                     # L4 UI 自动化测试
├── test-config/                # 测试配置
│   ├── environment.json        # 环境配置（URL、端口、凭证占位）
│   └── test-plan.md            # 当前测试计划
└── results/                    # 测试执行结果
    ├── latest/                 # 最近一次执行结果
    └── history/                # 历史执行记录
```

## 4. 测试用例格式

每个测试文件头部必须包含元信息注释：

```java
// TEST-ID: TP-<项目编号>-L<层级>-<序号>
// TEST-NAME: <测试名称>
// TEST-LEVEL: L1|L2|L3|L4
// TEST-TARGET: <测试目标模块/接口/页面>
// TEST-PREREQUISITE: <前置条件>
// TEST-STEPS: <步骤概述>
// TEST-EXPECTED: <预期结果>
```

## 5. 环境管理

### 测试环境配置

- 环境配置存放在 `test-project/<项目>/test-config/environment.json`
- 敏感信息（密码、Token）使用占位符，运行时由用户提供
- 支持多环境：`environment-dev.json`、`environment-staging.json`

### 依赖服务

- 数据库优先使用 Docker / TestContainers
- Redis / MQ 等中间件同上
- 外部第三方 API 必须 mock

## 6. 测试执行规则

### 执行顺序

1. L1 单元测试 → 全量执行
2. L2 接口测试 → 仅执行变更涉及模块
3. L3 E2E 测试 → 仅执行变更涉及的流程
4. L4 UI 测试 → 仅执行变更涉及的页面

### 结果判定

| 状态 | 说明 |
|------|------|
| PASS | 所有断言通过 |
| FAIL | 断言失败，记录实际值与期望值 |
| ERROR | 运行时异常，记录堆栈信息 |
| SKIP | 条件不满足跳过，记录跳过原因 |

### 结果报告

每次测试执行后生成报告到 `results/latest/`：
- `report.json` — 机器可读的测试结果
- `report.md` — 人类可读的测试摘要
- 失败用例必须包含：复现步骤、错误日志、截图（UI 测试）

## 7. 测试覆盖率要求

| 层级 | 最低覆盖率 | 目标覆盖率 |
|------|-----------|-----------|
| L1 单元测试 | 60% | 80%+ |
| L2 接口测试 | 40% | 70%+ |
| L3 E2E 测试 | 核心流程 100% | 关键路径全覆盖 |
| L4 UI 测试 | 主页面 100% | 核心交互全覆盖 |

> 覆盖率不是硬性指标，根据项目实际情况和用户要求调整。
