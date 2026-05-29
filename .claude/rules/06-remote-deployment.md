# 远程环境部署规则

本文件定义 remote-env-setup Agent 的全部操作规则。Agent 定义（`.claude/agents/remote-env-setup.md`）声明工作流程和策略约定，本文件定义完整操作规则和强制约束。

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
  3. 重新执行完整部署流程（探测 → 安装 → 部署 → 验证 → 输出）
- **构建产物处理**：`build/` 下的文件按新服务器覆盖写入（deploy-config.json、nginx.conf、version-log.json 追加记录、artifacts/ 归档）
- **baseURL 更新**：部署完成后同步更新 environment.json 和 playwright.config.ts
- **禁止**删除旧服务器的远程文件（用户可能仍需要），仅更新本地配置指向新服务器

## 环境探测（强制）

安装前**必须**先探测远程服务器现有环境。根据 environment.json 的 `techStack` 和 `middleware` 选择性检查：

| 类别 | 探测项 | 命令参考 |
|------|--------|---------|
| OS | 发行版、架构 | `cat /etc/os-release`、`uname -m` |
| 运行时 | node/npm/pnpm、java/mvn、python3、go | `xxx --version` |
| 数据库 | mysql/psql/mongosh 版本 + 服务状态 | `systemctl is-active xxx` |
| 中间件 | redis-cli 等 | `systemctl is-active xxx` |
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

远程服务器上的所有项目文件**必须**整齐组织在 `deployPath` 内，禁止散落到外部。具体目录布局由 Agent 根据项目技术栈和构建产物**按实际情况规划**，不套用固定模板。

### 规划原则

