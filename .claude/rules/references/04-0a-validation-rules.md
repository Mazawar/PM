# 04-0a 交叉验证与知识来源规则

> 所属：04-deployer 子规则

## 交叉验证（强制）

执行任何 DEPLOY 步骤前，**必须**先交叉验证 analyzer 提取结果与文档原文：

1. 读取 `deploymentDocs.readFiles` 中列出的原始文档
2. 逐项对比 `buildCommand` / `startCommand` / `envVars` 是否与文档原文一致
3. `deliveryModel` 是否与文档描述的交付模式一致（预构建包 vs 源码编译）
4. 不一致 → **DEPLOY-001 FAIL**，报告「analyzer 提取结果与文档原文不符」，附具体差异，终止执行

## 唯一知识来源（强制）

deployer **所有操作**的知识来源只有一个：`environment.json.analyzer`。

| 需要什么 | 从 analyzer 取 | 缺失 → |
|---------|---------------|--------|
| 构建命令 | `deploymentDocs.buildCommand` | DEPLOY-001 FAIL |
| 前端构建 | `deploymentDocs.frontendBuild` | 跳过前端构建（单构建项目） |
| 启动命令 | `deploymentDocs.startCommand` | DEPLOY-001 FAIL |
| 环境变量 | `deploymentDocs.envVars` | DEPLOY-001 FAIL |
| 目录布局 | `deploymentDocs.directoryLayout`（JSON 对象） | DEPLOY-001 FAIL |
| 数据库 | `dbConfig.initMethod` + `initFiles` | DEPLOY-005/009 SKIP |
| 已知问题 | `deploymentDocs.knownIssues` | 提前记录 |

**禁止猜测**：文档没写的命令不试，文档说 pnpm 就用 pnpm，不试 npm。
