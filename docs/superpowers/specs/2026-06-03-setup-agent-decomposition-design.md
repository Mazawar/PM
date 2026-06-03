# Setup + Remote Env 链路三段拆分设计

> 日期：2026-06-03
> 状态：**已实施**（13 commits, 04a858d → c0ff9dc）
> 实施计划：`docs/superpowers/plans/2026-06-03-setup-agent-decomposition.md`
> 关联：`.claude/agents/project-manage-setup.md`、`.claude/agents/remote-env-setup.md`、`03-setup-environment.md`、`08-remote-deployment.md`、`06-agent-workflow.md`

## 背景

现有 setup 链路两个 agent 总计 691 行：

| Agent | 行数 | 职责 |
|---|---|---|
| `project-manage-setup` | 503 | 源码分析、生成配置、生产构建、启动服务、登录验证、写 SETUP.md |
| `remote-env-setup` | 188 | 探测远程、安装运行时、上传 dev/、备份、初始化数据库、启动后端 + Nginx、远程验证、产出 |

**核心问题**：
- setup 单 agent 干 8 件事，单文件 503 行
- setup 与 remote-env-setup 实际上是同一条「本地→远程」配置-构建-验证链路的上下游，但被拆成两个 agent 后**衔接完全靠 prompt 文本**（remote-env-setup 第 3 步「读取 Setup Agent 分析结果」是软引用）
- 「构建模式选择」（本地 or 远程）原本散落在两个 agent 的不同位置，决策时机不明确
- 「服务器绑定」交互动作无明确归属（现在埋在 remote-env-setup 头部）
- 失败时定位责任不清（本地构建失败 vs 远程安装失败？）

参考 `playwright-test-planner` / `playwright-test-generator` / `playwright-test-healer` 的三段拆分范式，把 setup + remote-env-setup **融合看作一条链路**，按 **analyzer / builder / validator 三段**重新切分，**构建模式由 builder 启动前主会话问用户决定**。

## 目标

1. 把「本地配置 + 远程部署」融合为一条三段链路：analyzer / builder / validator
2. 三段 agent 各自 < 300 行（远小于现 691 行）
3. 状态交接载体统一（environment.json 字段段），不再靠 prompt 文本软引用
4. 保留「启动 xxx」日常命令入口（runner 工具）
5. 旧 agent 文件标记 deprecated 但保留（你要求「原来的不动」）

## 范围

### 范围内
- 三个 agent：`project-manage-analyzer` / `project-manage-builder` / `project-manage-validator`
- 1 个工具脚本：`scripts/runner.sh`
- 6 个规则文件：03a/b/c + 08a/b/c
- `environment.json` 字段分段（analyzer / build / validator）
- `pipeline-state.json` `global.Setup` 拆为三段（不再有 RemoteSetup，全链路走三段）
- `migrate-pipeline-state.mjs` 迁移支持
- `06-agent-workflow.md` 同步

### 范围外（明确不动）
- `playwright-test-*`（参考范例，不动）
- `repository/`、`test_project/` 现有项目
- `repository/README.md`、`test_project/README.md` 注册表
- `.last_hash`、`scan.sh`、`init-dirs.mjs`
- 旧 `project-manage-setup.md`、`remote-env-setup.md`（标记 deprecated 但保留）

## 架构

### 三段融合闭环

```
analyzer (本地源码分析 + 远程探测)
   │
   ▼  写入 environment.json.analyzer.*
   │
[主会话问用户：构建模式 = local | remote]  ← 决定 builder 行为
   │
   ▼  写入 environment.json.build.mode
   │
builder (按 mode 分支)
   ├── mode=local:  本地编译 → 归档 → 组装 build/dev/ → 写 start.sh
   └── mode=remote: 本地编译 → 归档 → 组装 build/dev/ → 打包 <NN-Project>.tar.gz
                     → 安装远程运行时 → 上传 dev/ → 备份 → 配置 .env + DB
                     → 写 deploy-config.json / nginx.conf
   │
   ▼  写入 environment.json.build.*
   │
validator (按 mode 分支)
   ├── mode=local:  本地启动 → 健康检查 → 页面验证 → 登录验证 → seed
   └── mode=remote: 远程启动 → 健康检查 → 页面验证 → 登录验证
                     → 更新 baseURL + playwright.config.ts → seed（远程登录状态）
   │
   ▼  写入 environment.json.validator.* + SETUP.md
   │
   进入测试流程
```

