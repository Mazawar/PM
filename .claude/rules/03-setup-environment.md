# 项目环境配置规则（DEPRECATED — 历史索引）

> **⚠️ 本文件已被 `03a-analyzer-rules.md` + `03b-builder-rules.md` + `03c-validator-rules.md` 拆分替代。**
> **Setup Agent（`project-manage-setup`）已于 2026-06-03 弃用，职责拆为 analyzer（源码分析）/ builder（生产构建+部署包组装）/ validator（启动验证）三段。**
> **本文件仅作历史索引保留，不再作为新流程的强制规则来源。**

---

本文件原定义 Setup Agent（`project-manage-setup`）的强制约束。Agent 定义（`.claude/agents/project-manage-setup.md`）已加 deprecation banner，新工作流按三段 agent 划分。

---

## 数据库初始化优先级（强制）

识别项目使用的 ORM/映射工具及对应文件位置：

- Java: MyBatis (`*Mapper.xml`)、JPA/Hibernate (`@Entity`、`spring.jpa.hibernate.ddl-auto`)、Flyway (`db/migration/`)
- Node.js: Prisma (`schema.prisma`)、TypeORM (`*.entity.ts`)、Sequelize (`models/`)
- Python: SQLAlchemy (`models.py`)、Django (`migrations/`)
- 通用: SQL 脚本文件 (`.sql`)

初始化方式按以下优先级选择：

1. **完整 SQL dump 文件优先** — 仓库中有数据库导出文件（`.sql`，通常几十 MB 到几百 MB），这是最完整的数据源，必须优先导入
2. ORM schema 同步 + seed 脚本 — 仅在没有 SQL dump 时使用
3. **禁止用 ORM 建空表 + 手动插几条数据就认为数据库初始化完成** — 存在完整 SQL dump 时必须导入全量数据

SQL dump 导入注意事项：指定 `--default-character-set=utf8mb4` 防止中文乱码。

### 版本化 SQL 初始化流程（强制）

仓库中存在 `version/` 目录且包含版本子目录时，应按**版本号升序**逐一执行：

```
初始化顺序：
1. <全量 SQL dump>.sql              — 初始结构 + 全量数据
2. version/v0.0.1/sql/migrate_*.sql  — v0.0.1 变更
3. version/v0.0.2/sql/migrate_*.sql  — v0.0.2 变更
4. version/v0.0.2/sql/seed_*.sql     — v0.0.2 种子数据（放在该版本 migrate 之后）
...
```

执行规则：
- **全量 SQL dump 必须最先执行**（创建数据库结构和初始数据）
- 版本迁移按目录名排序（`v0.0.1` → `v0.0.2` → ...），不能跳过中间版本
- 每个版本内先执行 `migrate_*.sql`，再执行 `seed_*.sql`（如有）
- analyzer agent 在 `environment.json` 的 `dbConfig.initFiles` 中如实列出**全部** SQL 文件（全量 dump + 各版本 migrate + seed），按执行顺序排列
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

## 构建依赖分析（强制）

- 分析项目的完整构建链：从源码到可运行状态需要哪些构建步骤
- 识别所有需要在启动前完成的预编译/构建步骤（不只是主应用，也包括子模块、共享包、类型定义等）
- 确定构建顺序（按依赖拓扑排列）
- **在启动任何服务前，必须先完成所有必要的构建步骤**
- 构建产出的目标目录为 `build/dev/software/`，后续启动服务从该目录进行，非仓库原始路径

## 构建顺序（强制）

三段 agent 的步骤顺序（analyzer → builder → validator）：
1. analyzer 分析源码 → 推断配置 → 写 `environment.json.analyzer.*` 段
2. **builder 构建生产包**（在 `repository/` 中编译，组装到 `build/dev/`，按 buildMode 走 local/remote 分支）
3. validator 生成 `start.sh`（基于 `build/dev/software/`）→ 从 `build/dev/software/` 启动服务并验证

**禁止先启动再构建。必须先构建出 dev/，再从 dev/ 启动。**

## 端口推断优先级（强制）

