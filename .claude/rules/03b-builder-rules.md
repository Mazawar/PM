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
├── database/             # 数据库脚本
│   ├── <全量 SQL>.sql
│   └── <version>/sql/
├── sh/                   # 部署运维脚本
├── deploy-manual.md
├── update_readme.md
└── deploy.md             # 自动生成
```

步骤：
1. 从归档解压到 `build/dev/software/`
2. `pnpm install --config.node-linker=hoisted`（hoisted 模式）
3. Prisma 项目：schema 加 `binaryTargets = ["native", "debian-openssl-3.0.x"]` → `npx prisma generate` → 验证双引擎
4. 复制 `database/`、`sh/`、`deploy-manual.md`、`update_readme.md`
5. 生成 `build/dev/deploy.md`（含环境配置、目录结构、部署步骤、凭据）

### 6. 生成 start.sh

```bash
#!/bin/bash
# <NN-Project> 一键启动脚本（从 dev/ 启动）
PROJECT_NAME="<NN-Project>"
DEV_DIR="test_project/$PROJECT_NAME/build/dev/software"
PORT=<端口>

if [ ! -d "$DEV_DIR" ]; then
  echo "[FAIL] dev/ 部署包不存在: $DEV_DIR"
  exit 1
fi

# 启动服务
mkdir -p build/dev/logs
nohup <启动命令> > build/dev/logs/<service>.log 2>&1 &

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
      "topLevelDirs": ["software", "database", "sh", "deploy-manual.md", "update_readme.md"],
      "nodeModulesExcluded": true, "keyFilesPresent": ["..."], "totalEntries": 0, "size": "0M"
    }
  }]
}
```

### 8. build/ 自检清单

Setup 阶段共用清单（强制执行，违规项立即删除）：

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