**关键设计点**：
- 三段 agent 各管一摊，**不区分本地/远程命名**（路径 project-manage-* 表明「项目管理」作用域，buildMode 字段决定行为分支）
- 「服务器绑定」在 builder 启动前由主会话完成（不是 agent 内的交互动作）
- 远程探测在 analyzer 阶段做（OS/运行时/端口/磁盘），探测失败不阻断本地构建（标注 WARNING）
- remote baseURL 同步在 validator 完成时执行，更新 environment.json 和 playwright.config.ts
- 旧 `global.RemoteSetup` 字段删除，三段覆盖整条链路

### 主会话调度表

| 触发条件 | 主会话动作 | 启动 agent |
|---|---|---|
| `environment.json.analyzer.completedAt` 不存在 | 启动 analyzer | `project-manage-analyzer` |
| analyzer 完成 + `build.mode` 缺失 | **询问用户**：本地 or 远程？写入 `build.mode` | - |
| analyzer 完成 + `build.mode` 已设 | 启动 builder | `project-manage-builder` |
| builder 完成 | 启动 validator | `project-manage-validator` |
| validator 完成 + mode=remote | 提示用户：「远程部署完成，baseURL 已更新」 | - |
| validator 完成 + mode=local | 进入测试流程 | - |
| 用户说「启动/停止/重启 xxx」 | 直接调 runner.sh | - |
| 用户要求切换服务器（重绑定） | 清空 `environment.json.remoteConfig` + `build.mode=remote` → 启动 builder | `project-manage-builder` |

**关键：buildMode 决策点固定在 builder 启动前**：
- analyzer 不问构建模式（专注只读分析）
- validator 不改 buildMode（专注验证）
- 切服务器走 builder（清空 build.mode → 重新问用户 + 重新走 builder + validator）

### 字段分段（environment.json）

```json
{
  "project": "01-oa-llm",
  "analyzer": {
    "completedAt": "...",
    "techStack": { "frontend": "Vue3+Vite", "backend": "NestJS", "language": "TypeScript" },
    "ports": { "frontend": 5173, "backend": 3000 },
    "middleware": ["MySQL"],
    "credentials": { "username": "admin", "password": "..." },
    "dbConfig": { "url": "...", "initMethod": "prisma-migrate", "initFiles": [...] },
    "login": { "url": "/login", "usernamePlaceholder": "...", ... },
    "startCommand": { "frontend": "...", "backend": "...", "full": "..." },
    "healthCheck": { "url": "...", "method": "GET", "expectedStatus": 200 },
    "remoteProbe": {
      "completedAt": "...",
      "os": "Ubuntu 22.04",
      "runtime": { "node": "v20.10.0", "mysql": "8.0.35", "nginx": "1.24.0" },
      "ports": { "free": [3000, 5173], "occupied": [] },
      "disk": "20G available"
    }
  },
  "build": {
    "mode": "remote",
    "version": "v1.0.0",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "checksum": "sha256:...",
    "builtAt": "...",
    "remote": {
      "installedComponents": { "node": "v20.10.0", "mysql": "8.0.35", "nginx": "1.24.0" },
      "uploadArchive": "<NN-Project>.tar.gz",
      "uploadedAt": "...",
      "backupPaths": ["backup/pre-deploy-<ts>.sql.gz", "backup/nginx-<ts>.conf"],
      "deployPath": "/home/user/projects/01-oa-llm"
    }
  },
  "validator": {
    "completedAt": "...",
    "healthCheck": { "passed": true, "latencyMs": 120, "url": "..." },
    "pageCheck": { "passed": true },
    "loginCheck": { "passed": true, "selectors": {...} },
    "selfCheck": {
      "buildDirComplete": true,
      "logsInLogsDir": true,
      "noLocalOnlyArtifacts": true,
      "remoteNginxValid": true
    },
    "setupReport": "SETUP.md",
    "remote": {
      "baseURL": "http://server-ip:80",
      "tunnelEnabled": false
    }
  },
  "remoteConfig": { "server": "ubuntu-dev", "serverIP": "1.2.3.4", "deployPath": "/home/user/projects/01-oa-llm", "frontendBind": "0.0.0.0", "tunnel": { "enabled": false, "localPort": null, "remotePort": null } }
}
```

