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

## 测试用例清单

**严格按编号顺序执行。任何 FAIL → 后续全部 SKIP → 写报告 → 结束。**

### 通用（local + remote）

| 编号 | 检查项 | PASS | FAIL | SKIP |
|------|--------|------|------|------|
| DEPLOY-001 | 文档完整性 | buildCommand + startCommand + envVars + directoryLayout（JSON 对象，含 backend） + deliveryModel 五字段齐全（有前端时 frontendBuild 也需齐全） | 任一缺失，或 directoryLayout 为字符串（旧格式需重跑 analyzer） | — |
| DEPLOY-002 | 项目构建 | 后端 buildCommand exit 0；有 frontendBuild 时前端也 exit 0 | 任一 exit ≠ 0 | — |
| DEPLOY-003 | 依赖解析 | archive 打包 + 解压 + 按文档安装依赖 全成功 | 任一失败 | — |
| DEPLOY-004 | 制品归档 | archive + manifest 存在且校验通过 | 文件缺失或校验不通过 | — |
| DEPLOY-005 | 数据库文件 | SQL 按 initFiles 提取到 dev/database/ 成功 | 文件缺失或损坏 | 无 dbConfig |
| DEPLOY-006 | 配置完整性 | .env 中 envVars 所有变量齐备 | 任一变量缺失 | 无 envVars |

### 远程追加（mode=remote）

| 编号 | 检查项 | PASS | FAIL | SKIP |
|------|--------|------|------|------|
| DEPLOY-007 | 远程环境就绪 | 运行时版本匹配、必需端口可用 | 版本不匹配或端口占用 | mode=local |
| DEPLOY-008 | 产物同步 | 构建**产物**（非源码）完整上传，关键文件验证存在 | 同步失败或验证不通过 | mode=local |
| DEPLOY-009 | 远程数据库初始化 | SQL 导入成功 + 关键表数据验证通过 | 导入失败或数据异常 | mode=local 或无 dbConfig |
| DEPLOY-010 | Nginx 配置 | nginx -t 通过 | nginx -t 失败 | mode=local 或无前端 |

## 执行细节

### DEPLOY-001: 文档完整性

读取 `environment.json.analyzer.deploymentDocs`，逐一检查五个必要字段（buildCommand、startCommand、envVars、directoryLayout、deliveryModel）。

**directoryLayout 格式校验**：必须是 JSON 对象且含 `backend` 字段。如果 `directoryLayout` 是字符串 → FAIL，报告「directoryLayout 格式已升级为 JSON 对象，请重跑 analyzer」。如果 `frontendBuild` 存在但 `directoryLayout.frontend` 缺失 → FAIL。

**交叉验证**：同时读取 `deploymentDocs.readFiles` 和 `deploymentDocs.sourceLocations`，验证提取结果与文档原文一致。不一致 → FAIL，报告具体差异。

任一缺失或验证不通过 → FAIL，报告「项目部署文档缺少 <字段名>」。

### DEPLOY-002: 项目构建

根据 `deploymentDocs.deliveryModel` 分支：

**`deliveryModel: "pre-built"`**：跳过源码编译，验证仓库中预构建包结构：
- 检查文档描述的产物目录是否存在于仓库中（如 `api/`、`web/`、`node_modules/`）
- 产物存在 → PASS，直接进入 DEPLOY-003
- 产物不存在 → FAIL，报告「文档声称预构建包含 <目录>，但仓库中未找到」

**`deliveryModel: "source-build"`**：分步构建后端和前端。

**步骤 1 — 后端构建**：在 `repository/<NN-Project>/` 执行 `deploymentDocs.buildCommand`。
- exit 0 → 继续
- exit ≠ 0 → FAIL，捕获完整 stderr，**不做任何排查**

**步骤 2 — 前端构建**（仅 `frontendBuild` 字段存在时）：
- 在 `repository/<NN-Project>/<frontendBuild.workDir>` 下先安装依赖（`npm install` 或按文档），再执行 `frontendBuild.command`
- exit 0 → 继续
- exit ≠ 0 → FAIL，捕获 stderr，**不做任何排查**
- `frontendBuild` 不存在 → 跳过前端构建（单构建项目）

两步都成功 → PASS。任一失败 → FAIL。

