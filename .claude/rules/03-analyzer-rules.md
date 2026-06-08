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

## track/ 文档提取（强制）

`track/` 目录通过软链接映射了仓库中的关键目录（如 `version/`、`docs/`）。analyzer **必须**读取这些目录中的部署文档和脚本，提取部署知识写入 `deploymentDocs` 段，供 deployer 直接使用而非猜测。

### 读取步骤

1. 检查 `test_project/<NN-Project>/track/` 是否存在
2. 遍历软链接指向的目录，识别并读取以下类型的文件：
   - **部署文档**：`update_readme.md`、`deploy.md`、`DEPLOY.md`、`INSTALL.md`
   - **启动脚本**：`*.sh`（特别是 `start*.sh`、`deploy*.sh`）
   - **配置说明**：`.env.example`、`README.md` 中与部署相关的章节
   - **版本变更**：`version/*/` 下的变更日志、迁移说明
3. 从文档中提取关键信息写入 `deploymentDocs` 段

### 提取内容

| 信息 | 来源 | 用途 |
|------|------|------|
| 构建命令 | 文档中的「构建」/「编译」章节 | deployer 执行编译 |
| 启动命令 | 文档中的「启动」/「运行」章节 | environment.json.startCommand |
| 数据库初始化 | 文档中的「数据库」/「初始化」章节 | SQL 执行顺序 |
| 环境变量 | `.env.example` + 文档说明 | 配置 .env |
| 依赖安装 | 文档中的「依赖」/「安装」章节 | 包管理器、特殊依赖 |
| 目录结构 | 文档中的「目录说明」章节 | 组装 dev/ 的布局依据 |
| 已知问题 | 文档中的「已知问题」/「限制」章节 | 部署避坑 |

### 提取纪律（强制）

**核心原则：从文档原文提取，不从代码推断。**

1. **`buildCommand` 禁止从 `package.json` scripts 推断**。必须在部署文档中找到原文说明（可以是编译命令，也可以是「使用预构建包」的说明）。文档无此说明 → `buildCommand` 写 `"未在文档中找到"`
2. **预构建包识别**：部署文档中明确说「使用预构建包」「解压即可运行」或描述 tar.gz 含编译产物 + node_modules → `deliveryModel: "pre-built"`，`buildCommand: "NONE"`
3. **源码编译识别**：部署文档中给出编译命令（如 `pnpm install && pnpm build`、`mvn package`）→ `deliveryModel: "source-build"`，`buildCommand` 为文档中的原文命令
4. **两种模式都合法**：项目可以提供预构建包，也可以只提供源码和构建说明。关键是**文档必须说明怎么构建或怎么部署**
4. **每个字段附原文出处**：`readFiles` 记录提取了哪些文件，`sourceLocations` 记录每个关键字段来自哪个文件的哪个章节标题
5. **文档中没有的信息 → 写 `"未在文档中找到"`**，禁止自行推断、猜测、从代码反向工程

### 前后端分离构建识别（强制）

**前后端分离项目（前端和后端在不同目录、用不同工具构建）必须分别提取构建信息。**

判断标准：仓库中存在独立的前端目录（且有独立的构建配置如 `package.json` + `vue.config.js`/`vite.config.*`/`webpack.config.*`）→ 前后端分离项目。

提取要求：

| 字段 | 说明 | 缺失时 |
|------|------|--------|
| `frontendBuild.command` | 前端构建命令（如 `npm run build:prod`） | 从前端目录的 `package.json` scripts 中 `build` 字段获取 |
| `frontendBuild.workDir` | 前端构建的工作目录（相对于仓库根目录） | 必须填写 |
| `frontendBuild.outputDir` | 构建产物输出目录（相对于 workDir） | 从构建工具配置推断（`vue.config.js` 的 `outputDir`、`vite.config.*` 的 `build.outDir`，默认 `dist`） |

**单构建项目**（如 NestJS 全栈、Django + 模板）不需要 `frontendBuild`，保持原有 `buildCommand` 即可。

**前后端分离项目的 `buildCommand` 仍指后端构建命令**（如 `mvn clean package`），前端构建由 `frontendBuild` 单独描述。deployer 会分别执行两个构建。

**前端服务策略**：前后端分离项目中，前端**一律通过 Nginx 托管静态文件**。除非项目文档明确要求前端以 dev 模式运行，否则不在远程安装 Node.js、不运行前端 dev server。`frontendBuild.command` 必须是生产构建命令（如 `npm run build:prod`），不是 dev 命令。

### 如果 track/ 不存在

跳过本步骤，不阻塞 analyzer 完成。deployer 将退回通用推断模式。

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
    "deploymentDocs": {
      "deliveryModel": "pre-built | source-build",
      "source": "track/ | repository/",
      "readFiles": ["version/v0.0.2/update_readme.md", "sh/start.sh"],
      "sourceLocations": {
        "buildCommand": "update_readme.md §2 编译包结构说明（pre-built 模式无需编译）",
        "startCommand": "update_readme.md §6 环境变量与配置变更",
        "envVars": ".env.example",
        "dbInit": "update_readme.md §5 数据库变更"
      },
      "buildCommand": "NONE | pnpm install && pnpm build",
      "frontendBuild": {
        "command": "npm run build:prod",
        "workDir": "<前端目录相对路径>",
        "outputDir": "dist/"
      },
      "startCommand": "pm2 start ecosystem.config.cjs",
      "dbInit": "mysql -u root -p --default-character-set=utf8mb4 <db> < database/keyidea_newoa.sql",
      "envVars": ["DATABASE_URL", "PORT"],
      "directoryLayout": "software/ 含 apps/api + apps/web，database/ 含 SQL",
      "knownIssues": ["Prisma 需指定 binaryTargets", "前端需 Nginx 代理"],
      "warnings": []
    },
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
