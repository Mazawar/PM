# 远程环境部署规则

本文件定义 remote-env-setup Agent 的全部操作规则。Agent 定义（`.claude/agents/remote-env-setup.md`）声明工作流程和策略约定，本文件定义完整操作规则和强制约束。

**核心分工**：构建阶段由 Setup Agent（project-manage-setup）在本地完成，产出 `build/dev/` 部署包（含 node_modules、编译产物、Prisma 引擎）。Remote Agent 只负责将已构建的 dev/ 上传到远程、安装系统运行时、配置环境、启动服务。

---

## SSH 操作（强制）

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

## dev/ 部署包确认（强制）

部署前**必须**确认 `build/dev/` 存在且结构完整：

```bash
# 检查关键路径存在
ls build/dev/software/package.json       || echo "MISSING: workspace root"
ls build/dev/software/apps/api/dist/     || echo "MISSING: backend build"
ls build/dev/software/apps/web/dist/     || echo "MISSING: frontend build (if frontend)"
ls build/dev/database/                   || echo "MISSING: database scripts (if exists)"
ls build/dev/deploy.md                   || echo "MISSING: deploy docs"
```

- 缺失关键路径（如 workspace root 无 package.json）→ **终止部署**，提示用户先运行 Setup Agent 完成构建
- 缺失辅助文件（如 database/ 为空）→ 记录警告，继续部署

## 环境探测（强制）

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
| 已安装但版本不满足 | 版本管理工具（nvm 等）安装所需版本 |
| 未安装 | 安装最新稳定版 |

## 安装指导

按 `techStack` 和 `middleware` 选择性安装，每项安装后**必须验证**版本号 + 服务运行状态。

### 通用约束

- Agent 根据 `techStack`（frontend/backend/language）和 `middleware` 数组判断需要安装的组件
- 安装方式由 Agent 根据 OS 发行版自动选择（apt/yum/brew 等）
- 安装前先探测现有环境（见「环境探测」），已安装且版本满足则跳过
- 每项安装后验证：`xxx --version` + `systemctl is-active xxx`（适用时）

### 常见技术栈参考（非穷举）

Agent 应根据实际 `techStack` 选择安装方式，以下仅为参考：

| 技术栈关键词 | 可能需要的运行时 | 可能需要的包管理器 |
|-------------|----------------|------------------|
| Vue/React/Vite/TypeScript | Node.js (nvm) | pnpm/npm |
| Spring/Java/JDK | OpenJDK | Maven/Gradle |
| Python/Django/FastAPI | python3 | pip + venv |
| Go/Gin | go | - |
| Rust/Actix | rustup/cargo | - |

### 数据库（如 dbConfig 存在）

从 `dbConfig.url` 协议自动判断数据库类型，安装并启动：

| 协议关键词 | 数据库 | 必要操作 |
|-----------|--------|---------|
| `mysql://` | MySQL | 安装 → 启动 → 建库 → 验证连接 |
| `postgresql://` / `postgres://` | PostgreSQL | 安装 → 启动 → 建库 → 验证连接 |
| `mongodb://` | MongoDB | 安装 → 启动 → 验证连接 |
| `sqlite:` | SQLite | 无需安装服务，验证文件路径可写 |

### 前端项目（如 techStack.frontend 存在）

有前端的项目**必须**安装 Nginx：
- 安装、启动、设置开机自启
- 验证 `systemctl is-active nginx`

### 中间件

按 `middleware` 数组按需安装（Redis、RabbitMQ 等），安装后启动并验证。

## 远程目录结构规范（强制）

远程服务器上的所有项目文件**必须**整齐组织在 `deployPath` 内，禁止散落到外部。目录布局由 dev/ 包解压后的结构决定（software/、database/、sh/ 等）。

### 强制约束（不限项目类型）

- **禁止**在 `$HOME`、`/tmp`、`/opt` 等非 deployPath 路径下放置项目文件
- **禁止**日志文件（`*.log`）散落在项目根目录，统一放入 `logs/` 子目录
- **禁止**临时构建文件残留（`.tgz`、`.zip` 上传包），部署完成后清理
- 前端产物与后端产物**必须**物理隔离（分目录存放），禁止混在同一层级
- 数据库初始化文件（`.sql`、`migrations/`）部署完成后清理，不留在生产目录
- Nginx 配置仅存放在系统路径 `/etc/nginx/` 和本地 `build/nginx.conf`，不在 deployPath 内重复

### 部署后检查

部署完成后，Agent **必须**验证目录结构：

```bash
ls -la <deployPath>/ | grep -E '\.log$|\.tgz$|\.zip$|\.sql$' && echo "WARN: 散落文件" || echo "OK"
```