**`deliveryModel` 缺失或为其他值**：FAIL，报告「deploymentDocs.deliveryModel 未设置或无效」。

### DEPLOY-003: 依赖解析

根据 `deliveryModel` 分支：

**`pre-built`**：预构建包已包含依赖，跳过安装步骤。按 `directoryLayout` 将仓库产物映射到扁平结构：
- `directoryLayout.backend.source` → `build/dev/backend/`
- `directoryLayout.frontend.source` → `build/dev/frontend/`（有 frontend 时）
- 验证关键产物文件存在

**`source-build`**：
1. 打包后端编译产物到 `build/artifacts/<YYYYMMDD-HHmmss>-<commit>.tar.gz`
2. 解压后端产物到 `build/dev/backend/`（从 `directoryLayout.backend.source` 提取）
3. **前端产物归档**（仅 `frontendBuild` 存在时）：
   - 从 `repository/<NN-Project>/<frontendBuild.workDir>/<frontendBuild.outputDir>` 复制构建产物到 `build/dev/frontend/`（扁平化，构建产物直接放 frontend/ 下）
   - 产物是静态文件（HTML/JS/CSS），不需要在服务器上安装 Node.js
4. 如后端文档要求额外步骤（如 Prisma generate），按文档执行

归档禁止包含：`node_modules/`、`version/`、`.git/`、文档、大文件。
**前端产物归档禁止包含源码**，只归档 `frontendBuild.outputDir` 下的构建产物。

### DEPLOY-004: 制品归档

**`pre-built`**：验证预构建包目录结构完整（按 `directoryLayout` 对象的 `backend`/`frontend`/`database` 字段逐项检查产物目录和文件存在）。

**`source-build`**：
1. 验证 archive 和 manifest 文件存在
2. manifest.files 与实际内容一致
3. 关键文件存在（按文档要求检查）

### DEPLOY-005: 数据库文件

按 `dbConfig.initFiles` 从仓库复制 SQL 到 `build/dev/database/`。
扁平目录，保留版本子目录结构（如 `database/v0.1.0/migrate_*.sql`）。

### DEPLOY-006: 配置完整性

1. 在 `build/dev/backend/` 下复制 `.env.development` → `.env`（或按文档创建）
2. 逐一检查 `envVars` 列表中的变量是否存在于 `.env`

### DEPLOY-007: 远程环境就绪

**优先批量命令**（单次 SSH 调用收集全部信息）：

```bash
ssh_execute "echo '===JAVA===' && java -version 2>&1 | head -1 && echo '===MAVEN===' && mvn -version 2>&1 | head -1 && echo '===MYSQL===' && mysql --version && echo '===NGINX===' && nginx -v 2>&1 && echo '===PORTS===' && ss -tlnp | grep -E ':(80|8080) '"
```

解析分隔输出，对比 `deploymentDocs` 要求。需详细信息时再用高层工具补充：
- `ssh_health_check(server, detailed=true)`
- `ssh_service_status(server, services=["mysql", "nginx"])`

对比结果：
- 运行时版本匹配 → PASS
- 任一不满足 → FAIL，列出缺失/版本不匹配的组件

### DEPLOY-008: 产物同步

**核心原则：只上传构建产物，不上传源码。** 远程服务器不应需要安装编译工具链。

上传内容（仅限）：
- 后端构建产物 → `build/dev/backend/`
- 前端构建产物 → `build/dev/frontend/`（有前端时）
- 数据库初始化文件 → `build/dev/database/`
- 配置文件（`.env`） → `build/dev/backend/.env`
- `deploy.md`

禁止上传：
- 前端源码（`src/`、`*.vue`、`*.tsx` 等）
- `node_modules/`
- 构建工具配置（`webpack.config.*`、`vite.config.*`、`package.json` 等开发依赖）

```
ssh_sync(server, source="local:build/dev/", destination="remote:<deployPath>/",
         compress=true, exclude=["node_modules", "*.log"])
```

验证后端产物：`ssh_execute(server, "ls <deployPath>/backend/<directoryLayout.backend.artifact>")`
验证前端产物：`ssh_execute(server, "ls <deployPath>/frontend/index.html")`（有 frontend 时）

- 同步成功 + 产物验证存在 → PASS
- 同步失败或产物不存在 → FAIL

### DEPLOY-009: 远程数据库初始化

