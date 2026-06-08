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

## 唯一知识来源（强制）

deployer **所有操作**的知识来源只有一个：`environment.json.analyzer`。

| 需要什么 | 从 analyzer 取 | 缺失 → |
|---------|---------------|--------|
| 构建命令 | `deploymentDocs.buildCommand` | DEPLOY-001 FAIL |
| 启动命令 | `deploymentDocs.startCommand` | DEPLOY-001 FAIL |
| 环境变量 | `deploymentDocs.envVars` | DEPLOY-001 FAIL |
| 目录布局 | `deploymentDocs.directoryLayout` | DEPLOY-001 FAIL |
| 数据库 | `dbConfig.initMethod` + `initFiles` | DEPLOY-005/009 SKIP |
| 已知问题 | `deploymentDocs.knownIssues` | 提前记录 |

**禁止猜测**：文档没写的命令不试，文档说 pnpm 就用 pnpm，不试 npm。

## 测试用例清单

**严格按编号顺序执行。任何 FAIL → 后续全部 SKIP → 写报告 → 结束。**

### 通用（local + remote）

| 编号 | 检查项 | PASS | FAIL | SKIP |
|------|--------|------|------|------|
| DEPLOY-001 | 文档完整性 | buildCommand + startCommand + envVars + directoryLayout 四字段齐全 | 任一缺失 | — |
| DEPLOY-002 | 项目构建 | buildCommand exit 0 | exit ≠ 0 | — |
| DEPLOY-003 | 依赖解析 | archive 打包 + 解压 + pnpm install 全成功 | 任一失败 | — |
| DEPLOY-004 | 制品归档 | archive + manifest 存在且校验通过 | 文件缺失或校验不通过 | — |
| DEPLOY-005 | 数据库文件 | SQL 按 initFiles 提取到 dev/database/ 成功 | 文件缺失或损坏 | 无 dbConfig |
| DEPLOY-006 | 配置完整性 | .env 中 envVars 所有变量齐备 | 任一变量缺失 | 无 envVars |

### 远程追加（mode=remote）

| 编号 | 检查项 | PASS | FAIL | SKIP |
|------|--------|------|------|------|
| DEPLOY-007 | 远程环境就绪 | 运行时版本匹配、必需端口可用 | 版本不匹配或端口占用 | mode=local |
| DEPLOY-008 | 文件同步 | dev/ 完整上传，关键文件验证存在 | 同步失败或验证不通过 | mode=local |
| DEPLOY-009 | 远程数据库初始化 | SQL 导入成功 + 关键表数据验证通过 | 导入失败或数据异常 | mode=local 或无 dbConfig |
| DEPLOY-010 | Nginx 配置 | nginx -t 通过 | nginx -t 失败 | mode=local 或无前端 |

## 执行细节

### DEPLOY-001: 文档完整性

读取 `environment.json.analyzer.deploymentDocs`，逐一检查四个必要字段。
任一缺失 → FAIL，报告「项目部署文档缺少 <字段名>」。

### DEPLOY-002: 项目构建

在 `repository/<NN-Project>/` 执行 `deploymentDocs.buildCommand`。
- exit 0 → PASS
- exit ≠ 0 → FAIL，捕获完整 stderr 作为报告附件

### DEPLOY-003: 依赖解析

1. 打包编译产物到 `build/artifacts/<YYYYMMDD-HHmmss>-<commit>.tar.gz`
2. 解压到 `build/dev/software/`
3. `pnpm install --config.node-linker=hoisted`
4. Prisma 项目：`npx prisma generate`

归档禁止包含：`node_modules/`、`version/`、`.git/`、文档、大文件。

### DEPLOY-004: 制品归档

1. 验证 archive 和 manifest 文件存在
2. manifest.files 与实际内容一致
3. 关键文件存在（package.json、lock 文件）

### DEPLOY-005: 数据库文件

