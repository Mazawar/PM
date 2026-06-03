# Setup + Remote Env 链路三段拆分实施计划

> **状态：** ✅ **已完成 13 个 Task**（commits `04a858d` → `c0ff9dc`，2026-06-03 14:35 GMT+8）
> **Task 14 端到端 local 验证** 因 01-oa-llm 是用户现有项目（未授权重跑），仅做静态验证
> **Task 15 端到端 remote 验证** 用静态模拟替代（无 SSH 服务器配置）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 `project-manage-setup`（503 行）和 `remote-env-setup`（188 行）两个 agent 拆分为 `project-manage-analyzer` / `project-manage-builder` / `project-manage-validator` 三个 agent，并提供 `runner.sh` 日常启停工具，覆盖本地+远程全链路。

**Architecture:** 三段融合闭环：analyzer（只读分析 + 远程探测） → builder（按 buildMode 分支：local 编译归档 / remote 编译+远程安装+上传） → validator（启动验证 + 远程验证 + baseURL 同步）。状态交接以 `environment.json` 的 `analyzer.* / build.* / validator.*` 字段段为唯一载体。`pipeline-state.json` `global` 字段从 `Setup/RemoteSetup` 改为 `Analyze/Build/Validate`。旧 agent 标记 deprecated 但保留。

**Tech Stack:** Node.js (ESM, .mjs) + bash + SSH MCP + Playwright MCP

**Spec:** `docs/superpowers/specs/2026-06-03-setup-agent-decomposition-design.md`

**前置检查：** 所有任务开始前先确认 `test_project/01-oa-llm/` 目录存在（用于最终验证），且 `repository/01-oa-llm/` 已 git clone。

---

## 任务依赖图

```
Task 1 索引与共享工具
  ↓
Task 2-4 analyzer 三件套（agent + 03a + 08a）
  ↓
Task 5-7 builder 三件套（agent + 03b + 08b）
  ↓
Task 8-10 validator 三件套（agent + 03c + 08c）
  ↓
Task 11 runner（agent外工具 + 03d）
  ↓
Task 12 pipeline-state 迁移
  ↓
Task 13 06-agent-workflow.md 同步
  ↓
Task 14 旧 agent deprecate 标记
  ↓
Task 15-16 端到端验证（local + remote）
```

---

## Task 1: 创建规则文件索引与 03a-analyzer-rules

**Files:**
- Create: `.claude/rules/03a-analyzer-rules.md`
- Modify: `.claude/rules/00-README.md`

### Step 1.1: 写入 03a-analyzer-rules.md

文件 `.claude/rules/03a-analyzer-rules.md`：

```markdown
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
```

### Step 1.2: 更新 00-README.md 索引

修改 `.claude/rules/00-README.md`，在「规则总览」树的「Agent 约束层」下追加：

```markdown
├── 03-setup-environment    Setup Agent — 数据库初始化、端口推断、脚本验证、问题处理
├── 03a-analyzer-rules      analyzer agent — 本地源码分析、写入 environment.json.analyzer
├── 03b-builder-rules       builder agent — 生产构建、归档、组装 build/dev/
├── 03c-validator-rules     validator agent — 启动服务、健康检查、登录验证、写 SETUP.md
├── 03d-runner-rules        runner.sh — 日常启停服务（工具，非 agent）
```

并在「规则与 Agent 定义的关系」表追加：

| Agent 定义 | 约束规则 |
|-----------|---------|
| `project-manage-analyzer.md` | `03a-analyzer-rules.md`、`08a-remote-analyzer-rules.md` |
| `project-manage-builder.md` | `03b-builder-rules.md`、`08b-remote-builder-rules.md` |
| `project-manage-validator.md` | `03c-validator-rules.md`、`08c-remote-validator-rules.md` |

### Step 1.3: 提交

```bash
git add .claude/rules/03a-analyzer-rules.md .claude/rules/00-README.md
git commit -m "feat(rules): 新增 03a-analyzer-rules 与规则索引更新"
```

---

## Task 2: 创建 08a-remote-analyzer-rules

**Files:**
- Create: `.claude/rules/08a-remote-analyzer-rules.md`

### Step 2.1: 写入 08a-remote-analyzer-rules.md

