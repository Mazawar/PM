# analyzer 阶段规则（本地源码分析 + 远程探测）

> 配套 agent: `project-manage-analyzer`
> 规则编号：03（上接 02-project-rules，下接 04-deployer）

## 核心职责

**只读分析 + 写入 environment.json.analyzer 段**。禁止执行构建、禁止启动服务、禁止写 build/、禁止写环境验证报告、禁止询问用户构建模式、禁止询问服务器绑定。

## 输入与输出

### 输入
- `repository/<NN-Project>/` 源码（只读）

### 输出
- `test_project/<NN-Project>/test-config/environment.json.analyzer.*` 段
- `test_project/<NN-Project>/playwright.config.ts`
- `test_project/<NN-Project>/vitest.config.ts`（如 L2 API 测试需要）
- 初始化目录（`init-dirs.mjs` 自动创建 case/、plans/、tests/、test-config/、results/、scan-logs/、build/artifacts/）

## 触发条件

- `environment.json.analyzer.completedAt` 缺失时启动
- `environment.json.build.mode` 未设 → 本次只做本地分析
- `environment.json.build.mode == "remote"` 且 `remoteConfig.server` 非空 → 同时做远程探测

## 保护文件（不删不改）

- `test_project/<NN-Project>/.last_hash`
- `test_project/<NN-Project>/.pipeline-state.json`
- `test_project/<NN-Project>/case/`

## 完成后必做

- 写 `analyzer.completedAt` = ISO 时间戳
- 输出 analyzer 段摘要
- **不执行构建、不启动服务、不问用户构建模式、不问服务器绑定**

## 子规则索引

| 文件 | 内容 |
|------|------|
| [references/03-0a-code-analysis-rules.md](references/03-0a-code-analysis-rules.md) | 端口推断 + 技术栈识别 + 中间件推断 + 凭据推断 |
| [references/03-0b-db-init-rules.md](references/03-0b-db-init-rules.md) | 数据库初始化优先级 + 版本化 SQL + dbConfig schema |
| [references/03-0c-docs-extraction-rules.md](references/03-0c-docs-extraction-rules.md) | track/ 文档提取 + 提取纪律 + 前后端分离构建识别 + 目录布局映射 |
| [references/03-0d-remote-probe-rules.md](references/03-0d-remote-probe-rules.md) | 远程探测工具 + 探测项 + 失败处理 + 完成后约束 |
| [references/03-0e-output-schema-rules.md](references/03-0e-output-schema-rules.md) | environment.json.analyzer 写入字段模板 |
