# 项目规则索引

本目录下所有 `.md` 文件由 Claude Code 自动加载，无需显式引用。

## 规则总览

```
基础层（项目不变量）
├── 01-pipeline-rules        九阶段状态机、主会话职责、环境检查、调度管线、用户确认点
├── 02-project-rules         目录结构、注册表双写、Git 规则、文件保护、禁止修改列表

环境配置层（Agent 约束，管线上游）
├── 03-analyzer-rules        analyzer 顶层索引（核心职责 + 子规则引用）
│   └── references/
│       ├── 03-0a-code-analysis     端口推断 + 技术栈 + 中间件 + 凭据
│       ├── 03-0b-db-init           数据库初始化方案 + 版本化 SQL
│       ├── 03-0c-docs-extraction   文档提取 + 构建识别 + 目录布局映射
│       ├── 03-0d-remote-probe      远程探测工具 + 探测项
│       └── 03-0e-output-schema     environment.json.analyzer 字段模板
├── 04-deployer-rules        deployer 顶层索引（核心理念 + 熔断 + 子规则引用）
│   └── references/
│       ├── 04-0a-validation        交叉验证 + 唯一知识来源
│       ├── 04-0b-deploy-testcases  DEPLOY-001~010 用例 + 执行细节
│       ├── 04-0c-output-and-backup 产出文件 + 报告 + 备份 + 回滚
│       └── 04-0d-deploy-guide      deploy.md 完整部署指南模板
├── 05-validator-rules      validator agent — 环境验证 + 健康检查 + 环境验证报告

测试执行层（Agent 约束，管线下游）
├── 06-planner-rules        planner agent — TC 编号、计划分层、用户案例优先级、Seed 生成、用户确认流程
├── 07-generator-rules      generator agent — 直接生成/录制模式、代码生成、等待策略、断言约束
├── 08-healer-rules         healer agent — 修复流程、结果更新、progress/report/截图规范

报告与发布层
├── 09-report-rules         Report 阶段 — 格式选择（Markdown/DOCX）、报告生成
│   └── references/
│       └── 09-0a-generate-report    DOCX 报告生成流程 + 路径约定 + 核心约束
```

| 管线阶段 | 适用规则 | Agent |
|---------|---------|-------|
| Detect | 01, 02 | scan.sh |
| Analyze | 01, 02, 03 | project-manage-analyzer |
| Build | 01, 02, 04 | project-manage-deployer |
| Validate | 01, 02, 05 | project-manage-validator |
| Plan | 01, 06 | planner |
| Generate | 01, 07 | generator |
| Execute | 01, 08 | healer（按需） |
| Report | 01, 09 | 主会话 + generate-report.mjs |
| Publish | 01 | test-result-publisher |

全局规则（所有阶段）：01（管线状态+编排）、02（项目不变量+文件保护）

## 规则与 Agent 定义的关系

Agent 定义文件（`.claude/agents/`）声明**工作流步骤和模板**，规则文件定义**强制约束**：

| Agent 定义 | 约束规则 |
|-----------|---------|
| `project-manage-analyzer.md` | `03-analyzer-rules.md`（+ 03-0a~0e 子规则） |
| `project-manage-deployer.md` | `04-deployer-rules.md`（+ 04-0a~0d 子规则） |
| `project-manage-validator.md` | `05-validator-rules.md` |
| `playwright-test-planner.md` | `06-planner-rules.md` |
| `playwright-test-generator.md` | `07-generator-rules.md` |
| `playwright-test-healer.md` | `08-healer-rules.md` |
| Report 阶段（主会话） | `09-report-rules.md`（+ 09-0a 子规则） |
| `test-result-publisher.md` | `01-pipeline-rules.md`（Publish 部分） |

## 规则维护规范

### 文件规模

| 行数范围 | 处理方式 |
|---------|---------|
| < 200 行 | 保持单文件，无需拆分 |
| 200~400 行 | 视内容耦合度决定是否拆分 |
| > 400 行 | **必须拆分**，抽取子规则到 `references/` |

### 拆分规则

1. **顶层文件保留**：核心职责、触发条件、禁止事项、子规则索引表
2. **子规则放入 `references/`**：详细模板、执行细节、输出 schema 等具体内容

### 命名约定

```
rules/
├── NN-{name}-rules.md                    顶层规则（索引 + 核心约束）
└── references/
    └── NN-XX-{module}-rules.md           子规则（XX = 0a, 0b, ... 0z, 1a, 1b, ...）
```

- **NN**：管线阶段编号（01~08），与顶层规则对齐
- **XX**：子规则序号，从 `0a` 开始递增（`0a` → `0z` → `1a` → `1z` → ...）
- **name/module**：简短英文，见名知意