字段追加规则（强制）：
- analyzer 段由 analyzer agent 一次性写入，**后续 agent 只读不改**
- build 段由 builder agent 一次性写入（`build.remote.*` 子段仅在 mode=remote 时写入）
- validator 段由 validator agent 一次性写入（`validator.remote.*` 子段仅在 mode=remote 时写入）
- remoteConfig 段在主会话完成服务器绑定时写入，validator 只读
- 任何 agent **禁止修改已写字段的值**，只能追加新字段

## 三个 Agent 的边界

### analyzer（只读分析 + 远程探测）

| 项 | 内容 |
|---|---|
| 触发 | `environment.json.analyzer.completedAt` 不存在 |
| 输入 | `repository/<NN-Project>/` 源码、`.claude/rules/03a-analyzer-rules.md`、`.claude/rules/08a-remote-analyzer-rules.md` |
| 输出 | `environment.json.analyzer.*` 段（含 `analyzer.remoteProbe.*`）；`playwright.config.ts`；`init-dirs.mjs` 创建的目录 |
| 不做 | 不执行构建命令、不生成 build/、不启动服务、不写 start.sh、不写 SETUP.md、不问用户构建模式、不问服务器绑定 |

**远程探测规则**：
- **仅在 `remoteConfig.server` 已绑定时**执行远程探测（主会话在第一次 analyzer 启动前不会预填 remoteConfig，analyzer 第一次跑只做本地分析）
- **重绑定时**（切服务器）：先清空 `analyzer.remoteProbe` → 重跑 analyzer → 重新探测
- 探测失败不阻断 analyzer 完成（标注 WARNING + 写 `remoteProbe.error`）
- 远程探测工具：仅 SSH MCP（`ssh_execute`、`ssh_health_check`、`ssh_monitor`）

### builder（生产构建 + 远程部署安装）

| 项 | 内容 |
|---|---|
| 触发 | analyzer 已 completed **且** `environment.json.build.mode` 已设 |
| 输入 | `environment.json.analyzer.*`、`buildMode`、`.claude/rules/03b-builder-rules.md`（local）、`.claude/rules/08b-remote-builder-rules.md`（remote） |
| 输出 | `build/dev/` 部署包；`build/artifacts/<ts>-<commit>.tar.gz` + manifest；`start.sh`；`version-log.json`；`environment.json.build.*` 段 |
| 不做 | 不启动服务、不做健康检查、不写 SETUP.md、不生成 seed.spec.ts、不更新 baseURL |

**buildMode 分支**：

| 步骤 | local 模式 | remote 模式 |
|---|---|---|
| 编译 → 归档 → 组装 build/dev/ | ✓ | ✓ |
| 写 start.sh | ✓ | ✓ |
| 写 version-log.json | ✓ | ✓ |
| build/ 自检清单 | ✓（必无项检查） | ✓（必无项检查） |
| 打包 `<NN-Project>.tar.gz` | ✗ | ✓ |
| 写 `deploy-config.json` | ✗ | ✓ |
| 写 `nginx.conf` | ✗ | ✓ |
| 安装远程运行时 | ✗ | ✓ |
| 上传 dev/ 到远程 | ✗ | ✓ |
| 备份数据库 + Nginx | ✗ | ✓ |
| 配置 .env + 初始化 DB | ✗ | ✓ |
| 写 `environment.json.build.remote.*` | ✗ | ✓ |

