# 测试框架规则

## 测试层级定义

| 层级 | 名称 | 粒度 | 说明 |
|------|------|------|------|
| L1 | Unit | 毫秒级 | Mock 外部服务，验证单个函数/类逻辑 |
| L2 | API | 秒级 | 真实中间件（DB、缓存），Mock 第三方服务 |
| L3 | E2E | 分钟级 | 完整应用栈，端到端业务流程 |
| L4 | UI | 分钟级 | 浏览器交互，表单验证，响应式布局 |

## 框架选择

优先使用项目已有测试框架（检查 pom.xml、package.json、go.mod、requirements.txt），否则按以下默认映射：

- Java/Spring → JUnit5 + Mockito / Spring Boot Test + REST Assured
- Python → pytest + unittest.mock / pytest + requests
- Node.js/Vue/React → Jest + Testing Library / Supertest / Playwright
- Go → testing + testify

UI 测试统一使用 Playwright。

## 覆盖要求

| 层级 | 最低 | 目标 |
|------|------|------|
| L1 | 60% | 80%+ |
| L2 | 40% | 70%+ |
| L3 | 核心流程 100% | 所有关键路径 |
| L4 | 主页面 100% | 核心交互 |

## 测试数据安全

- **优先创建**新测试数据，避免修改/删除已有数据
- 所有测试数据使用 `test_` 前缀
- 每个测试文件开头添加 cleanup 步骤，清理残留数据
- **数据冲突时**：允许修改测试数据值保证唯一性（如加 `Date.now()` 后缀），但不得删除其他 TC 依赖的数据
- 测试执行顺序：L1 全量 → L2/L3/L4 仅变更模块

## 测试操作约束

- 使用浏览器 UI 操作，禁止直接 API 调用或数据库操作（除特殊场景如登录初始化）
- 不得跳过用例，除非有客观原因（404、功能未实现）
- 每次迭代最多 5 个用例，按 TC 编号优先级执行
- 单个用例超时 5 分钟

## 测试 ID 格式

- 脚本文件：`TP-<project>-L<level>-<NNN>`（如 `TP-01-RuoYi-Vue-L3-003`）
- 计划与报告：`TC-XXX`（全局唯一，跨模块连续递增）

