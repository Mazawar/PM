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
- 初始化目录（`init-dirs.mjs` 自动创建 case/、plans/、tests/、test-config/、results/、reports/、build/artifacts/）

## 触发条件

- `environment.json.analyzer.completedAt` 缺失时启动
- `environment.json.build.mode` 未设 → 本次只做本地分析
- `environment.json.build.mode == "remote"` 且 `remoteConfig.server` 非空 → 同时做远程探测

## 端口推断（按以下优先级）

1. `vite.config.ts` 中 `server.port`
2. `.env` / `.env.development` 中 `PORT` / `VITE_PORT` / `SERVER_PORT`
3. `package.json` scripts 中 `--port` 参数
4. `vue.config.js` / `next.config.js` / `nuxt.config.ts`
5. Java 项目 `application.yml` 的 `server.port`
6. 推断不出 → 询问用户

## 技术栈识别

- 前端：检查 `package.json` dependencies（vue/react/angular），`vite.config.*` / `webpack.config.*` / `next.config.*`
- 后端：Java → `pom.xml`；Node.js → `package.json`（NestJS/Express/Fastify）；Python → `requirements.txt` / `pyproject.toml`；Go → `go.mod`
- 中间件：DB（MySQL/PostgreSQL/MongoDB）、缓存（Redis/Memcached）、MQ、ES

## 中间件推断

- 从 `docker-compose.yml`、`package.json` dependencies、配置文件中识别所需中间件
- 自动推断，不询问用户

## 数据库初始化优先级

1. **完整 SQL dump 优先**（`.sql` 文件，通常几十 MB 到几百 MB）
2. ORM schema 同步 + seed 脚本 — 仅在没有 SQL dump 时使用
3. **禁止** ORM 建空表 + 手动插几条数据就认为完成

SQL dump 导入指定 `--default-character-set=utf8mb4` 防止中文乱码。

### 版本化 SQL 初始化流程

仓库中存在 `version/` 目录且包含版本子目录时，按**版本号升序**逐一执行：

```
初始化顺序：
1. <全量 SQL dump>.sql              — 初始结构 + 全量数据
2. version/v0.0.1/sql/migrate_*.sql  — v0.0.1 变更
3. version/v0.0.2/sql/migrate_*.sql  — v0.0.2 变更
4. version/v0.0.2/sql/seed_*.sql     — v0.0.2 种子数据（放在该版本 migrate 之后）
...
```

- 全量 SQL dump 必须最先执行
- 版本迁移按目录名排序（`v0.0.1` → `v0.0.2` → ...），不能跳过中间版本
- 每个版本内先执行 `migrate_*.sql`，再执行 `seed_*.sql`（如有）
- analyzer 在 `dbConfig.initFiles` 中如实列出**全部** SQL 文件（全量 dump + 各版本 migrate + seed），按执行顺序排列
- 组装 `build/dev/database/` 时，保持扁平版本目录结构：`database/v0.1.0/migrate_*.sql`

```json
// 以 v0.0.2 项目为例的 dbConfig
"dbConfig": {
  "url": "mysql://...",
  "initMethod": "versioned-sql",
  "initFiles": [
    "keyidea_newoa.sql",
    "version/v0.0.1/sql/migrate_v0.1.0.sql",
    "version/v0.0.2/sql/migrate_v0.0.2.sql"
  ],
  "seedFiles": [
    "version/v0.0.2/sql/seed_v0.0.2.sql"
  ]
}
```

## 凭据推断

- 检查 `README.md` / `docs/` / `.env.example` 默认账号
- 检查 seed 数据 / 测试账号配置
- 推断不出 → 询问用户；用户也不知道则跳过

**凭据保密**：
- 写入 environment.json 的 password **不加密**（与现有约定一致）
- 测试数据用 `test_` 前缀，禁止把生产凭据写入测试环境

## 远程探测（仅 `remoteConfig.server` 非空时执行）

**仅在 `environment.json.remoteConfig.server` 非空时执行远程探测。**

- 首次跑 analyzer：主会话在启动前不会预填 remoteConfig，因此首次只做本地分析
- 重绑定切服务器：先清空 `analyzer.remoteProbe` → 重跑 analyzer → 重新探测

### 工具
**仅使用 SSH MCP 工具**（`ssh_execute`、`ssh_health_check`、`ssh_monitor`）。禁止用 `Bash` + `ssh`。

### 探测项

| 项 | 命令 | 写入字段 |
|---|------|--------|
| OS | `cat /etc/os-release` | `remoteProbe.os` |
| Node.js | `node --version`（如适用） | `remoteProbe.runtime.node` |
| Java | `java --version`（如适用） | `remoteProbe.runtime.java` |
| Python | `python3 --version`（如适用） | `remoteProbe.runtime.python` |
| MySQL | `mysql --version` + `systemctl is-active mysql` | `remoteProbe.runtime.mysql` |
| PostgreSQL | `psql --version` | `remoteProbe.runtime.postgres` |
| Nginx | `nginx -v` + `systemctl is-active nginx` | `remoteProbe.runtime.nginx` |
| 端口 | `ss -tlnp` 对比 `analyzer.ports` | `remoteProbe.ports.free` / `ports.occupied` |
| 磁盘 | `df -h $HOME` | `remoteProbe.disk` |

### 失败处理

**探测失败不阻断 analyzer 完成。**

- 写 `remoteProbe.error = "<错误描述>"`
- 写 `remoteProbe.warnings = ["<warning-1>", ...]`
- 继续写 `analyzer.completedAt`

### 完成后约束

- **不安装任何运行时**（安装是 builder 阶段）
- **不上传任何文件**（上传是 builder 阶段）

## 写入字段（environment.json.analyzer）

```json
{
  "analyzer": {
    "completedAt": "ISO",
    "techStack": { "frontend": "Vue3+Vite", "backend": "NestJS", "language": "TypeScript" },
    "ports": { "frontend": 5173, "backend": 3000 },
    "middleware": ["MySQL"],
    "credentials": { "username": "admin", "password": "..." },
    "dbConfig": {
      "url": "protocol://user:pass@host:port/db",
      "initMethod": "sql-dump | prisma-migrate | mybatis-sql | jpa-hibernate | flyway | django-migrate | sql-scripts | versioned-sql",
      "initFiles": ["database/init.sql"],
      "seedFiles": ["database/seed.sql"]
    },
    "login": { "url": "/login", "usernamePlaceholder": "...", "passwordPlaceholder": "...", "submitButton": "..." },
    "startCommand": { "frontend": "...", "backend": "...", "full": "..." },
    "healthCheck": { "url": "http://localhost:5173", "method": "GET", "expectedStatus": 200 },
    "remoteProbe": {
      "completedAt": "ISO",
      "os": "Ubuntu 22.04",
      "runtime": { "node": "v20.10.0", "mysql": "8.0.35", "nginx": "1.24.0" },
      "ports": { "free": [3000, 5173], "occupied": [] },
      "disk": "20G available",
      "warnings": []
    }
  }
}
```

## 保护文件（不删不改）

- `test_project/<NN-Project>/.last_hash`
- `test_project/<NN-Project>/.pipeline-state.json`
- `test_project/<NN-Project>/case/`

## 完成后必做

- 写 `analyzer.completedAt` = ISO 时间戳
- 输出 analyzer 段摘要
- **不执行构建、不启动服务、不问用户构建模式、不问服务器绑定**