**mode=remote 时的 server 绑定前置**：
- builder 启动时主会话检查 `remoteConfig.server` 是否已绑定
- 未绑定 → builder 不启动，主会话用 `AskUserQuestion` 问用户「选服务器 + deployPath」→ 写入 `remoteConfig`
- 绑定 → builder 启动，remoteConfig 已就绪

### validator（启动验证 + 远程验证 + baseURL 同步）

| 项 | 内容 |
|---|---|
| 触发 | builder 已 completed |
| 输入 | `build/dev/` + `start.sh` + `environment.json.analyzer.credentials/login` + `.claude/rules/03c-validator-rules.md`（local）、`.claude/rules/08c-remote-validator-rules.md`（remote） |
| 输出 | 服务运行中；`tests/seed.spec.ts` + `test-config/auth.json`；`SETUP.md`（含 build/ 自检结果表）；`environment.json.validator.*` 段 |
| 不做 | 不修改 build/ 产物（不动 dev/、不重打归档）、不改 buildMode、不改 analyzer 段 |

**buildMode 分支**：

| 步骤 | local 模式 | remote 模式 |
|---|---|---|
| 启动服务（执行 start.sh / 远程启动后端 + Nginx） | ✓ | ✓ |
| 健康检查（轮询 `validator.healthCheck.url`） | ✓（本地端口） | ✓（远程 URL） |
| 页面加载验证（browser_snapshot） | ✓ | ✓ |
| 登录验证（用 credentials 试登录） | ✓ | ✓ |
| 生成 `seed.spec.ts` + `auth.json` | ✓（本地下次复用） | ✓（远程下一次测试时通过 tunnel 复用） |
| 写 SETUP.md | ✓ | ✓（含远程部署信息） |
| 写 `environment.json.validator.*` | ✓ | ✓ |
| 更新 `environment.json.baseURL` | ✗ | ✓（问用户确认远程 URL） |
| 同步更新 `playwright.config.ts` baseURL | ✗ | ✓ |

## 主会话启动 Prompt 模板

每个 prompt 都有「前置检查」+「你的任务」+「完成后」+「明确不做」四段，避免 agent 越界。

### analyzer 启动

```
请为项目 <NN-Project> 执行环境分析。

项目根路径：test_project/<NN-Project>
仓库路径：repository/<NN-Project>

前置检查：
1. 确认 test_project/<NN-Project>/ 目录存在，不存在则立即报错退出
2. 读取 .pipeline-state.json（如存在），输出 global.Analyze 当前状态
3. 读取 test-config/environment.json.analyzer.completedAt，如已存在则报错：analyzer 已完成

你的任务：
- 读取 repository/<NN-Project>/ 源码
- 按 03a-analyzer-rules.md 推断端口、技术栈、中间件、启动命令
- 写入 test-config/environment.json 的 analyzer 段
- 写入 playwright.config.ts
- 运行 init-dirs.mjs 初始化目录
- 远程探测（仅当 environment.json.remoteConfig.server 非空时执行）：
  - 按 08a-remote-analyzer-rules.md 用 SSH MCP 探测 OS、运行时、端口、磁盘
  - 写入 environment.json.analyzer.remoteProbe.*
  - 探测失败不阻断，标注 WARNING

完成后：
- 在 environment.json.analyzer.completedAt 写入 ISO 时间
- 输出 environment.json 的 analyzer 段摘要
- 不要执行构建、不要启动服务、不要问用户构建模式、不要问服务器绑定
```

### builder 启动

