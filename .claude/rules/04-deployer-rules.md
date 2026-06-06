# deployer 阶段规则（验证部署能力）

> 配套 agent: `project-manage-deployer`
> 规则编号：04（上接 03-analyzer，下接 05-validator）

## 核心职责

验证项目能否成功部署并具备测试条件。按 `buildMode` 分支执行：
- **mode=local**：编译验证 → 归档 → 组装 `build/dev/` → 写 `start.sh` → 出部署验证报告
- **mode=remote**：在 local 步骤基础上 + 打包 `<NN-Project>.tar.gz` + 安装远程运行时 + 上传 + 配置 .env + 初始化 DB

**禁止**启动服务、做健康检查、更新 baseURL（validator 阶段负责）。

## 触发条件

- `environment.json.analyzer.completedAt` 必须存在
- `environment.json.build.mode` 必须为 `'local'` 或 `'remote'`
- mode=remote 时 `remoteConfig.server` 必须已绑定

## 构建依赖分析

- 分析项目的完整部署链：从源码到可运行状态需要哪些步骤
- 识别所有需要在启动前完成的预编译/构建步骤（不只是主应用，也包括子模块、共享包、类型定义等）
- 确定构建顺序（按依赖拓扑排列）
- **在启动任何服务前，必须先完成所有必要的构建步骤**（构建是部署验证的一部分）
- 构建产出的目标目录为 `build/dev/software/`，后续 validator 从该目录启动服务

## 验证顺序（强制）

三段 agent 的步骤顺序（analyzer → deployer → validator）：
1. analyzer 分析源码 → 推断配置 → 写 `environment.json.analyzer.*` 段
2. **deployer 验证部署能力**（在 `repository/` 中编译，组装到 `build/dev/`，按 buildMode 走 local/remote 分支，出部署验证报告）
3. validator 启动服务 → 健康检查 → 出环境验证报告

**禁止先启动再部署验证。必须先产出 dev/，再由 validator 启动。**

## SSH 操作（远程，强制）

- 所有远程命令**必须**通过 SSH MCP 工具执行（`ssh_execute`、`ssh_execute_sudo`），禁止 `Bash` + `ssh`
- 多步骤操作使用 `ssh_session_start` 创建持久会话
- 系统级安装（apt/yum）使用 `ssh_execute_sudo`
- 每项操作后验证结果，不假设成功

## 服务器绑定（强制）

启动时**必须**先检查 `environment.json` 的 `remoteConfig`：

- **已绑定**（`server` + `deployPath` 非空）→ 直接使用，不询问
- **未绑定** → 停下来询问用户：选择服务器 + 部署路径
  - 无可用服务器 → 终止，提示用户配置 `.env` 中的 `SSH_SERVER_*`
  - 部署路径默认 `$HOME/projects/<NN-Project>/`，用户可覆盖
- 用户回答后**立即写入** `remoteConfig` 到 environment.json：
  ```json
  { "remoteConfig": { "server": "", "serverIP": "", "deployPath": "", "frontendBind": "0.0.0.0", "tunnel": { "enabled": false, "localPort": null, "remotePort": null } } }
  ```
- 一台服务器可能部署多个项目，每个项目的 `deployPath` 必须独立

写入后验证 environment.json 已正确更新，`ssh_health_check` 确认服务器可达。

## 服务器重绑定（强制）

当用户请求切换到不同服务器时，**必须**支持重绑定：

- **触发条件**：用户明确要求换服务器，或主会话 prompt 中指定了与当前 `remoteConfig.server` 不同的目标服务器
- **重绑定流程**：
  1. 清空 `remoteConfig`（仅保留 `frontendBind` 默认值和 `tunnel` 默认值）
  2. 按正常「服务器绑定」流程重新询问用户：选择服务器 + 部署路径
  3. 重新执行完整部署流程（探测 → 安装运行时 → 上传 dev/ → 部署 → 验证 → 输出）
- **构建产物处理**：`build/` 下的文件按新服务器覆盖写入（deploy-config.json、nginx.conf、version-log.json 追加记录）
- **baseURL 更新**：部署完成后同步更新 environment.json 和 playwright.config.ts
- **禁止**删除旧服务器的远程文件（用户可能仍需要），仅更新本地配置指向新服务器