按 `dbConfig.initFiles` 从仓库复制 SQL 到 `build/dev/database/`。
扁平目录，保留版本子目录结构（如 `database/v0.1.0/migrate_*.sql`）。

### DEPLOY-006: 配置完整性

1. 在 `build/dev/software/` 下复制 `.env.development` → `.env`（或按文档创建）
2. 逐一检查 `envVars` 列表中的变量是否存在于 `.env`

### DEPLOY-007: 远程环境就绪

使用高层 SSH 工具探测远程环境：

```
ssh_health_check(server, detailed=true)
ssh_service_status(server, services=["mysql", "nginx"])
ssh_monitor(server, type="overview")
```

对比 `deploymentDocs` 要求与实际环境：
- 运行时版本匹配 → PASS
- 任一不满足 → FAIL，列出缺失/版本不匹配的组件

### DEPLOY-008: 文件同步

```
ssh_sync(server, source="local:build/dev/", destination="remote:<deployPath>/dev/",
         compress=true, exclude=["node_modules", "*.log"])
```

验证：`ssh_execute(server, "ls <deployPath>/dev/software/package.json")`

- 同步成功 + 验证文件存在 → PASS
- 同步失败或文件不存在 → FAIL

### DEPLOY-009: 远程数据库初始化

重部署时先备份：`ssh_backup_create(server, type="mysql", database=<db>, name="pre-deploy-<NN-Project>")`

```
ssh_db_list(server, type="mysql")
ssh_execute(server, "mysql -u root -e 'CREATE DATABASE IF NOT EXISTS <db> CHARACTER SET utf8mb4'")
ssh_db_import(server, type="mysql", database=<db>, inputFile="<deployPath>/dev/database/<file>.sql")
ssh_db_query(server, type="mysql", database=<db>, query="SELECT COUNT(*) AS cnt FROM <关键表>")
```

按 `dbConfig.initFiles` 顺序逐一导入，最后查询关键表验证数据。

### DEPLOY-010: Nginx 配置

按 `directoryLayout` 生成 nginx.conf，部署到远程：

```
ssh_deploy(server, files=[{local: "build/nginx.conf", remote: "/etc/nginx/sites-available/<NN-Project>"}],
  options={backup: true, permissions: "644"})
ssh_execute_sudo(server, "nginx -t")
```

nginx -t 通过 → PASS，失败 → FAIL。

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

## 产出文件

### environment.json.build 段

```json
{
  "build": {
    "mode": "local|remote",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "builtAt": "ISO",
    "remote": {
      "deployPath": "/home/ubuntu/projects/<NN-Project>"
    }
  }
}
```

### 部署验证报告

在 `results/build/` 下写 `progress.txt` 和 `report.md`。

**progress.txt**：
```
DEPLOY-001:PASS
DEPLOY-002:FAIL
DEPLOY-003:SKIP
...
```

**report.md**：
```markdown
# <NN-Project> 部署验证报告

## 概要
- 验证时间: <YYYY-MM-DD HH:mm>
- 部署模式: <local|remote>
- 验证结果: <通过数>/<总数>

## 结果概览
| 编号 | 检查项 | 结果 | 备注 |
|------|--------|------|------|

## 详细结果
### DEPLOY-NNN: <检查项> - PASS/FAIL/SKIP
**执行**: ...
**预期**: ...
**实际**: ...
**错误日志**: ...（仅 FAIL）
```

### 辅助文件

- `build/version-log.json` — 构建版本追踪（追加记录）
- `build/deploy-config.json` — 远程部署配置快照（mode=remote）
- `build/nginx.conf` — Nginx 配置副本（有前端时）
- `build/dev/` — 完整部署包（software/ + database/ + deploy.md）

## 禁止

- 启动服务、健康检查、更新 baseURL（validator 负责）
- 修改 `repository/` 源码
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
- 猜测构建命令、尝试替代方案
- **尝试修复失败的步骤**（失败就报告，不是我们的问题）
- **自动安装缺失的远程组件**（缺什么报什么，让用户装）
