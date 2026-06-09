# 04-0b 部署测试用例规则

> 所属：04-deployer 子规则

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