```
请为项目 <NN-Project> 执行生产构建。

项目根路径：test_project/<NN-Project>

前置检查：
1. 读取 test-config/environment.json.analyzer 段，必须存在（否则报错：先运行 analyzer）
2. 读取 environment.json.build.mode，必须为 'local' 或 'remote'（否则报错：询问用户构建模式）
3. mode=remote 时读取 environment.json.remoteConfig.server，必须已绑定（否则报错：主会话先问服务器绑定）
4. 读取 .pipeline-state.json，输出 global.Build 当前状态

构建模式：<local|remote>  ← 从 environment.json.build.mode 读取
技术栈：<analyzer.techStack>
端口：<analyzer.ports>
启动命令：<analyzer.startCommand>

你的任务（按 buildMode 分支）：
- 共用步骤（local + remote）：
  - 按 03b-builder-rules.md 执行构建顺序
  - 编译 → 归档 → 组装 build/dev/
  - 写 start.sh（指向 build/dev/）
  - 写 version-log.json（含 archiveVerification）
  - 写 build/ 自检清单（仅静态检查，不启动服务）
- 仅 mode=local：
  - 无额外步骤
- 仅 mode=remote（按 08b-remote-builder-rules.md）：
  - 打包 <NN-Project>.tar.gz
  - 写 deploy-config.json
  - 写 nginx.conf
  - 安装远程系统运行时（Node/MySQL/Nginx，参考 analyzer.remoteProbe）
  - 上传 <NN-Project>.tar.gz 到 deployPath
  - 备份数据库 + Nginx 配置
  - 远程配置 .env + 初始化数据库
  - 写 environment.json.build.remote.*

完成后：
- 在 environment.json.build 段写入 archive、checksum、builtAt
- mode=remote 时同步写 build.remote.*
- 不要启动服务、不要做健康检查、不要更新 baseURL
```

### validator 启动

```
请为项目 <NN-Project> 执行环境验证。

项目根路径：test_project/<NN-Project>

前置检查：
1. 读取 test-config/environment.json.build 段，必须存在（否则报错：先运行 builder）
2. 确认 build/dev/ 结构完整
3. 读取 .pipeline-state.json，输出 global.Validate 当前状态
4. mode=remote 时确认 environment.json.remoteConfig 已绑定 + 部署包在远程 deployPath

部署包：test_project/<NN-Project>/build/dev/
启动脚本：test_project/<NN-Project>/start.sh
凭据：<environment.json.analyzer.credentials>
登录信息：<environment.json.analyzer.login>
构建模式：<local|remote>

你的任务（按 buildMode 分支）：
- 共用步骤（local + remote）：
  - 按 03c-validator-rules.md 执行验证
  - 启动服务（local 执行 start.sh；remote 启动后端 + Nginx）
  - 健康检查（轮询 healthCheck.url，remote 用远程 URL）
  - 页面加载验证（browser_snapshot）
  - 登录验证（用 credentials 试登录）
  - 生成 tests/seed.spec.ts + test-config/auth.json
  - 写 SETUP.md（含 build/ 自检结果表）
  - 在 environment.json.validator 段写入验证结果
- 仅 mode=remote（按 08c-remote-validator-rules.md）：
  - 部署验证两层（连通性 + 功能）
  - 询问用户确认新 baseURL
  - 更新 environment.json.baseURL + playwright.config.ts baseURL
  - 写 environment.json.validator.remote.*

完成后：
- 服务运行中
- SETUP.md 已写入
- mode=remote 时 baseURL 已同步
- 不要修改 build/ 产物
```

## pipeline-state 状态转换

### 新 schema

```json
{
  "schemaVersion": 2,
  "global": {
    "Analyze":  { "status": "pending|running|completed|failed|skipped", "at": "ISO", "reason": "..." },
    "Build":    { "status": "pending|running|completed|failed|skipped", "at": "ISO", "reason": "..." },
    "Validate": { "status": "pending|running|completed|failed|skipped", "at": "ISO", "reason": "..." }
  }
}
```

**删除原 `global.RemoteSetup` 字段**（三段已覆盖全链路，包括远程）。

### 转换规则