1. `vite.config.ts` 中的 `server.port` → 前端端口
2. `.env` / `.env.development` 中的 `PORT` / `VITE_PORT` / `SERVER_PORT`
3. `package.json` scripts 中的 `--port` 参数
4. `vue.config.js` / `next.config.js` / `nuxt.config.ts` 中的端口配置
5. Java 项目 `application.yml` / `application.properties` 的 `server.port`
6. 以上都推断不出 → 询问用户

## 凭据推断

- 检查仓库中的 `README.md`、`docs/`、`.env.example` 是否有默认账号
- 检查是否有 seed 数据或测试账号配置
- 推断不出 → 询问用户（**用户也不知道则跳过，测试时再提供**）

## 中间件推断

- 从 `docker-compose.yml`、`package.json` dependencies、配置文件中识别所需中间件
- 自动推断，不询问用户

## 脚本验证（强制）

**在进入服务启动阶段之前，必须验证 start.sh 能否正常执行。**

1. **语法检查** — `bash -n test_project/<NN-Project>/start.sh`，确保无语法错误
2. **试运行** — `bash test_project/<NN-Project>/start.sh`，观察输出：
   - 端口检测逻辑是否正确识别当前状态（已运行 / 未运行）
   - 健康检查是否能正常完成
   - 脚本是否因命令不存在（如 Windows 下 `lsof`）而报错
3. **修复脚本问题** — 试运行暴露问题时立即修复：
   - Windows 环境：用 `netstat -ano | grep ":$PORT " | grep LISTENING` 替代 `lsof`
   - 工作目录问题：备选启动路径使用绝对路径或正确恢复工作目录
   - 后台进程管理：确保 `&` 在当前 shell 环境下正确工作
4. **重新验证** — 修复后再次试运行，直到脚本无错误执行完成

**前提条件**：运行 start.sh 前必须先完成构建（Step 4），确保 `build/dev/software/` 存在且包含已编译的产物和 node_modules。start.sh 指向的是 `build/dev/software/`，非 `repository/<NN-Project>/`。

**不允许在 start.sh 未通过试运行验证的情况下启动服务。**

## 页面加载验证（强制）

HTTP 200 不代表页面正常，必须确认：

1. 用 `browser_snapshot` 检查页面是否渲染出实际内容（不是空白页或错误提示）
2. 用 `browser_console_messages`（level=error）确认无模块解析失败、JS 运行时错误
3. **必须检查**无以下控制台错误：
   - `[plugin:vite:import-analysis]`
   - `Failed to resolve`
   - `Cannot find module`
4. 页面加载失败或控制台有模块解析错误时：
   - **检查 `build/dev/` 是否完整** — 确认 `build/dev/software/` 下存在编译产物和 node_modules
   - **优先检查 workspace 包是否已构建** — monorepo 中最常见原因是共享包未编译
   - 检查前端是否正确启动
   - 检查代理/端口配置是否正确

## 问题处理策略（强制）

### 必须向用户汇报，等待指示

- **端口冲突** → 汇报冲突端口和占用情况，由用户决定换端口或关闭占用进程
- **中间件未运行** → 汇报缺少哪些中间件，由用户确认启动方式
- **配置推断与实际不符** → 汇报推断值和实际值的差异，由用户确认正确配置
- **启动命令失败** → 汇报错误日志，由用户确认正确的启动方式
- **需要修改已有配置文件** → 汇报修改内容和原因，由用户确认后再修改
- **数据库连接失败** → 汇报连接参数和错误信息，由用户提供正确的连接信息

### 可以自动处理（无需汇报）

- **依赖缺失** → 自动安装（`pnpm install`、`npm install` 等）
- **数据库未迁移** → 自动执行迁移命令（前提是连接信息正确）

**核心原则：凡涉及配置变更（端口、凭据、启动命令、环境变量），必须先汇报后执行。禁止静默修改配置后继续运行。**

## 任务完成条件（强制）

**以下条件全部满足才算完成，缺一不可：**

- 生产构建完成，`build/dev/` 部署包组装完毕（含 node_modules、编译产物）
- 服务已启动，健康检查通过
- 页面可访问，内容非空白
- 浏览器控制台无模块解析失败或 JS 运行时错误
- 登录功能正常（如有凭据）

**不允许在服务未运行或验证失败时结束任务。** 唯一例外：遇到 Agent 无法解决的根本性阻塞（如数据库未安装、操作系统不兼容），此时必须向用户报告具体原因并等待用户指示。