**部署前备份**（非首次部署时）：
1. 检查数据库是否已存在：`ssh_db_list(server, type="mysql")`
2. 数据库已存在 → 备份：
   - `ssh_backup_create(server, type="mysql", database=<db>, name="pre-deploy-<NN-Project>")`
   - 备份远程配置：`ssh_execute(server, "cp <deployPath>/backend/.env /var/backups/pm/<NN-Project>/backend.env.bak")`（如 .env 存在）
3. 写入备份清单到 `/var/backups/pm/<NN-Project>/manifest.json`
4. 清理超过 5 份的旧备份

**数据库初始化**：
```
ssh_execute(server, "mysql -u root -e 'CREATE DATABASE IF NOT EXISTS <db> CHARACTER SET utf8mb4'")
ssh_db_import(server, type="mysql", database=<db>, inputFile="<deployPath>/database/<file>.sql")
ssh_db_query(server, type="mysql", database=<db>, query="SELECT COUNT(*) AS cnt FROM <关键表>")
```

按 `dbConfig.initFiles` 顺序逐一导入，最后查询关键表验证数据。

### DEPLOY-010: Nginx 配置

**前端服务策略（强制）**：除非项目文档明确要求前端以 dev 模式运行（如 `npm run dev`），否则**一律**通过 Nginx 托管前端静态文件。deployer 不在远程服务器上安装 Node.js 或运行前端 dev server。

Nginx 配置内容：
- 静态文件根目录指向 `<deployPath>/frontend/`
- API 请求反代到后端（如 `/prod-api/` → `http://localhost:<backendPort>`）
- 有前端时**必须**生成 nginx.conf

部署到远程：

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

在 `test_project/<NN-Project>/results/.build/deploy/` 下写 `progress.txt` 和 `report.md`。

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

### deploy.md（强制，完整部署指南）

`build/dev/deploy.md` 是**独立可用的部署文档**。拿到 `build/dev/` 整个目录的人，只凭这份文档就能从零部署项目，不需要回看源码或 analyzer 输出。

**内容模板**（deployer 从 `environment.json.analyzer` 提取实际值填充）：

```markdown
# <项目名> 部署指南

## 1. 环境要求

| 组件 | 版本要求 | 验证命令 |
|------|---------|---------|
| OS | Ubuntu 20.04+ | `lsb_release -a` |
| Java | <从 techStack 取，如 21+> | `java -version` |
| Maven | <如有> | `mvn -version` |
| MySQL | <从 middleware 取，如 8.0+> | `mysql --version` |
| Nginx | <有前端时要求> | `nginx -v` |

磁盘空间：后端产物 <大小>M + 前端 <大小>M + 数据库 <大小>M ≈ <总大小>M

## 2. 环境安装

### Java
```bash
# Ubuntu (Adoptium Temurin)
sudo apt-get update
sudo apt-get install -y wget apt-transport-https
wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public | sudo apt-key add -
echo "deb https://packages.adoptium.net/artifactory/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/adoptium.list
sudo apt-get update
sudo apt-get install -y temurin-<版本>-jdk
```

### Maven（如需要）
```bash
sudo apt-get install -y maven
```

### MySQL
```bash
sudo apt-get install -y mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
# 安全初始化（可选）
sudo mysql_secure_installation
```

### Nginx（有前端时）
```bash
sudo apt-get install -y nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

## 3. 数据库初始化

```bash
# 创建数据库
sudo mysql -u root -e "CREATE DATABASE IF NOT EXISTS <数据库名> DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_0900_ai_ci;"

# 导入 SQL（按顺序）
sudo mysql -u root <数据库名> < database/<文件1>.sql
sudo mysql -u root <数据库名> < database/<文件2>.sql
...

# 验证
sudo mysql -u root <数据库名> -e "SHOW TABLES;"
```

预期表数量：<从 dbConfig 推断>

## 4. 部署项目

### 上传文件
将本目录（dev/）上传到服务器：
```bash
scp -r dev/ <user>@<server>:<deployPath>/
```

### 配置环境变量
编辑 `<deployPath>/backend/.env`：
```env
<逐一列出 envVars 及其值/说明>
```

### 目录结构
```
<deployPath>/
├── backend/
│   ├── <主产物文件>（如 xxx.jar）
│   └── .env
├── frontend/        （有前端时）
│   └── index.html
├── database/
│   └── *.sql
└── logs/
```