| 失败 | 影响 | 主会话处理 |
|---|---|---|
| Analyze 失败 | 阻断 Build、Validate | 报告用户，决定重跑或调整源码 |
| Build 失败 | 阻断 Validate | 报告用户，可重跑 builder（不重跑 analyzer） |
| Validate 失败 | 不阻断后续 | 报告用户，可重跑 validator（不重跑 builder） |
| Build mode=remote 时远程步骤失败 | 同 Build 失败 | builder 内区分本地/远程失败原因，附 reason |

### 启动判定

migrate 脚本读取后输出：

```
## Current Focus
- Global: Analyze ✓ / Build [running] / Validate
```

### 已配置但需重建 build/

- 触发：`analyzer.completedAt` 存在但 `build/` 目录不存在
- 判定：直接启动 builder（不重跑 analyzer）

### 切服务器（重绑定）

- 触发：用户明确要求换服务器，或主会话检测到当前 `remoteConfig.server` 不可达
- 流程：
  1. 清空 `environment.json.remoteConfig`（保留 `frontendBind`/`tunnel` 默认值）
  2. 主会话用 `AskUserQuestion` 问用户「选服务器 + deployPath」→ 写入 `remoteConfig`
  3. 清空 `analyzer.remoteProbe` 字段（远程探测需重做）
  4. 重跑 analyzer（仅远程探测部分 + 写回 `analyzer.remoteProbe`）— **实现方式**：analyzer 检测到 `analyzer.completedAt` 存在但 `analyzer.remoteProbe` 缺失时，仅做远程探测
  5. 重跑 builder（mode=remote）
  6. 重跑 validator
- baseURL：旧值清空，新值由 validator 写

### migrate 脚本改动

- 旧 schema 有 `global.Setup` → 迁移到新 schema 的 `global.Validate`（build/dev/ 已就绪 ≈ validate 该做了）
- 旧 schema 有 `global.RemoteSetup` → 复制到 `global.Build`（远程部署在 builder 阶段）
- `global.Build` 默认 pending
- `global.Analyze` 默认 pending
- 旧 `global.Setup.completedAt` 复制到 `global.Validate.completedAt`
- 旧 `global.RemoteSetup.completedAt` 复制到 `global.Build.completedAt`

## runner 工具脚本

**位置**：`scripts/runner.sh`（项目根 `pm/` 下，与 scan.sh 同级）

**职责**：

| 命令 | 行为 | 是否写 environment.json |
|---|---|---|
| `bash scripts/runner.sh start <NN-Project>` | 检查端口占用 → 未占用则执行 start.sh | 否 |
| `bash scripts/runner.sh stop <NN-Project>` | 找进程 → kill | 否 |
| `bash scripts/runner.sh restart <NN-Project>` | stop + start | 否 |
| `bash scripts/runner.sh status <NN-Project>` | 端口 + 进程查询 | 否 |

**主会话识别用户命令**：

| 用户说 | 主会话动作 |
|---|---|
| 「启动 xxx」 | `Bash("bash scripts/runner.sh start 01-xxx")` |
| 「停止 xxx」 | `Bash("bash scripts/runner.sh stop 01-xxx")` |
| 「重启 xxx」 | `Bash("bash scripts/runner.sh restart 01-xxx")` |
| 「启动一下 oa-llm」 | 推断项目编号 → runner start |
| 「配置 xxx 项目」 | 启动 analyzer |
| 「构建 xxx」 | 询问构建模式 → 写 `build.mode` → 启动 builder |
| 「验证 xxx」 | 启动 validator |
| 「部署到远程 xxx」 | 启动 analyzer（重跑远程探测）→ 写 `build.mode=remote` → 启动 builder → 启动 validator |

**跨平台兼容**：用 `netstat -ano`（Windows）+ `lsof`（Linux）双兼容，与 start.sh 风格一致。

**规则文件**：`03d-runner-rules.md` 极简，只定义命令协议 + 错误处理。

## 实施步骤

