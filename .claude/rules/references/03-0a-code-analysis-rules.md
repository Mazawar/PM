# 03-0a 代码分析规则（端口 / 技术栈 / 中间件 / 凭据）

> 所属：03-analyzer 子规则

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

## 凭据推断

- 检查 `README.md` / `docs/` / `.env.example` 默认账号
- 检查 seed 数据 / 测试账号配置
- 推断不出 → 询问用户；用户也不知道则跳过

**凭据保密**：
- 写入 environment.json 的 password **不加密**（与现有约定一致）
- 测试数据用 `test_` 前缀，禁止把生产凭据写入测试环境