## 5. Nginx 配置（有前端时）

创建配置文件：
```bash
sudo cp <deployPath>/../nginx.conf /etc/nginx/sites-available/<项目名>
sudo ln -sf /etc/nginx/sites-available/<项目名> /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

nginx.conf 内容见同目录下 `nginx.conf` 文件。

## 6. 启动服务

```bash
cd <deployPath>/backend
nohup java -jar <主产物文件> <启动参数> > <deployPath>/logs/backend.log 2>&1 &
```

验证端口监听：
```bash
ss -tlnp | grep :<backendPort>
```

## 7. 验证

```bash
# 健康检查
curl -s -o /dev/null -w "%{http_code}" http://localhost:<backendPort><healthCheck路径>
# 预期: <expectedStatus>

# 前端页面
curl -s -o /dev/null -w "%{http_code}" http://localhost:<frontendPort>
# 预期: 200

# 登录验证
curl -s -X POST http://localhost:<backendPort>/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<用户名>","password":"<密码>"}'
# 预期: 含 token 的 JSON
```

## 8. 运维

### 停止服务
```bash
kill $(ss -tlnp | grep :<backendPort> | grep -oP 'pid=\K[0-9]+')
```

### 重启服务
```bash
# 先停止，再执行「启动服务」步骤
```

### 查看日志
```bash
tail -f <deployPath>/logs/backend.log
```

### 常见问题
| 问题 | 排查 |
|------|------|
| 端口被占用 | `ss -tlnp \| grep :<端口>` 找到占用进程 |
| 数据库连接失败 | 检查 .env 中 MYSQL_* 变量，`systemctl status mysql` |
| Nginx 502 | 后端未启动或端口不对，检查 backend.log |
| 前白屏 | 检查 Nginx 配置中前端静态文件路径是否正确 |
```

**填充规则**：
- 所有 `<占位符>` 从 `environment.json.analyzer` 对应字段取值
- `<>` 中的内容必须替换为实际值，不允许保留占位符
- 有前端时包含第 5 节（Nginx），无前端时删除
- Maven/Node.js/Python 等运行时按实际 techStack 选择性包含
- MySQL/PostgreSQL/MongoDB 按实际 dbConfig 选择对应命令
- 数据库安装命令需包含 `--default-character-set=utf8mb4`（MySQL）

### 其他辅助文件

- `build/version-log.json` — 构建版本追踪（追加记录）
- `build/deploy-config.json` — 远程部署配置快照（mode=remote）
- `build/nginx.conf` — Nginx 配置副本（有前端时）
- `build/backups/backup-manifest.json` — 本地备份清单（仅元数据）

## 备份机制

### 本地备份（DEPLOY-003 前）

覆盖 `build/dev/` 前检查已有产物：
1. `build/dev/backend/.env` 存在 → 复制到 `build/backups/pre-deploy-<timestamp>/backend.env.bak`
2. 写入 `build/backups/backup-manifest.json` 追加一条记录
3. 清理超过 5 份的旧备份

### 远程备份（DEPLOY-009 前）

见 DEPLOY-009 执行细节。备份存储在 `/var/backups/pm/<NN-Project>/`，由 SSH backup 工具管理。

### 备份清单格式（manifest.json）

```json
{
  "project": "<NN-Project>",
  "backups": [
    {
      "id": "pre-deploy-20260608-165200",
      "timestamp": "ISO",
      "trigger": "deploy",
      "previousCommit": "7da12b0c",
      "contents": { "database": true, "configFiles": ["backend/.env"] },
      "location": "local | remote"
    }
  ],
  "maxBackups": 5
}
```

### 回滚（用户触发）

用户说"回滚"时 → 主会话列出备份 → 用户选择 → deployer mode=rollback 执行：
- 恢复数据库：`ssh_backup_restore(server, backupId, database=<db>)`
- 恢复配置：从备份目录复制 `.env` 回 `<deployPath>/backend/`
- 重启服务

## 禁止

- 启动服务、健康检查、更新 baseURL（validator 负责）
- 修改 `repository/` 源码
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
- 猜测构建命令、尝试替代方案
- **尝试修复失败的步骤**（失败就报告，不是我们的问题）
- **自动安装缺失的远程组件**（缺什么报什么，让用户装）