## 共用步骤（local + remote）

### 1. 生产编译

按 `analyzer.techStack` 确定构建命令，在 `repository/<NN-Project>/` 执行：

| 技术栈 | 构建命令 |
|--------|---------|
| Node.js（pnpm） | `pnpm build` 或 `pnpm --filter <pkg> build` |
| Node.js（npm） | `npm run build` |
| Java/Maven | `mvn clean package -DskipTests` |
| Python | 按项目规范（`poetry build` 等） |
| Go | `go build -o dist/...` |

**构建失败则终止**，不在远程修复。monorepo 项目按 workspace 拓扑编译。

### 2. 归档到 build/artifacts/

格式：`build/artifacts/<YYYYMMDD-HHmmss>-<commitShortHash>.tar.gz`

**必须包含**：
- 前端编译产物（`web/dist/` 等）
- 后端编译产物（`api/dist/` 等）
- 依赖声明文件（`package.json`、`pnpm-lock.yaml`）
- ORM schema/迁移文件（`prisma/`、`migrations/`）
- .env 模板（`.env.development` 等）
- workspace 配置（`pnpm-workspace.yaml`）

**禁止包含**：
- `node_modules/`
- `version/`（版本变更记录）
- `scripts/`/`sh/`（部署脚本，组装 dev/ 时从仓库单独复制）
- 静态数据文件（如 `province.json`）
- 进程管理配置（`ecosystem.config.cjs`）
- README、文档、`.git/`

### 3. 生成 manifest.json

```json
{
  "schema": "1.0",
  "commit": "<short-hash>",
  "branch": "<branch>",
  "createdAt": "ISO",
  "files": { "<路径>": "<sha256>", ... },
  "checksum": "sha256:..."
}
```

### 4. 归档完整性校验（强制）

1. **manifest.files 一致性**：遍历 `files` 对象，每个声明路径前缀在归档内存在且文件数 ≥ 1
2. **目录结构校验**：顶层目录与项目结构一致
3. **nodeModulesExcluded**：归档内无 `node_modules/` 条目
4. **keyFilesPresent**：关键文件（dist 产物、schema、SQL dump）存在
5. **checksum 写入**：校验通过后计算 sha256 写入 manifest

校验结果记录到 `version-log.json` 的 `archiveVerification` 字段。`passed: false` → 禁止继续。

### 5. 组装 build/dev/

```
dev/
├── software/             # workspace 根目录（含 node_modules）
│   ├── apps/api/
│   ├── apps/web/
│   ├── packages/
│   ├── package.json
│   └── pnpm-workspace.yaml
├── database/             # 数据库脚本（仅 SQL 文件，扁平版本目录）
│   ├── <全量 SQL>.sql     # 全量 SQL dump
│   ├── v0.0.1/           # 版本号目录（源自 version/ 目录，只复制 SQL）
│   │   ├── migrate_*.sql
│   │   └── rollback_*.sql
│   └── v0.0.2/
│       ├── migrate_*.sql
│       ├── rollback_*.sql
│       └── seed_*.sql
└── deploy.md             # 构建环境声明 + 部署说明（自动生成，合并更新说明内容）
```

步骤：
1. 从归档解压到 `build/dev/software/`
2. `pnpm install --config.node-linker=hoisted`（hoisted 模式）
3. Prisma 项目：schema 加 `binaryTargets = ["native", "debian-openssl-3.0.x"]` → `npx prisma generate` → 验证双引擎
4. 组装 `database/`（仅 SQL 文件，扁平版本目录，无 `version/` 嵌套）：
   - 全量 SQL：`repository/<NN-Project>/keyidea_newoa.sql` → `build/dev/database/`
   - 版本 SQL 按 analyzer 的 `dbConfig.initFiles` 和发现的其他 SQL 文件提取到扁平目录
   - **禁止**复制 `version/v{*}/` 下的非 SQL 文件（sh/md/其他）
   - **禁止**嵌套 `version/` 中间目录
5. 生成 `build/dev/deploy.md`（见下方模板）：
   - 从 `repository/<NN-Project>/version/` 下各版本的 `update_readme.md` 提取对应章节原文（§1、§4~§10）
   - 合并为一份 10 节完整部署文档，不再保留独立的 update_readme.md
   - 章节映射：update_readme.md 的 §2 替换为 deploy.md 的 §2（实际目录结构），跳过 update_readme.md 无内容的 §3