## 临时文件管理（强制）

部署过程中产生的临时文件**必须**统一存放在 `test_project/<NN-Project>/build/tmp/` 下。

### 存放规则

- 数据库 dump 文件：`build/tmp/<filename>.sql.gz`
- 中间传输文件：`build/tmp/<filename>`

### 生命周期

- 部署成功后：`build/tmp/` 下的临时文件**必须清理**，仅保留 `.gitkeep` 占位
- 部署失败时：保留临时文件供排查，在报告中记录路径

### 禁止

- 禁止在 `pm/tmp/`、`pm/` 根目录、`/tmp/` 等项目外路径放置临时文件

## build/tmp/ 预创建（远程部署前置，强制）

Remote Setup Agent 启动时**必须**确认本地 `build/tmp/` 目录存在且为空（可含 `.gitkeep` 占位）。

### 检查命令

```bash
[ -d "test_project/<NN-Project>/build/tmp/" ] && echo "[OK]" || mkdir -p "test_project/<NN-Project>/build/tmp/"
```

### Setup Agent 责任

Setup Agent 完成本地构建后**必须**预创建 `build/tmp/`（即使当前为本地构建、无部署需求）：

- 即使本轮是本地构建，`build/tmp/` 也必须存在（为空）
- 避免未来切换到远程部署时出现"目录不存在"的中间状态
- 见 `02-project-invariants.md` 的「build/ 目录产物约定」

### Remote Setup Agent 责任

- 启动前检查 `build/tmp/` 存在性，不存在则立即创建
- 部署过程中所有临时文件（数据库 dump、上传包等）放入 `build/tmp/`
- 部署成功后清理 `build/tmp/` 内非占位文件，保留 `.gitkeep`
- 部署失败时保留 `build/tmp/` 内容供排查，错误报告中记录文件清单

## 操作前备份（强制）

**任何破坏性操作前必须先备份**，备份文件保留在远程服务器，部署成功后不自动删除。

### 数据库备份

数据导入/迁移前**必须**执行备份：
- MySQL: `mysqldump | gzip > backup/pre-deploy-<timestamp>.sql.gz`
- PostgreSQL: `pg_dump | gzip > backup/pre-deploy-<timestamp>.sql.gz`
- MongoDB: `mongodump --gzip --archive=backup/pre-deploy-<timestamp>.archive`
- 首次部署（空库）可跳过
- 重绑定/更新部署**不可跳过**

### 配置备份

Nginx 配置变更前**必须**备份当前配置：
```bash
cp /etc/nginx/sites-available/<NN-Project> <deployPath>/backup/nginx-<timestamp>.conf
```

### 备份验证

备份完成后**必须**验证文件大小 > 0 字节，并记录备份路径到 `deploy-config.json`。

## 数据完整性校验（强制）

数据导入后**必须**校验完整性，不能只执行导入命令就认为成功。

### 记录数对比

导入完成后，从 SQL 初始化文件或 ORM schema 中取关键表，在目标库查询记录数，确认导入完整。

### 用户登录验证

`credentials` 存在时，**必须**测试登录：
- 登录接口路径从 `login` 字段获取
- 返回成功令牌 → PASS
- 返回认证失败 → **部署未完成**，排查密码哈希格式、用户状态字段等

### 缺失数据标记

校验完成后，将结果记录到 `version-log.json` 当前记录中。

## 数据库初始化（如 dbConfig 存在）

1. 根据 `dbConfig.url` 协议判断数据库类型（mysql/postgres/mongodb/sqlite）
2. 读取 `dbConfig.initMethod` 确定初始化方式，读取 `dbConfig.initFiles` 定位迁移/建表文件
3. 根据 `initMethod` 执行对应的初始化命令
4. 验证连接：执行简单查询确认表结构已创建
5. 读取 `dbConfig.seedFiles` 导入种子数据（如有），导入后按「数据完整性校验」验证

## 环境变量

- 配置方式由 `techStack` 决定（`.env`、`application.yml`、`settings.py` 等）
- 模板文件存在时从模板复制（如 `.env.example` → `.env`）
- 数据库地址改 `localhost`
- 端口与 environment.json 一致

## Nginx 配置（前端项目必须）

有前端的项目，前端服务**必须**通过 Nginx 提供静态文件和 API 反向代理。

### 配置生成

Agent 从 `build/dev/` 中的前端产物路径确定静态文件目录，生成 Nginx 配置，写入 `/etc/nginx/sites-available/<NN-Project>`：
- 静态文件路径：`<deployPath>/software/apps/web/dist`（或实际前端产物路径）
- SPA 回退：`try_files $uri $uri/ /index.html`
- API 反向代理：根据后端路由前缀和端口配置
- WebSocket 代理：如项目使用 WebSocket 则需额外配置