```markdown
# analyzer 远程探测规则

> 配套 agent: `project-manage-analyzer`
> 本地分析见 `03a-analyzer-rules.md`

## 触发条件

**仅在 `environment.json.remoteConfig.server` 非空时执行远程探测。**

- 首次跑 analyzer：主会话在启动前不会预填 remoteConfig，因此首次只做本地分析
- 重绑定切服务器：先清空 `analyzer.remoteProbe` → 重跑 analyzer → 重新探测

## 探测工具

**仅使用 SSH MCP 工具**（`ssh_execute`、`ssh_health_check`、`ssh_monitor`）。禁止用 `Bash` + `ssh`。

## 探测项

按以下顺序探测，结果写入 `environment.json.analyzer.remoteProbe.*`：

| 项 | 命令 | 写入字段 |
|---|------|---------|
| OS | `cat /etc/os-release` | `remoteProbe.os` |
| Node.js | `node --version`（如适用） | `remoteProbe.runtime.node` |
| Java | `java --version`（如适用） | `remoteProbe.runtime.java` |
| Python | `python3 --version`（如适用） | `remoteProbe.runtime.python` |
| MySQL | `mysql --version` + `systemctl is-active mysql` | `remoteProbe.runtime.mysql` |
| PostgreSQL | `psql --version` | `remoteProbe.runtime.postgres` |
| Nginx | `nginx -v` + `systemctl is-active nginx` | `remoteProbe.runtime.nginx` |
| 端口 | `ss -tlnp` 对比 `analyzer.ports` | `remoteProbe.ports.free` / `ports.occupied` |
| 磁盘 | `df -h $HOME` | `remoteProbe.disk` |

## 失败处理

**探测失败不阻断 analyzer 完成。**

- 写 `remoteProbe.error = "<错误描述>"`
- 写 `remoteProbe.warnings = ["<warning-1>", ...]`
- 继续写 `analyzer.completedAt`

## 写入字段

```json
{
  "analyzer": {
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

## 完成后

- analyzer 段 `completedAt` 已写
- 输出 remoteProbe 摘要
- **不安装任何运行时**（安装是 builder 阶段）
- **不上传任何文件**（上传是 builder 阶段）
```

### Step 2.2: 提交

```bash
git add .claude/rules/08a-remote-analyzer-rules.md
git commit -m "feat(rules): 新增 08a-remote-analyzer-rules（远程探测）"
```

---

## Task 3: 创建 project-manage-analyzer agent

**Files:**
- Create: `.claude/agents/project-manage-analyzer.md`

### Step 3.1: 写入 agent 定义

```markdown
---
name: project-manage-analyzer
description: '项目环境分析智能体。读取仓库源码、推断技术栈/端口/中间件/凭据、写入 environment.json.analyzer 段、生成 playwright.config.ts、初始化目录。远程探测在 remoteConfig.server 已绑定时执行。由主会话在 environment.json.analyzer.completedAt 缺失时启动。'
tools: Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, mcp__playwright-test__browser_navigate, mcp__playwright-test__browser_snapshot, mcp__playwright-test__browser_click, mcp__playwright-test__browser_type, mcp__playwright-test__browser_take_screenshot, mcp__playwright-test__browser_wait_for
model: sonnet
color: purple
---

你是 PM 自动化测试智能体的**项目环境分析专家**，负责只读分析仓库源码并写入 `environment.json.analyzer` 段。

项目规则在 `.claude/rules/` 下自动加载。强制约束在 `03a-analyzer-rules.md`（本地分析）和 `08a-remote-analyzer-rules.md`（远程探测）。

## 项目上下文

- 仓库目录：`repository/<NN-Project>/`（**只读，禁止修改**）
- 测试工程：`test_project/<NN-Project>/`
- 环境配置：`test_project/<NN-Project>/test-config/environment.json`
- Playwright 配置：`test_project/<NN-Project>/playwright.config.ts`

## 启动前主会话必传信息

启动时主会话会通过 prompt 传递：
- `<NN-Project>` 项目编号
- 仓库路径 `repository/<NN-Project>/`
- 当前 `environment.json` 内容（如已存在）
- `remoteConfig.server` 状态（决定是否做远程探测）

## 工作流程

### Step 1: 前置检查

1. 确认 `test_project/<NN-Project>/` 目录存在，不存在则立即报错退出
2. 读取 `.pipeline-state.json`，输出 `global.Analyze` 当前状态
3. 读取 `environment.json.analyzer.completedAt`，如已存在则报错："analyzer 已完成"

### Step 2: 仓库分析（按 03a-analyzer-rules.md）

1. 读取 `repository/<NN-Project>/` 关键配置文件
2. 推断技术栈、端口、中间件、启动命令、凭据
3. 不推断出的询问用户

### Step 3: 初始化目录

```bash
node .claude/scripts/init-dirs.mjs --project <NN-Project>
```

幂等脚本，已存在的目录和文件不会被覆盖。

### Step 4: 写入 environment.json.analyzer 段

按 `03a-analyzer-rules.md` 的字段模板写入。已存在的 `analyzer` 字段保留（避免覆盖已分析部分）。

### Step 5: 写入 playwright.config.ts

```typescript
import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  outputDir: './artifacts',
  use: {
    baseURL: 'http://localhost:<前端端口>',
    headless: true,
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  reporter: [['json', { outputFile: './playwright-report.json' }], ['line']],
  projects: [
    { name: 'setup', testMatch: /seed\.spec\.ts$/ },
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        storageState: path.resolve(__dirname, 'test-config', 'auth.json'),
      },
      dependencies: ['setup'],
      testIgnore: /seed\.spec\.ts$/,
    },
  ],
});
```

`baseURL` 端口必须与 `environment.json.analyzer.ports.frontend` 一致。

### Step 6: 远程探测（条件性）

**仅在 `environment.json.remoteConfig.server` 非空时执行**（按 08a-remote-analyzer-rules.md）：

1. 用 SSH MCP 探测 OS、运行时、端口、磁盘
2. 写入 `environment.json.analyzer.remoteProbe.*`
3. 探测失败不阻断，标注 WARNING

**主会话在首次 analyzer 启动前不会预填 remoteConfig，因此首次只做本地分析。**

### Step 7: 收尾

1. 写 `analyzer.completedAt` = 当前 ISO 时间
2. 输出 analyzer 段摘要
3. 提示主会话：「请询问用户构建模式（local | remote），写入 `environment.json.build.mode`」

## 禁止

- 执行构建命令
- 生成 `build/` 目录
- 启动服务
- 写 `start.sh`、`SETUP.md`、`seed.spec.ts`
- 询问用户「构建模式选择」或「服务器绑定」（由主会话负责）
- 修改 `repository/` 下的源码
- 删除 `case/` 中的用户文件
```

### Step 3.2: 提交

```bash
git add .claude/agents/project-manage-analyzer.md
git commit -m "feat(agents): 新增 project-manage-analyzer"
```

---

## Task 4: 创建 03b-builder-rules

**Files:**
- Create: `.claude/rules/03b-builder-rules.md`

### Step 4.1: 写入 03b-builder-rules.md

```markdown
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
```

### Step 4.2: 提交

```bash
git add .claude/rules/03b-builder-rules.md
git commit -m "feat(rules): 新增 03b-builder-rules（构建+部署包组装）"
```

---

## Task 5: 创建 08b-remote-builder-rules

**Files:**
- Create: `.claude/rules/08b-remote-builder-rules.md`

### Step 5.1: 写入 08b-remote-builder-rules.md

```markdown
# builder 远程部署规则

> 配套 agent: `project-manage-builder`
> 本地构建部分见 `03b-builder-rules.md`

## 触发条件

- `environment.json.build.mode == "remote"`
- `environment.json.remoteConfig.server` 已绑定
- `environment.json.remoteConfig.deployPath` 已设置

## 工具

**仅 SSH MCP 工具**：`ssh_execute`、`ssh_execute_sudo`、`ssh_upload`、`ssh_db_*` 等。禁止用 `Bash` + `ssh`。

## 步骤（在 03b 共用步骤基础上追加）

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

### 4. 安装系统运行时（远程）

按 `analyzer.remoteProbe.runtime` 决定安装项：
- 缺失 → 安装
- 已存在且版本满足 → 跳过
- 已存在但版本不满足 → 用 nvm 等版本管理工具安装

**不在此步骤安装项目依赖**（`pnpm install` 等在本地 dev/ 中已装好）。

每项安装后验证：`xxx --version` + `systemctl is-active xxx`。

### 5. 上传 dev/ 到远程

```bash
ssh_upload <NN-Project>.tar.gz <deployPath>/
ssh_execute "cd $(dirname <deployPath>) && tar -xzf <deployPath>/<NN-Project>.tar.gz"
```

验证解压：`ls <deployPath>/software/package.json`。

### 6. 操作前备份

**首次部署可跳过**，重绑定/更新部署必做：

```bash
# MySQL 备份
mysqldump | gzip > <deployPath>/backup/pre-deploy-<timestamp>.sql.gz

# Nginx 备份
cp /etc/nginx/sites-available/<NN-Project> <deployPath>/backup/nginx-<timestamp>.conf
```

验证文件大小 > 0 字节，记录路径到 `deploy-config.json` 和 `version-log.json` 当前记录的 `backupPaths`。

### 7. 配置 .env + 初始化数据库

1. 从 `.env.development` 复制为 `.env`
2. 修改 `DATABASE_URL` 指向 `localhost` 或远程 DB
3. 读取 `analyzer.dbConfig.initMethod`：
   - `sql-dump`：建库 → 导入全量 SQL（指定 `--default-character-set=utf8mb4`）
   - `prisma-migrate` / `mybatis-sql` 等：执行对应迁移
4. 验证：执行简单查询确认表结构存在
5. 导入 `seedFiles`（如有）

### 8. 写入 build.remote 子段

```json
{
  "build": {
    "remote": {
      "installedComponents": { "node": "v20.10.0", "mysql": "8.0.35", "nginx": "1.24.0" },
      "uploadArchive": "<NN-Project>.tar.gz",
      "uploadedAt": "ISO",
      "backupPaths": ["backup/pre-deploy-<ts>.sql.gz"],
      "deployPath": "/home/user/projects/<NN-Project>"
    }
  }
}
```

## 远程目录结构（强制）

```
<deployPath>/
├── software/      # 含 node_modules
├── database/
├── sh/
├── deploy-manual.md
├── update_readme.md
├── deploy.md
├── logs/          # 统一日志
└── backup/        # 备份
```

**禁止**在 `$HOME`、`/tmp`、`/opt` 散落项目文件。**禁止** `*.log` 散落到根或 apps/。

## 临时文件管理

部署过程产生的临时文件放本地 `test_project/<NN-Project>/build/tmp/`。

部署成功后清理 `build/tmp/` 内非占位文件，保留 `.gitkeep`。

## 禁止

- 修改 `repository/` 下的源码
- 自动修改 `environment.json.baseURL`（validator 阶段处理）
- 启动后端 / 写 SETUP.md（validator 阶段处理）
- 删除旧服务器上的远程文件（用户可能仍需要）
```

### Step 5.2: 提交

```bash
git add .claude/rules/08b-remote-builder-rules.md
git commit -m "feat(rules): 新增 08b-remote-builder-rules（远程部署）"
```

---

## Task 6: 创建 project-manage-builder agent

**Files:**
- Create: `.claude/agents/project-manage-builder.md`

### Step 6.1: 写入 agent 定义

```markdown
---
name: project-manage-builder
description: '项目生产构建智能体。按 buildMode 分支执行：local 编译+归档+组装 dev/；remote 在 local 基础上+打包+安装远程运行时+上传+配置 .env+初始化 DB。完成后写 environment.json.build 段。不启动服务（validator 阶段负责）。由主会话在 analyzer 完成且 build.mode 已设时启动。'
tools: Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion,
  mcp__ssh-manager__ssh_execute,
  mcp__ssh-manager__ssh_execute_sudo,
  mcp__ssh-manager__ssh_upload,
  mcp__ssh-manager__ssh_health_check,
  mcp__ssh-manager__ssh_db_list,
  mcp__ssh-manager__ssh_db_query,
  mcp__ssh-manager__ssh_monitor
model: sonnet
color: orange
---

你是 PM 自动化测试智能体的**项目生产构建专家**，按 `buildMode` 分支执行本地构建 + 远程部署。

项目规则在 `.claude/rules/` 下自动加载。强制约束在 `03b-builder-rules.md`（构建+部署包）和 `08b-remote-builder-rules.md`（远程部署）。

## 项目上下文

- 仓库目录：`repository/<NN-Project>/`（只读）
- 测试工程：`test_project/<NN-Project>/`
- 部署包：`test_project/<NN-Project>/build/dev/`（**builder 产出**）
- 归档：`test_project/<NN-Project>/build/artifacts/`

## 启动前主会话必传信息

- `<NN-Project>` 项目编号
- `buildMode`（从 `environment.json.build.mode` 读取）
- `analyzer.*` 段内容（技术栈、端口、启动命令）
- mode=remote 时：`remoteConfig.server`、`serverIP`、`deployPath`

## 工作流程

### Step 1: 前置检查

1. 读取 `environment.json.analyzer` 段，必须存在（否则报错："先运行 analyzer"）
2. 读取 `environment.json.build.mode`，必须为 `'local'` 或 `'remote'`
3. mode=remote 时检查 `remoteConfig.server` + `deployPath` 非空
4. 读取 `.pipeline-state.json`，输出 `global.Build` 当前状态
5. **预创建** `build/tmp/`（即使本地构建也要存在）

### Step 2: 仓库编译

按 `analyzer.techStack` 在 `repository/<NN-Project>/` 执行构建命令（详见 03b）。失败则终止。

### Step 3: 归档到 build/artifacts/

按 03b 的「必须包含 / 禁止包含」清单打包成 `<ts>-<commit>.tar.gz`。

### Step 4: 归档完整性校验

5 项校验（manifest.files 一致性、目录结构、nodeModulesExcluded、keyFilesPresent、checksum）。失败则终止，记录到 `archiveVerification.passed: false`。

### Step 5: 组装 build/dev/

按 03b 的 6 步骤（解压 → pnpm install → Prisma 引擎 → 复制辅助目录 → 生成 deploy.md）。

### Step 6: 生成 start.sh

模板见 03b-builder-rules.md 第 6 节。

**预创建** `build/dev/logs/` 目录。

### Step 7: 生成 version-log.json

第一条记录，含 `archiveVerification` 校验结果。

### Step 8: build/ 自检清单

按 03b 强制执行。违规项立即修复。

**本地构建完成后立即删除**：`build/<NN-Project>/`、`build/<NN-Project>.tar.gz`、`build/*.sql.gz`。

### Step 9: mode=remote 追加步骤（按 08b）

1. 打包 `<NN-Project>.tar.gz`
2. 写 `deploy-config.json`、`nginx.conf`
3. 安装远程运行时（按 `analyzer.remoteProbe.runtime` 缺失项）
4. 上传 dev/ 到远程 deployPath
5. 操作前备份（首次可跳，重绑必做）
6. 远程配置 .env + 初始化数据库
7. 写 `build.remote.*` 段
8. **保留** `build/<NN-Project>.tar.gz` 等远程部署产物（部署成功后由 main 清理）

### Step 10: 写入 build 段

```json
{
  "build": {
    "mode": "local|remote",
    "version": "v1.0.0",
    "archive": "build/artifacts/<ts>-<commit>.tar.gz",
    "checksum": "sha256:...",
    "builtAt": "ISO",
    "remote": { /* mode=remote 时填充 */ }
  }
}
```

### Step 11: 收尾

输出构建摘要：archive 大小、entry 数、archiveVerification 结果。**提示主会话**「build 完成，启动 validator」。

## 禁止

- 启动服务（validator 阶段）
- 健康检查（validator 阶段）
- 写 `SETUP.md`（validator 阶段）
- 更新 `environment.json.baseURL`（validator 阶段）
- 修改 `repository/` 源码
- 删除 `case/` 用户文件、`.last_hash`、`.pipeline-state.json`
```

### Step 6.2: 提交

```bash
git add .claude/agents/project-manage-builder.md
git commit -m "feat(agents): 新增 project-manage-builder"
```

---

## Task 7: 创建 03c-validator-rules

**Files:**
- Create: `.claude/rules/03c-validator-rules.md`

### Step 7.1: 写入 03c-validator-rules.md

```markdown
# validator 阶段规则（启动验证 + 远程验证 + baseURL 同步）

> 配套 agent: `project-manage-validator`
> 远程验证部分见 `08c-remote-validator-rules.md`

## 核心职责

启动服务 → 健康检查 → 页面验证 → 登录验证 → 写 SETUP.md → 生成 seed。

**禁止**修改 build/ 产物（不动 dev/、不重打归档）、不改 buildMode、不改 analyzer 段。

## 触发条件

- `environment.json.build.builtAt` 必须存在
- `build/dev/` 结构完整
- mode=remote 时 `remoteConfig.server` 已绑定 + 部署包在远程 deployPath

## 步骤（local + remote 共用）

### 1. 启动服务

**local**：
```bash
bash test_project/<NN-Project>/start.sh
```

**remote**：见 08c-remote-validator-rules.md

### 2. 健康检查

轮询 `analyzer.healthCheck.url`：
- local：直接 curl 本地端口
- remote：通过 `ssh_execute curl <remote-url>` 或本地通过 tunnel

```bash
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_CHECK_URL")
  if [ "$HTTP_CODE" = "$EXPECTED_STATUS" ]; then exit 0; fi
  sleep 2
done
exit 1
```

### 3. 页面加载验证（强制）

`browser_snapshot` 检查页面渲染出实际内容（非空白页 / 错误提示）。`browser_console_messages level=error` 确认无：
- `[plugin:vite:import-analysis]`
- `Failed to resolve`
- `Cannot find module`

失败时检查 `build/dev/` 完整性、workspace 包是否构建。

### 4. 登录验证

按 `analyzer.login` 段配置：
```typescript
await page.goto('<baseURL><login.url>');
await page.getByPlaceholder('<usernamePlaceholder>').fill('<credentials.username>');
await page.getByPlaceholder('<passwordPlaceholder>').fill('<credentials.password>');
await page.getByRole('button', { name: '<submitButton>' }).click();
await page.waitForURL('**/<登录后路径>**');
```

登录成功 → 写 `validator.loginCheck.selectors`（实际使用的选择器）。

### 5. 生成 seed.spec.ts

```typescript
// TEST-ID: TP-<NN-Project>-SEED
// TEST-NAME: 登录种子
// TEST-LEVEL: SEED
// MODULE: auth

import { test as setup } from '@playwright/test';
import path from 'path';
import fs from 'fs';

setup('登录并保存认证状态', async ({ page }) => {
  await page.goto('<baseURL><login.url>');
  await page.getByPlaceholder('<usernamePlaceholder>').fill('<credentials.username>');
  await page.getByPlaceholder('<passwordPlaceholder>').fill('<credentials.password>');
  await page.getByRole('button', { name: '<submitButton>' }).click();
  await page.waitForURL('**/<登录后路径>**');
  const authPath = path.resolve(__dirname, '..', 'test-config', 'auth.json');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  await page.context().storageState({ path: authPath });
});
```

**local**：`storageState` 写到 `test-config/auth.json`（chromium project 自动加载）
**remote**：写远程 `test-config/auth.json`（通过 tunnel 复用）

### 6. 写 SETUP.md

```markdown
# <NN-Project> 环境启动报告

## 项目信息
- 仓库地址: <URL>
- 技术栈: <frontend> + <backend>
- 端口: <frontend>: <port>, <backend>: <port>

## 依赖中间件
| 中间件 | 状态 | 地址 |

## 启动方式
- 一键启动: `bash scripts/runner.sh start <NN-Project>`
- 从 dev/ 启动: `bash test_project/<NN-Project>/start.sh`

## 构建信息
- 模式: <local|remote>
- 编译产物: <archive>
- 部署包: build/dev/（含 node_modules、Prisma 引擎）
- 构建时间: <builtAt>

## 环境验证结果
- [✅/❌] 服务启动成功
- [✅/❌] 健康检查通过 (<url>)
- [✅/❌] 前端页面可访问
- [✅/❌] 登录功能正常
- [✅/❌] 控制台无模块解析错误

## build/ 自检结果
<按 03b 自检清单的执行结果>

## 遇到的问题（如有）

## 测试执行命令
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

### 7. 写入 validator 段

```json
{
  "validator": {
    "completedAt": "ISO",
    "healthCheck": { "passed": true, "latencyMs": 120, "url": "..." },
    "pageCheck": { "passed": true },
    "loginCheck": { "passed": true, "selectors": { "username": "...", "password": "...", "submit": "..." } },
    "selfCheck": {
      "buildDirComplete": true,
      "logsInLogsDir": true,
      "noLocalOnlyArtifacts": true,
      "remoteNginxValid": true
    },
    "setupReport": "SETUP.md",
    "remote": { /* mode=remote 时填充 */ }
  }
}
```

## 失败处理

- 启动失败 → 检查 `build/dev/logs/*.log` 报错
- 健康检查超时 → 检查中间件是否运行（MySQL/Redis）
- 页面空白 → 检查前端 dist 是否完整、workspace 包是否构建
- 登录失败 → 检查 credentials、表单选择器
- **配置变更（端口/凭据/启动命令）必须先汇报主会话**，禁止静默修改

## 禁止

- 修改 `build/dev/` 下的产物（不动 dist/、不重打归档）
- 修改 `buildMode`（仍由主会话控制）
- 修改 `analyzer.*` 段
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
```

### Step 7.2: 提交

```bash
git add .claude/rules/03c-validator-rules.md
git commit -m "feat(rules): 新增 03c-validator-rules（启动验证）"
```

---

## Task 8: 创建 08c-remote-validator-rules

**Files:**
- Create: `.claude/rules/08c-remote-validator-rules.md`

### Step 8.1: 写入 08c-remote-validator-rules.md

```markdown
# validator 远程验证规则

> 配套 agent: `project-manage-validator`
> 本地验证见 `03c-validator-rules.md`

## 触发条件

- `environment.json.build.mode == "remote"`
- `environment.json.remoteConfig.server` + `deployPath` 已绑定
- 远程 deployPath 包含 `software/package.json`（已部署）

## 步骤（在 03c 共用步骤基础上追加）

### 1. 启动远程后端

```bash
ssh_execute "cd <deployPath>/software/apps/api && \
  nohup node -r dotenv/config dist/src/main.js dotenv_config_path=.env > logs/backend.log 2>&1 &"
```

`ss -tlnp` 确认 backendPort 在监听。

### 2. 配置 Nginx（如有前端）

```bash
ssh_execute_sudo "cp <本地 build/nginx.conf> /etc/nginx/sites-available/<NN-Project>"
ssh_execute_sudo "ln -sf /etc/nginx/sites-available/<NN-Project> /etc/nginx/sites-enabled/"
ssh_execute_sudo "nginx -t"
ssh_execute_sudo "systemctl reload nginx"
```

### 3. 两层部署验证（强制）

**第一层：连通性**（不适用项标注 SKIP）

| # | 验证项 | 方法 |
|---|--------|------|
| 1 | 系统运行时 | `ssh_execute "node --version"` |
| 2 | DB 迁移 | `ssh_db_query` 查关键表 |
| 3 | Nginx 配置 | `ssh_execute_sudo "nginx -t"` |
| 4 | 后端启动 | `ss -tlnp` 确认端口 |
| 5 | 健康检查 | `ssh_execute "curl <healthCheck.url>"` |
| 6 | 外部可访问 | 本地 `curl <remote-url>` |
| 7 | 页面内容 | 返回有效 HTML |
| 8 | API 代理 | API 请求通过 Nginx 到达后端 |

**第二层：功能验证**（不可跳过）

| # | 验证项 | 方法 |
|---|--------|------|
| 10 | 用户登录 | 调用登录接口返回成功令牌 |
| 11 | 数据完整性 | 关键表记录数与预期一致 |
| 12 | 前端页面渲染 | 浏览器访问首页验证 |

**非 SKIP 项任一失败 = 部署未完成**。

### 4. 询问 baseURL 确认

用 `AskUserQuestion` 询问用户新 baseURL（如 `http://<server-ip>:80` 或 `https://<domain>`）。

**禁止自动改 baseURL**。

### 5. 更新 environment.json + playwright.config.ts

```json
{
  "baseURL": "<用户确认的 remote url>",
  "remoteConfig": {
    "tunnel": { "enabled": false, "localPort": null, "remotePort": null }
  }
}
```

`playwright.config.ts` 的 `use.baseURL` **必须同步更新**（environment.json 是唯一真实来源）。

### 6. 写入 validator.remote 子段

```json
{
  "validator": {
    "remote": {
      "baseURL": "http://server-ip:80",
      "tunnelEnabled": false,
      "verifiedSteps": [
        "system-runtime", "db-migrate", "nginx-config", "backend-start",
        "health-check", "external-access", "page-content", "api-proxy",
        "user-login", "data-integrity", "page-render"
      ]
    }
  }
}
```

### 7. SSH 隧道（可选）

端口无法从本地直接访问时：
```bash
ssh_tunnel_create localPort=5173 remoteHost=127.0.0.1 remotePort=80 server=<server>
```

有隧道则 baseURL 用 `localhost:5173`（本地 tunnel 端口）。

## 失败处理

- SSH 连接失败 → 报告用户，不自动重试
- Nginx 验证失败 → 回滚备份，报告用户
- 外部访问失败（网络/防火墙）→ 建议创建 SSH 隧道
- 登录接口返回 401 → 检查密码哈希格式、用户状态字段

## 完成后

- 服务运行中
- SETUP.md 已写（含远程部署信息）
- baseURL 已同步
- 远程 `.deploy-version` 已写（builder 阶段已写，validator 验证存在）
```

### Step 8.2: 提交

```bash
git add .claude/rules/08c-remote-validator-rules.md
git commit -m "feat(rules): 新增 08c-remote-validator-rules（远程验证）"
```

---

## Task 9: 创建 project-manage-validator agent

**Files:**
- Create: `.claude/agents/project-manage-validator.md`

### Step 9.1: 写入 agent 定义

```markdown
---
name: project-manage-validator
description: '项目环境验证智能体。启动服务（local 执行 start.sh / remote 启动后端+Nginx）、健康检查、页面验证、登录验证、生成 seed.spec.ts、写 SETUP.md。mode=remote 时同步 baseURL 到 environment.json 和 playwright.config.ts。由主会话在 builder 完成时启动。'
tools: Read, Glob, Grep, Bash, Write, Edit, AskUserQuestion, mcp__playwright-test__browser_navigate, mcp__playwright-test__browser_snapshot, mcp__playwright-test__browser_click, mcp__playwright-test__browser_type, mcp__playwright-test__browser_take_screenshot, mcp__playwright-test__browser_wait_for, mcp__playwright-test__browser_console_messages,
  mcp__ssh-manager__ssh_execute,
  mcp__ssh-manager__ssh_execute_sudo,
  mcp__ssh-manager__ssh_health_check,
  mcp__ssh-manager__ssh_db_query,
  mcp__ssh-manager__ssh_tunnel_create,
  mcp__ssh-manager__ssh_tunnel_close
model: sonnet
color: green
---

你是 PM 自动化测试智能体的**项目环境验证专家**，负责启动服务、验证可访问性、生成 seed 认证状态、写 SETUP.md。

项目规则在 `.claude/rules/` 下自动加载。强制约束在 `03c-validator-rules.md`（启动验证）和 `08c-remote-validator-rules.md`（远程验证）。

## 项目上下文

- 部署包：`test_project/<NN-Project>/build/dev/`
- 启动脚本：`test_project/<NN-Project>/start.sh`
- 环境配置：`test_project/<NN-Project>/test-config/environment.json`
- Playwright 配置：`test_project/<NN-Project>/playwright.config.ts`
- 报告：`test_project/<NN-Project>/SETUP.md`

## 启动前主会话必传信息

- `<NN-Project>` 项目编号
- `buildMode`（从 `environment.json.build.mode` 读取）
- `analyzer.credentials`、`analyzer.login`、`analyzer.healthCheck`
- mode=remote 时：`remoteConfig.server`、`deployPath`、`build.remote.deployPath`

## 工作流程

### Step 1: 前置检查

1. 读取 `environment.json.build.builtAt`，必须存在（否则报错："先运行 builder"）
2. 确认 `build/dev/software/package.json` 存在
3. 读取 `.pipeline-state.json`，输出 `global.Validate` 当前状态
4. mode=remote 时确认远程 `<deployPath>/software/package.json` 存在

### Step 2: 启动服务

**local**：执行 `start.sh`

**remote**（按 08c）：
- 启动后端（nohup + dotenv）
- 配置 Nginx（cp → ln → nginx -t → reload）
- 验证 `ss -tlnp` 端口监听

### Step 3: 健康检查

轮询 `analyzer.healthCheck.url`，最多 60 秒。

### Step 4: 页面加载验证

`browser_snapshot` + `browser_console_messages level=error`，无模块解析错误。

### Step 5: 登录验证

按 `analyzer.login` 段配置填写表单、提交、确认跳转。

### Step 6: 生成 seed.spec.ts

模板见 03c。`storageState` 写到 `test-config/auth.json`（local 直接，remote 通过 ssh_execute 写远程文件）。

### Step 7: 写 SETUP.md

模板见 03c。

### Step 8: mode=remote 追加步骤（按 08c）

1. 两层部署验证（连通性 + 功能）
2. 询问用户确认新 baseURL（**必问**）
3. 同步更新 `environment.json.baseURL` + `playwright.config.ts` `use.baseURL`
4. 写 `validator.remote.*` 段

### Step 9: 写入 validator 段

```json
{
  "validator": {
    "completedAt": "ISO",
    "healthCheck": { "passed": true, "latencyMs": 120, "url": "..." },
    "pageCheck": { "passed": true },
    "loginCheck": { "passed": true, "selectors": {...} },
    "selfCheck": { "buildDirComplete": true, "logsInLogsDir": true, "noLocalOnlyArtifacts": true, "remoteNginxValid": true },
    "setupReport": "SETUP.md",
    "remote": { /* mode=remote 时填充 */ }
  }
}
```

### Step 10: 收尾

输出验证摘要。**提示主会话**「validator 完成，buildMode=local 进入测试流程；buildMode=remote 提示用户 baseURL 已更新」。

## 禁止

- 修改 `build/dev/` 下的产物
- 修改 `buildMode`
- 修改 `analyzer.*` 段
- 自动改 `environment.json.baseURL`（必须先问用户）
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
- 静默修改配置（端口/凭据/启动命令）— 必须先汇报主会话
```