| # | 动作 | 文件 |
|---|---|---|
| 1 | 新建 `03a-analyzer-rules.md` | `.claude/rules/03a-analyzer-rules.md` |
| 2 | 新建 `03b-builder-rules.md` | `.claude/rules/03b-builder-rules.md` |
| 3 | 新建 `03c-validator-rules.md` | `.claude/rules/03c-validator-rules.md` |
| 4 | 新建 `03d-runner-rules.md` | `.claude/rules/03d-runner-rules.md` |
| 5 | 新建 `08a-remote-analyzer-rules.md` | `.claude/rules/08a-remote-analyzer-rules.md` |
| 6 | 新建 `08b-remote-builder-rules.md` | `.claude/rules/08b-remote-builder-rules.md` |
| 7 | 新建 `08c-remote-validator-rules.md` | `.claude/rules/08c-remote-validator-rules.md` |
| 8 | 改写 `03-setup-environment.md` 为索引 | `.claude/rules/03-setup-environment.md` |
| 9 | 改写 `08-remote-deployment.md` 为索引 | `.claude/rules/08-remote-deployment.md` |
| 10 | 新建 `project-manage-analyzer.md` | `.claude/agents/project-manage-analyzer.md` |
| 11 | 新建 `project-manage-builder.md` | `.claude/agents/project-manage-builder.md` |
| 12 | 新建 `project-manage-validator.md` | `.claude/agents/project-manage-validator.md` |
| 13 | 旧 `project-manage-setup.md` 加 deprecated 标记 | `.claude/agents/project-manage-setup.md` |
| 14 | 旧 `remote-env-setup.md` 加 deprecated 标记 | `.claude/agents/remote-env-setup.md` |
| 15 | 更新 `06-agent-workflow.md` Setup 章节 | `.claude/rules/06-agent-workflow.md` |
| 16 | 更新 `migrate-pipeline-state.mjs` 支持 Setup → Validate + RemoteSetup → Build 迁移 | `.claude/scripts/migrate-pipeline-state.mjs` |
| 17 | 新建 `scripts/runner.sh` | `scripts/runner.sh` |
| 18 | 验证：01-oa-llm 走 local 三段全流程 | 实际项目 |
| 19 | 验证：01-oa-llm 走 remote 三段全流程（可选，需绑定服务器） | 实际项目 |

## 验收标准

- 三个 agent 各 < 300 行（远小于原 691 行总和）
- 01-oa-llm 实测：
  - 配置新项目走 analyzer → 写 environment.json.analyzer
  - 跑 builder local 模式 → 生成 build/dev/，无 `<NN-Project>.tar.gz`
  - 跑 validator → 服务起来、SETUP.md 生成、seed 写入
  - 跑 builder remote 模式 → 远程 dev/ 上传、安装运行时、Nginx 配置完成
  - 跑 validator remote → 远程服务起来、baseURL 同步、远程 SETUP.md
  - 「启动 01-oa-llm」→ runner.sh start 成功
- `environment.json` 三段字段各自完整，不互相覆盖
- `pipeline-state.json` 三个阶段独立 status，可分别追踪；旧 `RemoteSetup` 字段已迁移
- 旧 `project-manage-setup.md`、`remote-env-setup.md` 标记 deprecated 但不删除

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 三个 agent 接力时丢失上下文 | environment.json 字段段是「唯一接力载体」，prompt 模板显式声明读取 |
| validator 失败时 build/ 产物可能有问题 | validator 不修改 build/，失败时报告用户决定重跑 validator 还是回 builder |
| 旧项目已有 `global.Setup` + `global.RemoteSetup` 字段 | migrate 脚本兼容：Setup → Validate、RemoteSetup → Build |
| 远程探测失败阻断本地分析 | analyzer 中远程探测失败标注 WARNING，不阻断 completedAt |
| 切服务器后旧 baseURL 残留 | 切服务器时主会话清空 baseURL，新值由 validator 写 |
| 远程 baseURL 变更需用户确认 | validator 启动时用 AskUserQuestion 确认新 URL，避免自动改 baseURL |
| runner.sh 跨平台差异 | 复用 start.sh 已验证的 `netstat -ano | lsof` 双兼容模式 |
