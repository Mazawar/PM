# builder 阶段规则（生产构建 + 部署包组装）

> 配套 agent: `project-manage-builder`
> 远程部署部分见 `08b-remote-builder-rules.md`

## 核心职责

按 `buildMode` 分支执行：
- **mode=local**：本地编译 → 归档 → 组装 `build/dev/` → 写 `start.sh`
- **mode=remote**：在 local 步骤基础上 + 打包 `<NN-Project>.tar.gz` + 写 `deploy-config.json` / `nginx.conf`

**禁止**启动服务、做健康检查、写 SETUP.md、更新 baseURL（validator 阶段负责）。

## 触发条件

- `environment.json.analyzer.completedAt` 必须存在
- `environment.json.build.mode` 必须为 `'local'` 或 `'remote'`
- mode=remote 时 `remoteConfig.server` 必须已绑定

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
- `scripts/`（部署脚本，组装 dev/ 时从仓库单独复制）
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
├── update_readme.md
└── deploy.md             # 自动生成
```

步骤：
1. 从归档解压到 `build/dev/software/`
2. `pnpm install --config.node-linker=hoisted`（hoisted 模式）
3. Prisma 项目：schema 加 `binaryTargets = ["native", "debian-openssl-3.0.x"]` → `npx prisma generate` → 验证双引擎
4. 组装 `database/`（仅 SQL 文件，扁平版本目录，无 `version/` 嵌套）：
   - 全量 SQL：`repository/<NN-Project>/keyidea_newoa.sql` → `build/dev/database/`
   - 版本 SQL 按 analyzer 的 `dbConfig.initFiles` 和发现的其他 SQL 文件提取到扁平目录：
     - `version/v0.0.1/sql/migrate_*.sql` → `database/v0.0.1/migrate_*.sql`
     - `version/v0.0.1/sql/rollback_*.sql` → `database/v0.0.1/rollback_*.sql`
     - `version/v0.0.2/sql/migrate_*.sql` → `database/v0.0.2/migrate_*.sql`
     - `version/v0.0.2/sql/rollback_*.sql` → `database/v0.0.2/rollback_*.sql`
     - `version/v0.0.2/sql/seed_*.sql` → `database/v0.0.2/seed_*.sql`
   - **禁止**复制 `version/v{*}/` 下的非 SQL 文件（sh/md/其他）
   - **禁止**嵌套 `version/` 中间目录
5. 生成 `build/dev/update_readme.md`：
   - 从 `repository/<NN-Project>/version/` 下各版本的 `update_readme.md` 提取关键信息
   - 合并为一份扁平文档（当前版本号、构建环境、目录结构、数据库变更、健康检查端点）
   - 写入 `build/dev/update_readme.md`
6. 生成 `build/dev/deploy.md`（见下方模板）

### 6. 生成 deploy.md 模板

deploy.md 包含以下章节，各章节内容由 builder agent 按当前项目实际信息动态填充：

- **环境配置**：技术栈、端口、数据库名称（从 `analyzer` 段读取），**不写默认账号**
- **目录结构**：反映实际 `build/dev/` 结构（software/、database/、logs/）
- **部署步骤**：见下方固定模板

```markdown
# <NN-Project> 部署说明

## 部署步骤

### 1. 上传并解压
```bash
# 上传部署包到服务器
scp <NN-Project>.tar.gz root@<server-ip>:<deployPath>/

# 解压
cd <deployPath>
tar -xzf <NN-Project>.tar.gz
```

### 2. 配置环境变量
```bash
cd <deployPath>/software
# 从模板复制 .env
cp apps/api/.env.development apps/api/.env
# 编辑 .env，修改 DATABASE_URL 为远程连接串
vi apps/api/.env
```

### 3. 初始化数据库
```bash
# 建库（如不存在）
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS <db-name> CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 导入全量 SQL
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/keyidea_newoa.sql

# 按版本执行迁移
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/v0.0.1/migrate_v0.1.0.sql
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/v0.0.2/migrate_v0.0.2.sql
mysql -u root -p --default-character-set=utf8mb4 <db-name> < <deployPath>/database/v0.0.2/seed_v0.0.2.sql
```

### 4. 启动后端
```bash
cd <deployPath>/software
nohup node -r dotenv/config apps/api/dist/src/main.js dotenv_config_path=apps/api/.env > <deployPath>/logs/backend.log 2>&1 &
# 确认端口监听
sleep 3 && ss -tlnp | grep <backend-port>
```

### 5. 配置 Nginx（前端）
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

### 6. 健康检查
```bash
# 前端
curl -s -o /dev/null -w "%{http_code}" http://localhost:<frontend-port>
# 预期: 200

# 后端 API
curl -s -X POST http://localhost:<backend-port>/api/auth/login -H "Content-Type: application/json" -d '{"username":"<username>","password":"<password>"}'
# 预期: 返回 token 或 401（至少说明服务响应正常）
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

# 启动后备服务
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

### 7. 生成 version-log.json

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
      "topLevelDirs": ["software", "database", "update_readme.md"],
      "nodeModulesExcluded": true, "keyFilesPresent": ["..."], "totalEntries": 0, "size": "0M"
    }
  }]
}
```

### 8. build/ 自检清单

Build 阶段共用清单（强制执行，违规项立即删除）：

**必含**：
- [ ] `build/dev/` 存在
- [ ] `build/artifacts/<ts>-<commit>.tar.gz` + manifest.json
- [ ] `build/tmp/` 存在（可空）
- [ ] `build/version-log.json` 含 `archiveVerification`

**必无（按 buildMode）**：

| 必无项 | local | remote |
|--------|-------|--------|
| `build/<NN-Project>/` | ✓ | ✗（打包用，部署成功后清理） |
| `build/<NN-Project>.tar.gz` | ✓ | ✗（部署成功后清理） |
| `build/pre-deploy-backup-*.sql.gz` | ✓ | ✗（部署成功后清理） |
| `build/deploy-config.json` | ✓ | ✗（保留以便下次复用） |
| `build/nginx.conf` | ✓ | ✗（保留本地副本） |
| `build/dev/software/**/*.log` 散落 | ✓ | ✓ |

**本地构建完成后立即删除**：
```bash
rm -rf build/<NN-Project> build/<NN-Project>.tar.gz build/*.sql.gz
```

## 写入字段

```json
{
  "build": {
    "mode": "local",
    "version": "v1.0.0",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "checksum": "sha256:...",
    "builtAt": "ISO",
    "remote": { /* 仅 mode=remote，见 08b */ }
  }
}
```

## 完成后

- `build.builtAt` 写入
- 输出构建摘要（archive 大小、entry 数、keyFilesPresent 列表）
- **不启动服务**（validator 阶段）