## 保护文件（强制）

- `test_project/<NN-Project>/.last_hash` — 变更追踪基准，禁止删除或清空
- `test_project/<NN-Project>/.pipeline-state.json` — 管线状态，禁止删除
- `test_project/<NN-Project>/case/` — 用户案例目录，禁止删除、清空或覆盖其中文件
- analyzer / builder / validator agent 创建目录时，若上述文件/目录已存在必须保留原内容

---

## 生产构建与部署包组装（强制）

本部分原定义 Setup Agent 在 Step 4（构建生产部署包）中的操作规则。**现迁移到 `03b-builder-rules.md`。**

### 生产编译

- 根据 `techStack` 和 `startCommand` 将 dev 命令转为 build 命令（如 `pnpm dev` → `pnpm build`）
- 在 `repository/<NN-Project>/` 下执行
- 构建失败则终止，不在远程修复
- monorepo 项目注意 workspace 包编译顺序

### 归档内容规范

归档到 `build/artifacts/<timestamp>-<commit>.tar.gz`：

- **必须包含**：前端编译产物（web/dist/ 等）、后端编译产物（api/dist/ 等）、依赖声明文件（package.json, pnpm-lock.yaml）、ORM schema/迁移文件（prisma/ 等）、.env 模板（.env.development 等）、workspace 配置文件（pnpm-workspace.yaml）
- **禁止包含**：`node_modules/`、`version/`（版本变更记录）、`scripts/`/`sh/`（部署脚本）、静态数据文件（*.json 如 province.json）、进程管理配置（ecosystem.config.cjs）、README、文档、git 相关文件
- **原因**：辅助文件和脚本在组装 dev/ 时从仓库单独复制，归档只保存编译产物快照

### 归档完整性校验

归档完成后**必须**执行以下校验，任一失败则归档无效，禁止继续：

1. **manifest.files 一致性** — 遍历 manifest.json 的 files 对象，对每个声明的路径确认归档内存在该路径前缀且文件数 ≥ 1
2. **目录结构校验** — 归档内顶层目录必须与实际项目结构一致（如 api/、web/）
3. **checksum 写入** — 校验通过后计算 sha256 写入 manifest

校验结果记录到 `version-log.json` 的 `archiveVerification` 字段，`passed: false` 时禁止继续。

### 部署包组装规范

`build/dev/` 下组装完整的部署包：

1. **从归档解压**到 `dev/software/`（workspace 根目录）
2. **安装依赖**（hoisted 模式）：`pnpm install --config.node-linker=hoisted`
3. **Prisma 项目**：schema 添加 Linux 引擎目标 `binaryTargets = ["native", "debian-openssl-3.0.x"]`，`npx prisma generate`，验证双平台引擎文件
4. **复制辅助目录**：`database/`（全量 SQL + 版本变更 SQL，扁平结构如 `database/v0.1.0/`）
5. **生成 deploy.md**：环境配置表、目录结构、完整部署步骤
6. **打包**：`dev/` → `<NN-Project>/` → `<NN-Project>.tar.gz`

### 产出文件

| 文件 | 说明 |
|------|------|
| `build/artifacts/<timestamp>-<commit>.tar.gz` | 编译产物归档 |
| `build/artifacts/<timestamp>-<commit>.manifest.json` | 归档清单 |
| `build/dev/` | 完整部署包目录（含 node_modules） |
| `build/<NN-Project>.tar.gz` | 最终部署压缩包（仅远程部署） |
| `build/version-log.json` | 构建版本追踪（追加记录） |
| `build/dev/deploy.md` | 部署说明文档 |

## build/ 自检清单（builder agent 完成时强制执行）

builder agent 在完成构建（`build.builtAt` 写入前）之前**必须**逐项检查 build/ 目录，违规项立即修复。这是任务完成的硬性条件，未通过自检不得向主会话报告"Build 完成"。

### 必含项

- [ ] `build/dev/` 存在，含 `software/ database/ update_readme.md`
- [ ] `build/artifacts/<timestamp>-<commit>.tar.gz` 编译产物归档
- [ ] `build/artifacts/<timestamp>-<commit>.manifest.json` 含 files 列表
- [ ] `build/tmp/` 存在（可空）
- [ ] `build/version-log.json` 存在，含 `archiveVerification` 字段