### 通用约束

- `nginx -t` 验证配置语法通过
- `systemctl reload nginx` 生效
- 配置副本保存到本地 `build/nginx.conf`

## 上传 dev/ 到远程

将本地 `build/dev/` 打包上传到远程服务器：

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

## 后端启动

根据 `techStack.backend` 确定启动方式，Agent 自动选择：

| 技术栈关键词 | 启动方式参考 |
|-------------|------------|
| NestJS/Express/Node.js | `nohup node -r dotenv/config <入口文件> dotenv_config_path=.env > logs/backend.log 2>&1 &` |
| Spring/Java | `nohup java -jar <jar文件> > logs/backend.log 2>&1 &` |
| Django/Python | `nohup gunicorn/python manage.py runserver > logs/backend.log 2>&1 &` |
| Go | `nohup ./<二进制文件> > logs/backend.log 2>&1 &` |

入口文件路径从 `environment.json` 的 `entryFile` 获取（如 `apps/api/dist/src/main.js`）。
启动后确认 `ss -tlnp` 检查端口在监听。失败时查日志排查。

## SSH 隧道（可选）

端口无法从本地直接访问时：`ssh_tunnel_create` 本地端口转发。有隧道则 baseURL 使用 `localhost:<tunnel-port>`。

## 配置更新（强制）

- 更新 `environment.json` 的 `baseURL` 前**必须**向用户确认新 URL
- `environment.json` 和 `playwright.config.ts` 的 `baseURL` **必须**同步更新
- 不修改 `credentials` 字段
- `remoteConfig` 仅补充 `tunnel` 信息，不覆盖已写入的 server/serverIP/deployPath
- 有隧道则 `baseURL` 使用 `localhost:<tunnel-port>`

## 部署验证（强制）

**不可跳过，全部通过才算部署完成。** 分两层：连通性验证 + 功能验证。

### 第一层：连通性验证

Agent 根据 `techStack` 和 `dbConfig` 自动选择适用项，不适用项标注 SKIP。

| # | 验证项 | 配置来源 | 方法 |
|---|--------|---------|------|
| 1 | 系统运行时 | `techStack` | node/java/python 版本满足 |
| 2 | ORM/数据库迁移 | `dbConfig` | 检查迁移状态或表结构；无 dbConfig 则 SKIP |
| 3 | Nginx 配置 | `techStack.frontend` | nginx -t 通过；无前端则 SKIP |
| 4 | 后端启动 | `techStack.backend` | 进程存在且 `backendPort` 在监听；无后端则 SKIP |
| 5 | 健康检查 | `healthCheck` | 远程 curl `healthCheck.url` 返回 `expectedStatus` |
| 6 | 外部可访问 | `healthCheck` | 本地 curl `healthCheck.url` 返回 `expectedStatus` |
| 7 | 页面内容 | `techStack.frontend` | 返回有效 HTML；无前端则 SKIP |
| 8 | API 代理 | `techStack.frontend` + `backend` | API 请求通过 Nginx 到达后端；无前端/无后端则 SKIP |

### 第二层：功能验证（强制，不可跳过）

| # | 验证项 | 配置来源 | 验证方法 |
|---|--------|---------|---------|
| 10 | 用户登录 | `credentials` + `login` | 调用登录接口返回成功令牌。无 credentials 则 SKIP |
| 11 | 数据完整性 | `dbConfig` | 查询关键表记录数。无 dbConfig 则 SKIP |
| 12 | 前端页面渲染 | `techStack.frontend` | curl 首页验证有效内容。纯后端则 SKIP |

**第二层中可执行的项（非 SKIP）任一失败 = 部署未完成**

结果全部记录到 `version-log.json` 当前构建记录中，每项标注 PASS/FAIL/SKIP + 实际返回值。

## 错误处理（强制）

**可自动处理**：系统依赖缺失 → 安装；数据库未迁移 → 执行迁移；.env 不存在 → 从 .env.example 复制。

**必须向用户报告**：SSH 连接失败、端口冲突（占用不明）、磁盘不足（<1GB）、数据库安装失败、系统级配置修改（防火墙/SELinux）、baseURL 变更。

## 产出文件（强制）

写入 `test_project/<NN-Project>/build/`，再次部署时先读取 `deploy-config.json`，跳过已安装组件。

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

## 禁止修改

- 禁止修改 `repository/` 下的源码
- 禁止修改项目根目录下的全局配置（`playwright.config.ts`、`package.json`、`.mcp.json`）
- `test_project/<NN-Project>/.last_hash` 禁止删除或清空
