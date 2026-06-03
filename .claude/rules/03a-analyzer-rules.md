# analyzer 阶段规则（本地源码分析）

> 配套 agent: `project-manage-analyzer`
> 远程探测见 `08a-remote-analyzer-rules.md`

## 核心职责

**只读分析 + 写入 environment.json.analyzer 段**。禁止执行构建、禁止启动服务、禁止写 build/、禁止写 SETUP.md、禁止询问用户构建模式、禁止询问服务器绑定。

## 输入与输出

### 输入
- `repository/<NN-Project>/` 源码（只读）

### 输出
- `test_project/<NN-Project>/test-config/environment.json.analyzer.*` 段
- `test_project/<NN-Project>/playwright.config.ts`
- `test_project/<NN-Project>/vitest.config.ts`（如 L2 API 测试需要）
- 初始化目录（`init-dirs.mjs` 自动创建 case/、plans/、tests/、test-config/、results/、reports/、build/artifacts/）

## 推断顺序

### 1. 端口推断（按以下优先级）
1. `vite.config.ts` 中 `server.port`
2. `.env` / `.env.development` 中 `PORT` / `VITE_PORT` / `SERVER_PORT`
3. `package.json` scripts 中 `--port` 参数
4. `vue.config.js` / `next.config.js` / `nuxt.config.ts`
5. Java 项目 `application.yml` 的 `server.port`
6. 推断不出 → 询问用户

### 2. 技术栈识别
- 前端：检查 `package.json` dependencies（vue/react/angular），`vite.config.*` / `webpack.config.*` / `next.config.*`
- 后端：Java → `pom.xml`；Node.js → `package.json`（NestJS/Express/Fastify）；Python → `requirements.txt` / `pyproject.toml`；Go → `go.mod`
- 中间件：DB（MySQL/PostgreSQL/MongoDB）、缓存（Redis/Memcached）、MQ、ES

### 3. 数据库初始化优先级
1. **完整 SQL dump 优先**（`.sql` 文件）
2. ORM schema 同步 + seed 脚本（无 SQL dump 时）
3. **禁止** ORM 建空表 + 手动插几条数据就认为完成

SQL dump 导入指定 `--default-character-set=utf8mb4`。

### 4. 凭据推断
- 检查 `README.md` / `docs/` / `.env.example` 默认账号
- 检查 seed 数据 / 测试账号配置
- 推断不出 → 询问用户；用户也不知道则跳过

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
      "initMethod": "sql-dump | prisma-migrate | mybatis-sql | jpa-hibernate | flyway | django-migrate | sql-scripts",
      "initFiles": ["database/init.sql"],
      "seedFiles": ["database/seed.sql"]
    },
    "login": { "url": "/login", "usernamePlaceholder": "...", "passwordPlaceholder": "...", "submitButton": "..." },
    "startCommand": { "frontend": "...", "backend": "...", "full": "..." },
    "healthCheck": { "url": "http://localhost:5173", "method": "GET", "expectedStatus": 200 }
  }
}
```

**注意：远程探测字段 `analyzer.remoteProbe` 见 08a-remote-analyzer-rules.md，由 analyzer 在 `remoteConfig.server` 非空时写入。**

## 凭据保密

- 写入 environment.json 的 password **不加密**（与现有约定一致）
- 测试数据用 `test_` 前缀，禁止把生产凭据写入测试环境

## 保护文件（不删不改）

- `test_project/<NN-Project>/.last_hash`
- `test_project/<NN-Project>/.pipeline-state.json`
- `test_project/<NN-Project>/case/`

## 完成后必做

- 写 `analyzer.completedAt` = ISO 时间戳
- 输出 analyzer 段摘要
- **不执行构建、不启动服务、不问用户构建模式、不问服务器绑定**