### 必无项（按当前构建模式）

- [ ] `build/<NN-Project>/`（本地构建场景下不应存在）
- [ ] `build/<NN-Project>.tar.gz`（本地构建场景下不应存在）
- [ ] `build/pre-deploy-backup-*.sql.gz`（本地构建场景下不应存在）
- [ ] `build/deploy-config.json`（本地构建场景下不应存在）
- [ ] `build/nginx.conf`（本地构建场景下不应存在）
- [ ] `build/dev/software/**/*.log` 散落日志（必须在 `build/dev/logs/`）

### 自检执行命令

```bash
cd test_project/<NN-Project>

# 必含
[ -d build/dev ] && echo "[OK] build/dev/" || echo "[FAIL] build/dev 缺失"
[ -f build/version-log.json ] && echo "[OK] version-log.json" || echo "[FAIL] version-log.json 缺失"
[ -d build/tmp ] && echo "[OK] build/tmp/" || echo "[FAIL] build/tmp/ 缺失"

# 必无（本地构建）
for f in build/<NN-Project> build/<NN-Project>.tar.gz; do
  [ -e "$f" ] && echo "[FAIL] 不应存在: $f" || echo "[OK] 无 $f"
done
ls build/*.sql.gz 2>/dev/null && echo "[FAIL] 不应存在 *.sql.gz" || echo "[OK] 无 *.sql.gz"

# 日志散落检查
find build -name "*.log" -not -path "build/dev/logs/*" 2>/dev/null | head -5
```

## 日志输出规范（强化）

所有 `nohup ... &` 后台启动的进程，日志**必须**重定向到约定位置，**禁止**散落在项目根或 apps/ 子目录。

### 本地构建

- 日志位置：`build/dev/logs/<service>.log`（如 `backend.log` / `frontend.log`）
- 启动脚本（`start.sh`）必须**预创建** `build/dev/logs/` 目录
- 启动命令模板：`nohup <command> > build/dev/logs/<service>.log 2>&1 &`

### 远程部署

- 日志位置：`<deployPath>/logs/<service>.log`
- 见 `08-remote-deployment.md` 的「远程目录结构规范」

### 违规示例（已发生事故）

> 2026-06-03 在 01-oa-llm 项目中，`api.log` 和 `web.log` 散落在 `build/dev/software/apps/`，违反"日志统一"原则。本规则要求 builder agent 启动服务前**先创建 `build/dev/logs/` 目录**，再启动后台进程。

## version-log.json 自动创建（强制）

builder agent 完成构建后**必须**自动创建 `build/version-log.json`（即使只一条记录），含全量 `archiveVerification` 校验结果。

### 记录结构

```json
{
  "schema": "1.0",
  "project": "<NN-Project>",
  "records": [
    {
      "id": 1,
      "time": "<构建完成时间 ISO>",
      "commit": "<commitShortHash>",
      "source": "local-build" | "remote-deploy",
      "target": "local" | "<服务器名称>",
      "archive": "build/artifacts/<timestamp>-<commit>.tar.gz",
      "checksum": "sha256:xxx",
      "build": "成功" | "失败",
      "status": "deployed" | "completed",
      "archiveVerification": {
        "passed": true,
        "checkedAt": "<ISO>",
        "checksumMatches": true,
        "topLevelDirs": ["software", "database", "update_readme.md"],
        "nodeModulesExcluded": true,
        "keyFilesPresent": [
          "software/package.json",
          "software/apps/api/dist/src/main",
          "software/apps/web/dist/index.html",
          "database/keyidea_newoa.sql"
        ],
        "totalEntries": <N>,
        "size": "<X>M"
      }
    }
  ]
}
```

### 校验项

- `checksumMatches`：sha256 与 manifest.checksum 一致
- `nodeModulesExcluded`：tar.gz 内无 `node_modules/` 条目
- `keyFilesPresent`：关键文件（dist 产物、schema、SQL dump）存在
- `topLevelDirs`：顶层目录与预期一致

`archiveVerification.passed: false` → 禁止继续，必须重建归档。
