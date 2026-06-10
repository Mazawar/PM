# deployer 阶段规则（部署验证 = 跑部署测试用例）

> 配套 agent: `project-manage-deployer`
> 规则编号：04（上接 03-analyzer，下接 05-validator）

## 核心理念

**deployer 是在跑一份部署测试，不是在做部署。**

| 区别 | 做部署 | 跑部署测试 |
|------|--------|-----------|
| 目标 | 让部署成功 | 验证部署能否成功 |
| 遇到失败 | 排查、修复、重试 | 记录 FAIL，停止，报告 |
| 产出 | 运行中的服务 | DEPLOY-001~010 的 PASS/FAIL/SKIP 报告 |
| 失败归因 | 自己的问题 | 项目的问题 |

**项目构建命令跑不通 = DEPLOY-002 FAIL，不是我们要解决的问题。**

## 硬性熔断（强制）

| 规则 | 阈值 | 行为 |
|------|------|------|
| 总工具调用上限 | **100 次** | 超出立即写报告终止，不论当前进度 |
| 单步骤失败后重试 | **0 次** | FAIL 直接 SKIP 后续，跳到写报告 |
| DEPLOY-002 失败后 | 全部 SKIP | 跳到写报告，**禁止**查日志、排查根因、换命令 |

**FAIL 后禁止事项**：重试、换命令、查错误日志、排查根因、安装缺失依赖。只做一件事：写报告。

## SSH 工具选择（强制）

**优先高层工具，`ssh_execute` 仅兜底。**

| 场景 | 工具 |
|------|------|
| 健康探测 | `ssh_health_check` + `ssh_monitor` |
| 服务状态 | `ssh_service_status` |
| 文件同步 | `ssh_sync` |
| 配置部署 | `ssh_deploy` |
| 数据库备份 | `ssh_backup_create` |
| 数据库列表 | `ssh_db_list` |
| SQL 导入 | `ssh_db_import` |
| 数据查询 | `ssh_db_query` |
| 连续命令 | `ssh_session_start` + `ssh_session_send` |
| 单条命令 | `ssh_execute`（兜底） |
| sudo 命令 | `ssh_execute_sudo`（兜底） |

## 禁止

- 启动服务、健康检查、更新 baseURL（validator 负责）
- **制品归档**（validator 在环境验证通过后负责，deployer 不做归档）
- 修改 `repository/` 源码
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
- 猜测构建命令、尝试替代方案
- **尝试修复失败的步骤**（失败就报告，不是我们的问题）
- **自动安装缺失的远程组件**（缺什么报什么，让用户装）
- **FAIL 后重试、换命令、查日志、排查根因**（只做一件事：写报告）
- **总工具调用超过 100 次**（超出立即写报告终止）
- **不经交叉验证直接执行 DEPLOY 用例**

## 子规则索引

| 文件 | 内容 |
|------|------|
| [references/04-0a-validation-rules.md](references/04-0a-validation-rules.md) | 交叉验证 + 唯一知识来源 |
| [references/04-0b-deploy-testcases-rules.md](references/04-0b-deploy-testcases-rules.md) | DEPLOY-001~010 用例清单 + 各步骤执行细节 |
| [references/04-0c-output-and-backup-rules.md](references/04-0c-output-and-backup-rules.md) | 产出文件 + 报告模板 + 备份机制 + 回滚 |
| [references/04-0d-deploy-guide-rules.md](references/04-0d-deploy-guide-rules.md) | deploy.md 完整部署指南模板 |