- Agent 部署前**必须**先分析项目结构（前端/后端/全栈、构建产物类型、有无数据库迁移文件等），再规划远程目录布局
- 规划结果写入 `deploy-config.json` 的 `directoryLayout` 字段
- 同一服务器多项目时，各项目 deployPath **完全独立**，禁止交叉引用或共享依赖目录

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
# 确认无散落文件
ls -la <deployPath>/ | grep -E '\.log$|\.tgz$|\.zip$|\.sql$' && echo "WARN: 散落文件" || echo "OK"
```

## 构建产物归档（强制）

每次构建**必须**将产物版本化归档到 `build/artifacts/`，不可只保留最新一份。

### 归档流程

1. 构建完成后，将产物打包为 `build/artifacts/<YYYYMMDD-HHmmss>-<commitShortHash>.tar.gz`
   - 例：`build/artifacts/20260528-170000-f59a24c.tar.gz`
2. 归档内容由 Agent 根据 `techStack` 和项目结构确定，通常包括：前端构建产物、后端构建产物、依赖声明文件、ORM schema/迁移文件、.env 模板
3. 生成 `build/artifacts/<YYYYMMDD-HHmmss>-<commitShortHash>.manifest.json` 记录：
   ```json
   {
     "timestamp": "2026-05-28T17:00:00+08:00",
     "commitHash": "f59a24c",
     "branch": "master",
     "deployed": false,
     "source": "local-build | remote-migration",
     "sourceServer": "旧服务器名称（迁移时填写）",
     "deployTarget": { "server": "", "serverIP": "", "deployPath": "", "deployTime": "" },
     "files": { "frontend": "<前端产物路径>", "backend": "<后端产物路径>" },
     "checksums": { "archive": "sha256:xxx" }
   }
   ```
4. 部署使用某个归档时，更新 manifest：
   - `deployed` 标记为 `true`
   - 填写 `deployTarget` 的 server/serverIP/deployPath/deployTime
5. **清理策略**：`deployed: true` 的归档**永不自动删除**；`deployed: false` 且超过 7 天的归档可手动清理
6. 部署时优先使用归档产物，避免重复构建
7. 从旧服务器迁移的产物也按此格式归档，`commitHash` 填 `"unknown-migrated"`

### 归档完整性校验（强制）

归档完成后、上传/部署前，**必须**执行以下校验，任一失败则归档无效，禁止继续部署：

1. **manifest.files 一致性** — 遍历 `manifest.json` 的 `files` 对象（如 `frontend: "web/dist"`, `backend: "api/dist"`），对每个声明的路径：
   - `tar -tzf <archive> | grep "^<路径>/"` 确认归档内存在该路径前缀
   - 文件数 ≥ 1（空目录不算通过）
   - 缺失任一声明的路径 → **归档失败**，记录缺失项并终止
2. **目录结构校验** — 归档内的顶层目录必须与 `deploy-config.json` 的 `directoryLayout` 一致（如 `api/`、`web/`），不允许裸 `dist/` 直接出现在归档根
3. **文件总数对比** — 归档内文件总数与实际上传到远程的文件总数对比，偏差超过 5% 需记录警告
4. **checksum 写入** — 校验通过后才计算 sha256 写入 manifest，确保 checksum 对应的是校验后的最终版本

校验结果记录到 `version-log.json` 当前记录的 `archiveVerification` 字段：

```json
"archiveVerification": {
  "verifiedAt": "<ISO时间>",
  "declaredPaths": { "frontend": "web/dist", "backend": "api/dist" },
  "actualCounts": { "frontend": 261, "backend": 1165, "total": 1426 },
  "passed": true,
  "issues": []
}
```

`passed: false` 时禁止继续部署流程，必须修复归档后重新校验。

### 从旧服务器迁移产物

当本地构建失败且无可用归档时：
1. 从旧服务器 `ssh_execute` 定位构建产物路径
2. 打包下载到本地 `test_project/<NN-Project>/build/tmp/` 并生成 manifest
3. 后续步骤使用归档产物，不再依赖旧服务器在线

## 临时文件管理（强制）

部署过程中产生的所有临时文件**必须**统一存放在 `test_project/<NN-Project>/build/tmp/` 下，禁止散落到项目根目录或其他位置。

### 存放规则

- 下载的远程产物包：`build/tmp/<filename>.tar.gz`
- 数据库 dump 文件：`build/tmp/<filename>.sql.gz`
- 中间传输文件：`build/tmp/<filename>`

### 生命周期

- 部署成功后：`build/tmp/` 下的临时文件**必须清理**（删除目录内容，保留目录）
- 部署失败时：保留临时文件供排查，在报告中记录路径
- 归档到 `build/artifacts/` 的文件不受此规则影响（持久保留）

### 禁止

- 禁止在 `pm/tmp/`、`pm/` 根目录、`/tmp/` 等项目外路径放置部署临时文件
- 禁止在 `repository/` 下放置任何临时文件

## 操作前备份（强制）

**任何破坏性操作前必须先备份**，备份文件保留在远程服务器，部署成功后不自动删除。

### 数据库备份

数据导入/迁移前**必须**执行备份，备份方式由数据库类型决定：
- MySQL: `mysqldump | gzip > backup/pre-deploy-<timestamp>.sql.gz`
- PostgreSQL: `pg_dump | gzip > backup/pre-deploy-<timestamp>.sql.gz`
- MongoDB: `mongodump --gzip --archive=backup/pre-deploy-<timestamp>.archive`
- 其他类型按对应工具执行

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

导入完成后，Agent 分析项目结构自动确定关键表，对比源库和目标库记录数：

- 有 ORM schema 文件时，从 model 定义中自动选取核心业务表（用户、组织、权限相关模型）
- 无 ORM schema 时，从 SQL 初始化文件中提取表名
- 对比方式：在目标库查询记录数，与源库（如有连接）或 seed 文件中的数据量对比

### 用户登录验证

`credentials` 存在时，**必须**测试登录：
- 根据 `techStack.backend` 确定登录请求方式（REST API / GraphQL / 表单提交）
- 登录接口路径从 `login` 字段或源码分析获取
- 返回成功令牌 → PASS
- 返回认证失败 → **部署未完成**，排查密码哈希格式、用户状态字段等

### 缺失数据标记

校验完成后，将数据校验结果记录到 `version-log.json` 当前记录中：
- 各表源库 vs 目标库记录数
- 缺失的表或数据（如果有）
- 修复操作（如果有）

## 构建方式（强制）

**默认：本地编译，远程部署。仅用户明确要求时才远程克隆编译。**

### 本地编译 + 上传（默认）

1. Agent 根据 `techStack` 确定构建命令，在 `repository/<NN-Project>/` 执行
2. **构建失败则终止**，不在远程修复
3. 构建成功 → **立即归档**到 `build/artifacts/`（按「构建产物归档」流程）
4. 上传到 `remoteConfig.deployPath`：
   - 上传：构建产物 + 配置文件 + schema 文件 + 依赖声明文件
   - **不上传**：依赖目录（如 node_modules/、.venv/、.gradle/）、.git/、src/

### 远程克隆编译（仅用户明确要求）

在远程 git clone → 安装依赖 → 构建，命令由 `techStack` 决定。

### 远程安装运行时依赖

上传或克隆完成后，根据 `techStack` 安装生产依赖。

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

有前端的项目，前端服务**必须**通过 Nginx 提供静态文件和 API 反向代理，禁止开发服务器（如 `pnpm dev`、`npm run dev`）。

### 配置生成

Agent 根据项目实际结构生成 Nginx 配置，写入 `/etc/nginx/sites-available/<NN-Project>`：
- 静态文件路径：从部署目录中的前端产物位置确定（dist/、build/、public/ 等）
- SPA 回退：前端框架需要 `try_files $uri $uri/ /index.html`
- API 反向代理：根据后端路由前缀和端口配置
- WebSocket 代理：如项目使用 WebSocket 则需额外配置

### 通用约束

- `nginx -t` 验证配置语法通过
- `systemctl reload nginx` 生效
- 配置副本保存到本地 `build/nginx.conf`

## 后端启动

根据 `techStack.backend` 确定启动方式，Agent 自动选择：

| 技术栈关键词 | 启动方式参考 |
|-------------|------------|
| NestJS/Express/Node.js | `nohup node <入口文件> > logs/backend.log 2>&1 &` |
| Spring/Java | `nohup java -jar <jar文件> > logs/backend.log 2>&1 &` |
| Django/Python | `nohup gunicorn/python manage.py runserver > logs/backend.log 2>&1 &` |
| Go | `nohup ./<二进制文件> > logs/backend.log 2>&1 &` |

启动后确认：`ss -tlnp` 检查端口在监听。失败时查日志排查。无法解决 → 报告用户。

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
| 1 | 依赖安装 | `techStack` | 运行时依赖安装成功 |
| 2 | ORM/数据库迁移 | `dbConfig` | 检查迁移状态或表结构完整性；无 dbConfig 则 SKIP |
| 3 | Nginx 配置 | `techStack.frontend` | nginx -t 通过；无前端则 SKIP |
| 4 | 后端启动 | `techStack.backend` | 进程存在且 `backendPort` 在监听；无后端则 SKIP |
| 5 | 健康检查 | `healthCheck` | 远程 curl `healthCheck.url` 返回 `expectedStatus` |
| 6 | 外部可访问 | `healthCheck` | 本地 curl `healthCheck.url` 返回 `expectedStatus` |
| 7 | 页面内容 | `techStack.frontend` | 返回 HTML（非空白或错误页）；无前端则 SKIP |
| 8 | API 代理 | `techStack.frontend` + `backend` | API 请求通过 Nginx 到达后端；无前端/无后端则 SKIP |

### 第二层：功能验证（强制，不可跳过）

验证方法由 `environment.json` 的字段驱动，Agent **根据项目实际配置自动选择**验证策略，不硬编码。

| # | 验证项 | 配置来源 | 验证方法 |
|---|--------|---------|---------|
| 10 | 用户登录 | `credentials` + `login` | 用 credentials 调用登录接口，验证返回成功令牌。无 credentials 则跳过（在报告中标注 SKIP） |
| 11 | 数据完整性 | `dbConfig` + `middleware` | 连接数据库，查询关键表记录数。无 dbConfig 则跳过。关键表由 Agent 分析项目结构（ORM schema / SQL 文件）自动确定 |
| 12 | 前端页面渲染 | `techStack.frontend` | 有前端的项目：curl 首页 HTML 验证有效内容。纯后端项目则跳过 |

**配置驱动原则**：
- `credentials` 存在 → 必须验证登录；不存在 → 标注 SKIP
- `dbConfig` 存在 → 必须验证数据完整性；不存在 → 标注 SKIP
- `techStack.frontend` 存在 → 必须验证页面渲染；纯后端 → 标注 SKIP
- 具体验证命令由 Agent 根据 `techStack` 和 `login` 字段构造，不套用固定模板
- **第二层中可执行的项（非 SKIP）任一失败 = 部署未完成**

结果全部记录到 `version-log.json` 当前构建记录中，每项标注 PASS/FAIL/SKIP + 实际返回值。

## 错误处理（强制）

**可自动处理**：依赖缺失→安装；数据库未迁移→执行迁移；.env 不存在→从 .env.example 复制。

**必须向用户报告**：SSH 连接失败、端口冲突（占用不明）、磁盘不足（<1GB）、数据库安装失败、系统级配置修改（防火墙/SELinux）、Git 克隆失败、baseURL 变更。

## 产出文件（强制）

写入 `test_project/<NN-Project>/build/`，首次部署时自动创建。再次部署时先读取 `deploy-config.json`，跳过已安装组件。

### version-log.json

构建版本追踪总表，每次构建**追加一条记录**，不覆盖历史：

```json
{
  "schema": "1.0",
  "project": "<NN-Project>",
  "records": [
    {
      "id": 1,
      "time": "<构建完成时间 ISO>",
      "commit": "<commitShortHash>",
      "source": "<构建来源服务器>",
      "target": "<部署目标服务器>",
      "archive": "<归档文件名>",
      "checksum": "sha256:xxx",
      "build": "成功|失败",
      "contents": ["api/dist", "web/dist"],
      "status": "deployed|archived",
      "archiveVerification": {
        "verifiedAt": "<ISO时间>",
        "declaredPaths": { "frontend": "web/dist", "backend": "api/dist" },
        "actualCounts": { "frontend": 0, "backend": 0, "total": 0 },
        "passed": true,
        "issues": []
      }
    }
  ]
}
```

### deploy-config.json

记录部署环境快照，下次构建复用：

```json
{ "project": "", "server": "", "serverIP": "", "deployPath": "", "os": "",
  "installedComponents": {},
  "directoryLayout": { "root": "", "api": "", "web": "", "logs": "" },
  "ports": { "frontend": 0, "backend": 0, "nginx": 0 },
  "artifactArchive": "build/artifacts/<归档文件名>.tar.gz",
  "artifactChecksum": "sha256:xxx",
  "deployTime": "", "verifiedSteps": [] }
```

### .deploy-version（远程服务器，强制）

部署完成后**必须**在远程 `deployPath` 下写入 `.deploy-version` 文件，确保从服务器端可追溯当前版本：

```
archive=<归档文件名>.tar.gz
commit=<commitShortHash>
checksum=sha256:xxx
deployTime=<ISO时间>
server=<服务器名称>
```

每次重新部署时覆盖写入。此文件与本地 manifest.json、deploy-config.json 形成三角闭环追溯。

### nginx.conf

Nginx 配置文件副本。

### artifacts/

构建产物归档目录，每份归档包含：
- `<timestamp>-<commit>.tar.gz` — 构建产物压缩包
- `<timestamp>-<commit>.manifest.json` — 归档清单

## 禁止修改

- 禁止修改 `repository/` 下的源码
- 禁止修改项目根目录下的全局配置（`playwright.config.ts`、`package.json`、`.mcp.json`）
- `test_project/<NN-Project>/.last_hash` 禁止删除或清空