### 6. 生成 deploy.md 模板

deploy.md 包含 10 个章节。§2（目录结构）和 §3（部署步骤）由 deployer agent 按实际 build/dev/ 写入；其余章节直接从 `version/<ver>/update_readme.md` 对应编号章节逐字复制，不修改内容。

```markdown
# <NN-Project> 部署说明

> 构建版本: <version> | 构建时间: <timestamp>

---

## 1. 构建环境声明

<!-- 直接复制 version/<ver>/update_readme.md 的 §1 原文 -->

---

## 2. 目录结构

```
build/dev/
├── software/             # workspace 根目录（含 node_modules）
│   ├── apps/api/
│   ├── apps/web/
│   ├── packages/
│   ├── package.json
│   └── pnpm-workspace.yaml
├── database/             # 数据库脚本
│   ├── <全量 SQL>.sql     # 全量 SQL dump
│   ├── v0.0.1/
│   │   └── migrate_*.sql
│   └── v0.0.2/
│       ├── migrate_*.sql
│       └── seed_*.sql
└── deploy.md             # 本文件
```

**与上一版本的结构差异（如有）：**

同上版本记录。

---

## 3. 部署步骤

### 3.1 上传并解压
```bash
# 上传部署包到服务器
scp <NN-Project>.tar.gz root@<server-ip>:<deployPath>/