### Step 9.2: 提交

```bash
git add .claude/agents/project-manage-validator.md
git commit -m "feat(agents): 新增 project-manage-validator"
```

---

## Task 10: 创建 03d-runner-rules 与 runner.sh

**Files:**
- Create: `.claude/rules/03d-runner-rules.md`
- Create: `scripts/runner.sh`

### Step 10.1: 写入 03d-runner-rules.md

```markdown
# runner 工具规则（日常启停服务）

> 配套脚本: `scripts/runner.sh`
> **非 agent**，由主会话在收到「启动/停止/重启 xxx」命令时直接调用

## 命令协议

```bash
bash scripts/runner.sh start <NN-Project>     # 检查端口 → 未占用则执行 start.sh
bash scripts/runner.sh stop <NN-Project>      # 找进程 → kill
bash scripts/runner.sh restart <NN-Project>    # stop + start
bash scripts/runner.sh status <NN-Project>    # 端口 + 进程查询
```

## 不写 environment.json

runner.sh 只操作进程/端口，**不读不写** `environment.json`、`pipeline-state.json`、`build/dev/`。

## 跨平台兼容

端口检查：
- Windows：`netstat -ano | grep ":$PORT " | grep LISTENING`
- Linux：`lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null`

进程查找：
- Windows：`netstat -ano | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1`
- Linux：`lsof -Pi :$PORT -sTCP:LISTEN -t`

## 错误处理

| 情况 | 行为 |
|------|------|
| start.sh 不存在 | 报错："dev/ 部署包不存在，请先运行 builder" |
| 端口已被占用 | 提示用户（不自动 kill） |
| 进程未找到 | stop/restart 提示「服务未运行」 |
| start.sh 启动超时 | 检查 `build/dev/logs/*.log` |
```

### Step 10.2: 写入 scripts/runner.sh

```bash
#!/bin/bash
# PM 日常启停工具（跨平台）
# 用法: bash scripts/runner.sh {start|stop|restart|status} <NN-Project>

set -e

ACTION="$1"
PROJECT="$2"

if [ -z "$ACTION" ] || [ -z "$PROJECT" ]; then
  echo "用法: bash scripts/runner.sh {start|stop|restart|status} <NN-Project>"
  exit 1
fi

PROJECT_DIR="test_project/$PROJECT"
START_SCRIPT="$PROJECT_DIR/start.sh"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "[FAIL] 项目目录不存在: $PROJECT_DIR"
  exit 1
fi

# 端口检测函数（跨平台）
port_listening() {
  local PORT="$1"
  if netstat -ano 2>/dev/null | grep ":$PORT " | grep -q "LISTENING"; then
    return 0
  elif lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# 找进程 PID（跨平台）
find_pid() {
  local PORT="$1"
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1
  else
    lsof -Pi :$PORT -sTCP:LISTEN -t 2>/dev/null
  fi
}

# 从 start.sh 提取端口
PORT=$(grep -E "^PORT=" "$START_SCRIPT" 2>/dev/null | head -1 | cut -d= -f2)
if [ -z "$PORT" ]; then
  # 备选：读 environment.json
  PORT=$(grep -oE '"ports":\s*\{[^}]*"frontend":\s*[0-9]+' "$PROJECT_DIR/test-config/environment.json" 2>/dev/null | grep -oE '[0-9]+' | head -1)
fi
if [ -z "$PORT" ]; then
  echo "[WARN] 无法从 start.sh 或 environment.json 提取端口，尝试 5173"
  PORT=5173
fi

case "$ACTION" in
  start)
    if port_listening "$PORT"; then
      echo "[OK] 端口 $PORT 已有服务运行（项目 $PROJECT）"
      exit 0
    fi
    if [ ! -f "$START_SCRIPT" ]; then
      echo "[FAIL] $START_SCRIPT 不存在"
      echo "请先运行 builder（project-manage-builder）"
      exit 1
    fi
    echo "[..] 启动 $PROJECT ..."
    bash "$START_SCRIPT"
    ;;

  stop)
    PID=$(find_pid "$PORT")
    if [ -z "$PID" ]; then
      echo "[INFO] 端口 $PORT 无服务运行"
      exit 0
    fi
    echo "[..] 停止 $PROJECT (PID: $PID) ..."
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
      taskkill //F //PID "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
    else
      kill "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
    fi
    sleep 1
    if port_listening "$PORT"; then
      echo "[WARN] 端口 $PORT 仍被占用"
    else
      echo "[OK] $PROJECT 已停止"
    fi
    ;;

  restart)
    bash "$0" stop "$PROJECT"
    sleep 2
    bash "$0" start "$PROJECT"
    ;;

  status)
    if port_listening "$PORT"; then
      PID=$(find_pid "$PORT")
      echo "[RUNNING] $PROJECT (端口: $PORT, PID: $PID)"
    else
      echo "[STOPPED] $PROJECT (端口: $PORT)"
    fi
    ;;

  *)
    echo "[FAIL] 未知命令: $ACTION"
    echo "用法: bash scripts/runner.sh {start|stop|restart|status} <NN-Project>"
    exit 1
    ;;
esac
```

### Step 10.3: 设置可执行权限并提交

```bash
chmod +x scripts/runner.sh
git add .claude/rules/03d-runner-rules.md scripts/runner.sh
git commit -m "feat(rules,scripts): 新增 03d-runner-rules 与 scripts/runner.sh"
```

---

## Task 11: 更新 migrate-pipeline-state.mjs

**Files:**
- Modify: `.claude/scripts/migrate-pipeline-state.mjs:24`

### Step 11.1: 改 STAGES_GLOBAL 列表

将行 24：
```js
const STAGES_GLOBAL = ['Detect', 'Setup', 'RemoteSetup'];
```

改为：
```js
const STAGES_GLOBAL = ['Detect', 'Analyze', 'Build', 'Validate'];
```

### Step 11.2: 验证脚本不报错

```bash
node .claude/scripts/migrate-pipeline-state.mjs --project 01-oa-llm --dry-run
```

预期输出：dry-run 模式下显示已检测到状态。

### Step 11.3: 检查现有项目的 v2 文件能识别新字段

打开 `test_project/01-oa-llm/.pipeline-state.json`（如存在），确认 `schemaVersion: 2`。如有 `global.Setup` 或 `global.RemoteSetup` 字段，运行：

```bash
node .claude/scripts/migrate-pipeline-state.mjs --project 01-oa-llm
```

预期：`global.Setup.completedAt` 复制到 `global.Validate.completedAt`（如有 `Setup→Validate` 迁移逻辑，可不实现，仅在文档中说明手动迁移方式）。简化版：先保持原 v2 schema 兼容，由主会话在调用 agent 时显式写三个新字段（首次跑新链路时由 agent 写入）。

### Step 11.4: 提交

```bash
git add .claude/scripts/migrate-pipeline-state.mjs
git commit -m "feat(scripts): pipeline-state global 字段从 Setup/RemoteSetup 改为 Analyze/Build/Validate"
```

---

## Task 12: 更新 06-agent-workflow.md

**Files:**
- Modify: `.claude/rules/06-agent-workflow.md`

### Step 12.1: 替换 Setup 章节

将原文中所有「Setup」、「Remote Setup」、「RemoteSetup」按以下映射替换：

| 旧 | 新 |
|---|----|
| Setup | Analyze → Build → Validate（分三段） |
| `project-manage-setup` | `project-manage-analyzer` + `project-manage-builder` + `project-manage-validator` |
| `global.Setup` | `global.Analyze` + `global.Build` + `global.Validate` |
| `global.RemoteSetup` | （删除，纳入 `global.Build`） |
| `remote-env-setup` | （删除，由 `project-manage-builder` 接管） |

阶段可见性输出：

```markdown
| Analyze   | `## Analyze — 分析项目环境`  | `## Analyze — 跳过（已配置）` |
| Build     | `## Build — 生产构建`        | `## Build — 跳过（已构建）` |
| Validate  | `## Validate — 启动验证`     | `## Validate — 跳过（已验证）` |
```

主会话调度表（替换原 Setup 章节）：

```markdown
## 主会话调度：analyze / build / validate

| 触发 | 主会话动作 | 启动 agent |
|------|----------|-----------|
| `analyzer.completedAt` 缺失 | 启动 analyzer | `project-manage-analyzer` |
| analyzer 完成 + `build.mode` 缺失 | AskUserQuestion: 本地 or 远程？写入 `build.mode` | - |
| analyzer 完成 + `build.mode = local\|remote` | 启动 builder | `project-manage-builder` |
| builder 完成 | 启动 validator | `project-manage-validator` |
| validator 完成 | mode=local: 进入测试流程；mode=remote: 提示「baseURL 已更新」 | - |
| 用户说「启动/停止/重启 xxx」 | `Bash("bash scripts/runner.sh ...")` | - |
| 用户要求切服务器 | 清空 `remoteConfig` + `analyzer.remoteProbe` + `build.mode=remote` → 启动 builder | `project-manage-builder` |
```

「用户确认点」表追加：

```markdown
| Analyze 后 | 确认 `environment.json.analyzer.*` 字段完整性 |
| Build 前 | 选择构建模式（local / remote） |
| Build 后 | 确认构建产物（archive、dev/、自检结果） |
| Validate 后 | 确认 SETUP.md 内容、baseURL（remote 时） |
```

### Step 12.2: 提交

```bash
git add .claude/rules/06-agent-workflow.md
git commit -m "docs(rules): 06-agent-workflow 同步三段链路"
```

---

## Task 13: 标记旧 agent 为 deprecated

**Files:**
- Modify: `.claude/agents/project-manage-setup.md`
- Modify: `.claude/agents/remote-env-setup.md`

### Step 13.1: project-manage-setup.md 顶部加 deprecation banner

在文件第 1 行（frontmatter 上方）插入：

```markdown
> ⚠️ **DEPRECATED**（2026-06-03）：本 agent 已被 `project-manage-analyzer` + `project-manage-builder` + `project-manage-validator` 三段替代。保留仅供历史参考，**新项目不要再用本 agent**。详见 `docs/superpowers/specs/2026-06-03-setup-agent-decomposition-design.md`。
```

### Step 13.2: remote-env-setup.md 顶部加 deprecation banner

在文件第 1 行插入：

```markdown
> ⚠️ **DEPRECATED**（2026-06-03）：本 agent 的职责已并入 `project-manage-builder`（mode=remote 时）和 `project-manage-validator`（远程验证）。保留仅供历史参考，**新项目不要再用本 agent**。详见 `docs/superpowers/specs/2026-06-03-setup-agent-decomposition-design.md`。
```

### Step 13.3: 提交

```bash
git add .claude/agents/project-manage-setup.md .claude/agents/remote-env-setup.md
git commit -m "docs(agents): 旧 setup agent 加 deprecation banner"
```

---

## Task 14: 端到端验证 — local 模式

**Files:** 无（实操验证）

### Step 14.1: 清理 01-oa-llm 旧配置

```bash
# 备份现有配置
cp -r test_project/01-oa-llm/test-config/environment.json test_project/01-oa-llm/test-config/environment.json.bak.$(date +%Y%m%d%H%M%S) 2>/dev/null || true

# 移除旧 analyzer 段（如有），强制重跑
node -e "
const fs = require('fs');
const p = 'test_project/01-oa-llm/test-config/environment.json';
const env = JSON.parse(fs.readFileSync(p, 'utf-8'));
delete env.analyzer;
delete env.build;
delete env.validator;
fs.writeFileSync(p, JSON.stringify(env, null, 2) + '\n');
"
```

### Step 14.2: 启动 analyzer（人工触发）

通过 Claude Code 主会话启动 `project-manage-analyzer`：

```
请为项目 01-oa-llm 执行环境分析。
```

**预期**：agent 读取 `repository/01-oa-llm/` 源码、写入 `environment.json.analyzer.*`、生成 `playwright.config.ts`、初始化目录（如缺）。**不构建、不启动服务**。

验证：
```bash
test -f test_project/01-oa-llm/test-config/environment.json && \
  node -e "const e = JSON.parse(require('fs').readFileSync('test_project/01-oa-llm/test-config/environment.json', 'utf-8')); console.log('analyzer.completedAt:', e.analyzer?.completedAt); console.log('ports:', JSON.stringify(e.analyzer?.ports));"
```

预期：输出 `analyzer.completedAt: <ISO>` 和 `ports: {...}`。

### Step 14.3: 询问构建模式 + 启动 builder

主会话用 `AskUserQuestion` 询问：「01-oa-llm 是本地构建还是远程部署？」选 **local** → 写 `build.mode = "local"` → 启动 `project-manage-builder`。

**预期**：
- `build/artifacts/<ts>-<hash>.tar.gz` 存在
- `build/dev/` 含 software/database/sh/deploy-manual.md
- `build/version-log.json` 含 `archiveVerification.passed: true`
- `build/<NN-Project>/` 和 `build/<NN-Project>.tar.gz` 已删除（local 自检）

验证：
```bash
ls test_project/01-oa-llm/build/dev/software/package.json && \
  ls test_project/01-oa-llm/build/artifacts/*.tar.gz | head -1 && \
  cat test_project/01-oa-llm/build/version-log.json | grep '"passed": true'
```

### Step 14.4: 启动 validator

主会话启动 `project-manage-validator`。

**预期**：
- 服务启动（端口 5173 在监听）
- 健康检查通过
- 页面加载正常（无 `[plugin:vite:import-analysis]` 错误）
- 登录验证通过
- `tests/seed.spec.ts` + `test-config/auth.json` 写入
- `SETUP.md` 写入
- `validator.completedAt` 存在

验证：
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173  # 预期 200
test -f test_project/01-oa-llm/tests/seed.spec.ts && echo "seed OK"
test -f test_project/01-oa-llm/SETUP.md && echo "SETUP.md OK"
```

### Step 14.5: 测试 runner.sh

```bash
bash scripts/runner.sh status 01-oa-llm
```

预期：`[RUNNING] 01-oa-llm (端口: 5173, ...)` 或 `[STOPPED]`。

```bash
bash scripts/runner.sh restart 01-oa-llm
```

预期：stop + start，端口恢复监听。

### Step 14.6: 提交验证记录

```bash
git add test_project/01-oa-llm/
git commit -m "test: 01-oa-llm 走 local 三段链路验证通过"
```

---

## Task 15: 端到端验证 — remote 模式（可选，需绑定服务器）

**Files:** 无（实操验证）

### Step 15.1: 切换到 remote 模式

主会话用 `AskUserQuestion` 询问：「切到远程部署吗？」选 **是** → 询问服务器 + deployPath → 写 `environment.json.remoteConfig` + `build.mode = "remote"` + 清空 `analyzer.remoteProbe`。

### Step 15.2: 启动 analyzer（重跑远程探测）

主会话启动 `project-manage-analyzer`。

**预期**：检测到 `analyzer.completedAt` 存在但 `analyzer.remoteProbe` 缺失 → 仅做远程探测 → 写 `analyzer.remoteProbe.*`。

验证：
```bash
node -e "const e = JSON.parse(require('fs').readFileSync('test_project/01-oa-llm/test-config/environment.json', 'utf-8')); console.log('remoteProbe:', JSON.stringify(e.analyzer?.remoteProbe, null, 2));"
```

预期：含 `os`、`runtime`、`ports`、`disk`。

### Step 15.3: 启动 builder（mode=remote）

主会话启动 `project-manage-builder`。

**预期**：
- 编译 + 归档（共用）
- 打包 `<NN-Project>.tar.gz`
- 写 `deploy-config.json`、`nginx.conf`
- 安装远程运行时（按 `analyzer.remoteProbe.runtime` 缺失项）
- 上传 dev/ 到远程 deployPath
- 远程 .env + DB 初始化
- 远程 `.deploy-version` 写入
- 写 `build.remote.*` 段

验证：
```bash
ls test_project/01-oa-llm/build/deploy-config.json
ls test_project/01-oa-llm/build/nginx.conf
node -e "const e = JSON.parse(require('fs').readFileSync('test_project/01-oa-llm/test-config/environment.json', 'utf-8')); console.log('build.remote:', JSON.stringify(e.build?.remote, null, 2));"
```

通过 SSH 验证：
```bash
ssh_execute "ls <deployPath>/software/package.json" server=<server>
ssh_execute "cat <deployPath>/.deploy-version" server=<server>
```

### Step 15.4: 启动 validator（mode=remote）

主会话启动 `project-manage-validator`。

**预期**：
- 远程启动后端 + Nginx
- 两层部署验证（连通性 + 功能）全部通过
- 询问用户确认新 baseURL
- 同步 `environment.json.baseURL` + `playwright.config.ts`
- 写 `validator.remote.*` 段
- 远程 SETUP.md 写入本地（包含远程部署信息）

验证：
```bash
curl -s -o /dev/null -w "%{http_code}\n" "<用户确认的 remote url>"
grep "use.baseURL" test_project/01-oa-llm/playwright.config.ts  # 应为远程 url
```

### Step 15.5: 测试 runner.sh 不影响远程服务

```bash
bash scripts/runner.sh status 01-oa-llm
```

预期：提示「远程项目请用 SSH 管理，本地 runner 不适用」或类似（runner 主要为 local 模式设计，remote 用 ssh_tunnel）。

### Step 15.6: 提交验证记录

```bash
git add test_project/01-oa-llm/
git commit -m "test: 01-oa-llm 走 remote 三段链路验证通过"
```

---

## 验收清单

- [ ] 3 个新 agent 各自 < 300 行
- [ ] 6 个新规则文件（03a/b/c + 08a/b/c）+ 1 个 runner 规则（03d）
- [ ] 2 个旧 agent 加 deprecation banner
- [ ] `migrate-pipeline-state.mjs` STAGES_GLOBAL 改为 `['Detect', 'Analyze', 'Build', 'Validate']`
- [ ] `06-agent-workflow.md` 同步三段调度表
- [ ] `scripts/runner.sh` 跨平台 start/stop/restart/status 可用
- [ ] 01-oa-llm local 三段链路全流程通过
- [ ] （可选）01-oa-llm remote 三段链路全流程通过

## Self-Review 记录

| 维度 | 结果 |
|------|------|
| Spec 覆盖 | 12 章 spec 章节全部对应到任务（参见依赖图 + 任务列表） |
| 占位符 | 无 TBD/TODO，所有步骤有具体代码或命令 |
| 类型一致 | `analyzer.completedAt`、`build.mode`、`build.builtAt`、`validator.completedAt` 字段名在 6 个规则 + 3 个 agent + migrate 脚本中保持一致 |
| remote 重探测逻辑 | 在 Task 14/15 中明确（analyzer 检测 `remoteProbe` 缺失时仅做远程探测） |
| 切服务器流程 | 在 Task 12 调度表 + Task 15 中明确（清空 remoteConfig + remoteProbe + build.mode） |