# 解压
cd <deployPath>
tar -xzf <NN-Project>.tar.gz
```

### 3.2 配置环境变量
```bash
cd <deployPath>/software
cp apps/api/.env.development apps/api/.env
vi apps/api/.env  # 修改 DATABASE_URL 为远程连接串
```

### 3.3 初始化数据库
```bash
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS <db-name> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/keyidea_newoa.sql
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/v0.0.1/migrate_v0.1.0.sql
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/v0.0.2/migrate_v0.0.2.sql
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/v0.0.2/seed_v0.0.2.sql
```

### 3.4 启动后端
```bash
cd <deployPath>/software
nohup node -r dotenv/config apps/api/dist/src/main.js dotenv_config_path=apps/api/.env > <deployPath>/logs/backend.log 2>&1 &
sleep 3 && ss -tlnp | grep <backend-port>
```

### 3.5 配置 Nginx（前端）
```nginx
server {
    listen 80;
    server_name _;
    root <deployPath>/software/apps/web/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:<backend-port>; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
    location /socket.io/ { proxy_pass http://127.0.0.1:<backend-port>; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
}
```

### 3.6 健康检查
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:<frontend-port>  # 预期 200
curl -s -X POST http://localhost:<backend-port>/api/auth/login -H "Content-Type: application/json" -d '{"username":"<username>","password":"<password>"}'
```

---

## 4. 工具包变更清单

<!-- 直接复制 version/<ver>/update_readme.md 的 §4 原文 -->

---

## 5. 数据库变更

<!-- 直接复制 version/<ver>/update_readme.md 的 §5 原文 -->

---

## 6. 环境变量与配置变更

<!-- 直接复制 version/<ver>/update_readme.md 的 §6 原文 -->

---

## 7. 健康检查端点

<!-- 直接复制 version/<ver>/update_readme.md 的 §7 原文 -->

---

## 8. 版本依赖关系

<!-- 直接复制 version/<ver>/update_readme.md 的 §8 原文 -->

---

## 9. 已知问题与限制（Errata）

<!-- 直接复制 version/<ver>/update_readme.md 的 §9 原文 -->

---

## 10. 本次版本更新内容

<!-- 直接复制 version/<ver>/update_readme.md 的 §10 原文 -->
```

### 7. 生成 start.sh

```bash
#!/bin/bash
# <NN-Project> 一键启动脚本（从 dev/ 启动）
PROJECT_NAME="<NN-Project>"
DEV_DIR="test_project/$PROJECT_NAME/build/dev/software"
PORT=<端口>
BACKEND_MAIN="apps/api/dist/src/main.js"

if [ ! -d "$DEV_DIR" ]; then
  echo "[FAIL] dev/ 部署包不存在: $DEV_DIR"
  exit 1
fi

cd "$DEV_DIR"

# 启动后端服务
mkdir -p build/dev/logs
nohup node -r dotenv/config $BACKEND_MAIN dotenv_config_path=apps/api/.env > build/dev/logs/backend.log 2>&1 &
echo "[INFO] 后端已启动，PID: $!"

# 健康检查
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then exit 0; fi
  sleep 2
done
exit 1
```

启动脚本**预创建** `build/dev/logs/`，禁止日志散落。

### 8. 生成 version-log.json

```json
{
  "schema": "1.0",
  "project": "<NN-Project>",
  "records": [{
    "id": 1,
    "time": "ISO",
    "commit": "<hash>",
    "source": "local-build" | "remote-deploy",
    "target": "local" | "<server>",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "checksum": "sha256:...",
    "build": "成功|失败",
    "status": "completed" | "deployed",
    "archiveVerification": {
      "passed": true, "checkedAt": "ISO", "checksumMatches": true,
      "topLevelDirs": ["software", "database", "sh", "deploy.md"],
      "nodeModulesExcluded": true, "keyFilesPresent": ["..."], "totalEntries": 0, "size": "0M"
    }
  }]
}
```

### 9. build/ 自检清单

**详见本文件第 18 节「build/ 自检清单」**（必含/必无/红线/自检未通过处理）。

## mode=remote 追加步骤

### 1. 打包 `<NN-Project>.tar.gz`（本地）

```bash
cd test_project/<NN-Project>/build
rm -rf <NN-Project>
cp -a dev <NN-Project>
tar -czf <NN-Project>.tar.gz <NN-Project>/
rm -rf <NN-Project>
```

### 2. 写 deploy-config.json

```json
{
  "project": "<NN-Project>",
  "server": "<server>",
  "serverIP": "<ip>",
  "deployPath": "<deployPath>",
  "os": "<os>",
  "installedComponents": {},
  "ports": { "frontend": 0, "backend": 0, "nginx": 0 },
  "deployTime": "ISO",
  "verifiedSteps": []
}
```

### 3. 写 nginx.conf（如有前端）

```nginx
server {
  listen 80;
  server_name _;
  root <deployPath>/software/apps/web/dist;
  index index.html;
  location / { try_files $uri $uri/ /index.html; }
  location /api/ { proxy_pass http://127.0.0.1:<backendPort>; }
}
```

### 4. dev/ 部署包确认（远程部署前置，强制）

部署前**必须**确认 `build/dev/` 存在且结构完整：

```bash
ls build/dev/software/package.json       || echo "MISSING: workspace root"
ls build/dev/software/apps/api/dist/     || echo "MISSING: backend build"
ls build/dev/software/apps/web/dist/     || echo "MISSING: frontend build (if frontend)"
ls build/dev/database/                   || echo "MISSING: database scripts (if exists)"
ls build/dev/deploy.md                   || echo "MISSING: deploy docs"
```

- 缺失关键路径（如 workspace root 无 package.json）→ **终止部署**，提示用户先运行 deployer agent 完成部署验证
- 缺失辅助文件（如 database/ 为空）→ 记录警告，继续部署

### 5. 环境探测（强制）

安装前**必须**先探测远程服务器现有环境。根据 environment.json 的 `techStack` 和 `middleware` 选择性检查：

| 类别 | 探测项 | 命令参考 |
|------|--------|---------|
| OS | 发行版、架构 | `cat /etc/os-release`、`uname -m` |
| 运行时 | node/npm/pnpm、java/mvn、python3、go | `xxx --version` |
| 数据库 | mysql/psql/mongosh 版本 + 服务状态 | `systemctl is-active xxx` |
| 中间件 | nginx、redis-cli 等 | `systemctl is-active xxx` |
| 端口 | environment.json 中配置的端口 | `ss -tlnp` |
| 资源 | 磁盘空间、内存 | `df -h $HOME`、`free -h` |

安装决策：

| 状态 | 处理 |
|------|------|
| 已安装且版本满足 | 跳过，验证运行状态 |
| 已存在但版本不满足 | 版本管理工具（nvm 等）安装所需版本 |
| 未安装 | 安装最新稳定版 |

### 6. 安装指导

按 `techStack` 和 `middleware` 选择性安装，每项安装后**必须验证**版本号 + 服务运行状态。

#### 通用约束

- Agent 根据 `techStack`（frontend/backend/language）和 `middleware` 数组判断需要安装的组件
- 安装方式由 Agent 根据 OS 发行版自动选择（apt/yum/brew 等）
- 安装前先探测现有环境（见「环境探测」），已安装且版本满足则跳过
- 每项安装后验证：`xxx --version` + `systemctl is-active xxx`（适用时）

#### 常见技术栈参考（非穷举）

| 技术栈关键词 | 可能需要的运行时 | 可能需要的包管理器 |
|-------------|----------------|------------------|
| Vue/React/Vite/TypeScript | Node.js (nvm) | pnpm/npm |
| Spring/Java/JDK | OpenJDK | Maven/Gradle |
| Python/Django/FastAPI | python3 | pip + venv |
| Go/Gin | go | - |
| Rust/Actix | rustup/cargo | - |

#### 数据库（如 dbConfig 存在）

从 `dbConfig.url` 协议自动判断数据库类型，安装并启动：

| 协议关键词 | 数据库 | 必要操作 |
|-----------|--------|---------|
| `mysql://` | MySQL | 安装 → 启动 → 建库 → 验证连接 |
| `postgresql://` / `postgres://` | PostgreSQL | 安装 → 启动 → 建库 → 验证连接 |
| `mongodb://` | MongoDB | 安装 → 启动 → 验证连接 |
| `sqlite:` | SQLite | 无需安装服务，验证文件路径可写 |

#### 前端项目（如 techStack.frontend 存在）

有前端的项目**必须**安装 Nginx：
- 安装、启动、设置开机自启
- 验证 `systemctl is-active nginx`

#### 中间件

按 `middleware` 数组按需安装（Redis、RabbitMQ 等），安装后启动并验证。

### 7. 操作前备份（强制）

**任何破坏性操作前必须先备份**，备份文件保留在远程服务器，部署成功后不自动删除。

#### 数据库备份

数据导入/迁移前**必须**执行备份：
- MySQL: `mysqldump | gzip > backup/pre-deploy-<timestamp>.sql.gz`
- PostgreSQL: `pg_dump | gzip > backup/pre-deploy-<timestamp>.sql.gz`
- MongoDB: `mongodump --gzip --archive=backup/pre-deploy-<timestamp>.archive`
- 首次部署（空库）可跳过
- 重绑定/更新部署**不可跳过**

#### 配置备份

Nginx 配置变更前**必须**备份当前配置：
```bash
cp /etc/nginx/sites-available/<NN-Project> <deployPath>/backup/nginx-<timestamp>.conf
```

#### 备份验证

备份完成后**必须**验证文件大小 > 0 字节，并记录备份路径到 `deploy-config.json`。

### 8. 配置 .env + 初始化数据库

1. 从 `.env.development` 复制为 `.env`
2. 修改 `DATABASE_URL` 指向 `localhost` 或远程 DB
3. 读取 `analyzer.dbConfig.initMethod`：
   - `sql-dump`：建库 → 导入全量 SQL（指定 `--default-character-set=utf8mb4`）
   - `prisma-migrate` / `mybatis-sql` 等：执行对应迁移
4. 验证：执行简单查询确认表结构存在
5. 导入 `seedFiles`（如有）

#### 数据库初始化（如 dbConfig 存在）

1. 根据 `dbConfig.url` 协议判断数据库类型（mysql/postgres/mongodb/sqlite）
2. 读取 `dbConfig.initMethod` 确定初始化方式，读取 `dbConfig.initFiles` 定位迁移/建表文件
3. 根据 `initMethod` 执行对应的初始化命令
4. 验证连接：执行简单查询确认表结构已创建
5. 读取 `dbConfig.seedFiles` 导入种子数据（如有），导入后按「数据完整性校验」验证

### 9. 数据完整性校验（强制）

数据导入后**必须**校验完整性，不能只执行导入命令就认为成功。

#### 记录数对比

导入完成后，从 SQL 初始化文件或 ORM schema 中取关键表，在目标库查询记录数，确认导入完整。

#### 用户登录验证

`credentials` 存在时，**必须**测试登录：
- 登录接口路径从 `login` 字段获取
- 返回成功令牌 → PASS
- 返回认证失败 → **部署未完成**，排查密码哈希格式、用户状态字段等

#### 缺失数据标记

校验完成后，将结果记录到 `version-log.json` 当前记录中。

### 10. 环境变量

- 配置方式由 `techStack` 决定（`.env`、`application.yml`、`settings.py` 等）
- 模板文件存在时从模板复制（如 `.env.example` → `.env`）
- 数据库地址改 `localhost`
- 端口与 environment.json 一致

### 11. Nginx 配置（前端项目必须）

有前端的项目，前端服务**必须**通过 Nginx 提供静态文件和 API 反向代理。

#### 配置生成

Agent 从 `build/dev/` 中的前端产物路径确定静态文件目录，生成 Nginx 配置，写入 `/etc/nginx/sites-available/<NN-Project>`：
- 静态文件路径：`<deployPath>/software/apps/web/dist`（或实际前端产物路径）
- SPA 回退：`try_files $uri $uri/ /index.html`
- API 反向代理：根据后端路由前缀和端口配置
- WebSocket 代理：如项目使用 WebSocket 则需额外配置

#### 通用约束

- `nginx -t` 验证配置语法通过
- `systemctl reload nginx` 生效
- 配置副本保存到本地 `build/nginx.conf`

### 12. 远程目录结构（强制）

远程服务器上的所有项目文件**必须**整齐组织在 `deployPath` 内，禁止散落到外部。目录布局由 dev/ 包解压后的结构决定（software/、database/ 等）。

#### 强制约束（不限项目类型）

- **禁止**在 `$HOME`、`/tmp`、`/opt` 等非 deployPath 路径下放置项目文件
- **禁止**日志文件（`*.log`）散落在项目根目录，统一放入 `logs/` 子目录
- **禁止**临时构建文件残留（`.tgz`、`.zip` 上传包），部署完成后清理
- 前端产物与后端产物**必须**物理隔离（分目录存放），禁止混在同一层级
- 数据库初始化文件（`.sql`、`migrations/`）部署完成后清理，不留在生产目录
- Nginx 配置仅存放在系统路径 `/etc/nginx/` 和本地 `build/nginx.conf`，不在 deployPath 内重复

#### 部署后检查

部署完成后，Agent **必须**验证目录结构：

```bash
ls -la <deployPath>/ | grep -E '\.log$|\.tgz$|\.zip$|\.sql$' && echo "WARN: 散落文件" || echo "OK"
```

### 13. 临时文件管理（强制）

部署过程中产生的临时文件**必须**统一存放在 `test_project/<NN-Project>/build/tmp/` 下。

#### 存放规则

- 数据库 dump 文件：`build/tmp/<filename>.sql.gz`
- 中间传输文件：`build/tmp/<filename>`

#### 生命周期

- 部署成功后：`build/tmp/` 下的临时文件**必须清理**，仅保留 `.gitkeep` 占位
- 部署失败时：保留临时文件供排查，在报告中记录路径

#### 禁止

- 禁止在 `pm/tmp/`、`pm/` 根目录、`/tmp/` 等项目外路径放置临时文件

### 14. build/tmp/ 预创建（强制）

deployer agent 启动时**必须**确认本地 `build/tmp/` 目录存在且为空（可含 `.gitkeep` 占位）。

```bash
[ -d "test_project/<NN-Project>/build/tmp/" ] && echo "[OK]" || mkdir -p "test_project/<NN-Project>/build/tmp/"
```

- 即使本轮是本地构建，`build/tmp/` 也必须存在（为空），避免未来切换到远程部署时出现"目录不存在"的中间状态
- 部署成功后清理 `build/tmp/` 内非占位文件，保留 `.gitkeep`
- 部署失败时保留 `build/tmp/` 内容供排查，错误报告中记录文件清单

### 15. 上传 dev/ 到远程

```bash
# 本地打包（dev/ 保留不动，用副本）
cd build
rm -rf <NN-Project>
cp -a dev <NN-Project>
tar -czf <NN-Project>.tar.gz <NN-Project>/
rm -rf <NN-Project>

# 上传
ssh_upload <NN-Project>.tar.gz <deployPath>/

# 远程解压（在 deployPath 父目录解压，避免嵌套）
ssh_execute "mkdir -p <deployPath> && cd $(dirname <deployPath>) && tar -xzf <deployPath>/<NN-Project>.tar.gz"
```

上传完成后验证解压后的目录结构：
```bash
ssh_execute "ls <deployPath>/software/package.json"
```

### 16. 后端启动

根据 `techStack.backend` 确定启动方式，Agent 自动选择：

| 技术栈关键词 | 启动方式参考 |
|-------------|------------|
| NestJS/Express/Node.js | `nohup node -r dotenv/config <入口文件> dotenv_config_path=.env > logs/backend.log 2>&1 &` |
| Spring/Java | `nohup java -jar <jar文件> > logs/backend.log 2>&1 &` |
| Django/Python | `nohup gunicorn/python manage.py runserver > logs/backend.log 2>&1 &` |
| Go | `nohup ./<二进制文件> > logs/backend.log 2>&1 &` |

入口文件路径从 `environment.json` 的 `entryFile` 获取（如 `apps/api/dist/src/main.js`）。
启动后确认 `ss -tlnp` 检查端口在监听。失败时查日志排查。

**注**：启动后端**仅在 remote 模式下作为部署验证由 deployer 触发**（如需在部署阶段验证），实际环境启动验证由 validator 负责。

### 17. SSH 隧道（可选）

端口无法从本地直接访问时：`ssh_tunnel_create` 本地端口转发。有隧道则 baseURL 使用 `localhost:<tunnel-port>`。

### 18. 写入 build 段

```json
{
  "build": {
    "mode": "local|remote",
    "version": "v1.0.0",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "checksum": "sha256:...",
    "builtAt": "ISO",
    "remote": {
      "installedComponents": { "node": "v20.20.2", "mysql": "8.0.46", "nginx": "1.24.0" },
      "uploadArchive": "<NN-Project>.tar.gz",
      "uploadedAt": "ISO",
      "backupPaths": ["backup/pre-deploy-<ts>.sql.gz"],
      "deployPath": "/home/user/projects/<NN-Project>"
    }
  }
}
```

## build/ 自检清单

deployer agent 在完成部署验证（`build.builtAt` 写入前）之前**必须**逐项检查 build/ 目录，违规项立即修复。这是任务完成的硬性条件，未通过自检不得向主会话报告"Deploy 完成"。

### 必含项

- [ ] `build/dev/` 存在，含 `software/ database/ deploy.md`
- [ ] `build/artifacts/<timestamp>-<commit>.tar.gz` 编译产物归档
- [ ] `build/artifacts/<timestamp>-<commit>.manifest.json` 含 files 列表
- [ ] `build/tmp/` 存在（可空）
- [ ] `build/version-log.json` 存在，含 `archiveVerification` 字段

### 必无项（按 buildMode）

| 必无项 | local | remote |
|--------|-------|--------|
| `build/<NN-Project>/`（项目副本） | ✓ | ✗（打包用，部署成功后清理） |
| `build/<NN-Project>.tar.gz`（部署包） | ✓ | ✗（部署成功后清理） |
| `build/pre-deploy-backup-*.sql.gz` | ✓ | ✗（部署成功后清理） |
| `build/deploy-config.json` | ✓ | ✗（保留以便下次复用） |
| `build/nginx.conf` | ✓ | ✗（保留本地副本） |
| `build/dev/software/**/*.log` 散落 | ✓ | ✓ |
| `build/` 下散落的临时文件（`*.tgz` / `*.zip` / `*.sql.gz` / `*.tmp` / `build/pre-deploy-*`）未在 `build/tmp/` 内 | ✓ | ✓ |

### 本地构建完成后立即删除

```bash
rm -rf build/<NN-Project> build/<NN-Project>.tar.gz build/*.sql.gz
```

### 自检未通过的处理（强制）

- 任何 FAIL 项 → deployer **自闭环修复** → 重跑自检 → 通过后才算完成
- 禁止"标记 FAIL 但继续往下走"或"汇报主会话由主会话决定"
- 禁止向主会话报告"Build 已完成"但自检存在 FAIL 项
- 重跑后仍 FAIL → 视为部署失败，整个部署任务标 failed，汇报主会话请求介入
- 目标：消除 validator 阶段被迫返工、来回校验修正的循环

## 日志输出规范（强化）

所有 `nohup ... &` 后台启动的进程，日志**必须**重定向到约定位置，**禁止**散落在项目根或 apps/ 子目录。

- **本地构建**：`nohup ... > build/dev/logs/<service>.log 2>&1 &`
- **远程部署**：`<deployPath>/logs/<service>.log`
- **禁止**：`build/`、`build/dev/`、`build/dev/software/` 下任何子目录直接放 `*.log`
- 启动脚本（`start.sh`）必须**预创建** `build/dev/logs/` 目录，再启动后台进程

## 错误处理（强制）

**可自动处理**：系统依赖缺失 → 安装；数据库未迁移 → 执行迁移；.env 不存在 → 从 .env.example 复制。

**必须向用户报告**：SSH 连接失败、端口冲突（占用不明）、磁盘不足（<1GB）、数据库安装失败、系统级配置修改（防火墙/SELinux）、baseURL 变更。

## 产出文件（远程模式）

### version-log.json

构建版本追踪总表，每次部署**追加一条记录**，不覆盖历史：

```json
{
  "schema": "1.0",
  "project": "<NN-Project>",
  "records": [
    {
      "id": 1,
      "time": "<部署完成时间 ISO>",
      "commit": "<commitShortHash>",
      "source": "local-build",
      "target": "<部署目标服务器>",
      "archive": "<NN-Project>.tar.gz",
      "checksum": "sha256:xxx",
      "build": "成功|失败",
      "status": "deployed"
    }
  ]
}
```

### deploy-config.json

记录部署环境快照，下次构建复用：

```json
{ "project": "", "server": "", "serverIP": "", "deployPath": "", "os": "",
  "installedComponents": {},
  "ports": { "frontend": 0, "backend": 0, "nginx": 0 },
  "deployTime": "", "verifiedSteps": [] }
```

### .deploy-version（远程服务器，强制）

部署完成后**必须**在远程 `deployPath` 下写入 `.deploy-version` 文件：

```
archive=<NN-Project>.tar.gz
commit=<commitShortHash>
checksum=sha256:xxx
deployTime=<ISO时间>
server=<服务器名称>
```

每次重新部署时覆盖写入。此文件与本地 deploy-config.json 形成闭环追溯。

### nginx.conf

Nginx 配置文件副本。

## 完成后

- `build.builtAt` 写入
- 输出部署验证摘要（archive 大小、entry 数、keyFilesPresent 列表）
- **不启动服务**（validator 阶段）

## 部署验证报告

完成部署后，在 `test_project/<NN-Project>/results/build/` 下写出部署验证报告：

### progress.txt

```
DEPLOY-001:PASS
DEPLOY-002:PASS
DEPLOY-003:SKIP
DEPLOY-004:PASS
```

| 编号 | 检查项 | 来源 |
|------|--------|------|
| DEPLOY-001 | 制品完整性 | `build/artifacts/*.tar.gz` 存在 + manifest.json SHA256 校验通过 |
| DEPLOY-002 | 依赖解析 | lock 文件存在 + 关键依赖安装成功 |
| DEPLOY-003 | 数据库初始化 | SQL 语法正确 + 表结构完整 + 字符集正确（无 dbConfig 则 SKIP） |
| DEPLOY-004 | 配置完整性 | .env 字段数 = .env.example + 关键密钥非空 + DB 连接串正确 |

### report.md

```markdown
# <NN-Project> 部署验证报告

## 概要
- 验证时间: <YYYY-MM-DD HH:mm>
- 部署模式: <local|remote>
- 验证结果: <通过数>/<总数> 通过

## 结果概览
| 编号 | 检查项 | 结果 | 备注 |
|------|--------|------|------|

## 详细结果
### DEPLOY-NNN: <检查项> - PASS/FAIL/SKIP
**步骤**: ...
**预期**: ...
**实际**: ...
```

## 禁止

- 启动服务（validator 阶段）
- 健康检查（validator 阶段）
- 更新 `environment.json.baseURL`（validator 阶段）
- 修改 `repository/` 源码
- 删除 `case/` 用户文件、`.last_hash`、`.pipeline-state.json`
- 删除旧服务器上的远程文件（用户可能仍需要）
- 在 `$HOME`、`/tmp`、`/opt` 散落项目文件
- 在项目根或 apps/ 子目录直接放 `*.log`（统一 logs/）
