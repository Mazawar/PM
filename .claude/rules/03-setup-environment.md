# 项目环境配置规则

本文件定义 Setup Agent（`project-manage-setup`）的强制约束。Agent 定义（`.claude/agents/project-manage-setup.md`）声明工作流步骤和模板，本文件定义完整操作规则和约束。

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

## 构建依赖分析（强制）

- 分析项目的完整构建链：从源码到可运行状态需要哪些构建步骤
- 识别所有需要在启动前完成的预编译/构建步骤（不只是主应用，也包括子模块、共享包、类型定义等）
- 确定构建顺序（按依赖拓扑排列）
- **在启动任何服务前，必须先完成所有必要的构建步骤**
- 构建产出的目标目录为 `build/dev/software/`，后续启动服务从该目录进行，非仓库原始路径

## 构建顺序（强制）

Setup Agent 的步骤顺序为：
1. 分析源码 → 推断配置 → 生成环境配置
2. **构建生产包**（在 `repository/` 中编译，组装到 `build/dev/`）
3. 生成 `start.sh`（基于 `build/dev/software/`）
4. 从 `build/dev/software/` 启动服务并验证

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
- Setup Agent 创建目录时，若上述文件/目录已存在必须保留原内容

---

## 生产构建与部署包组装（强制）

本部分定义 Setup Agent 在 Step 4（构建生产部署包）中的操作规则。

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
4. **复制辅助目录**：`database/`（全量 SQL + 版本变更 SQL）、`sh/`（.sh 脚本）、文档（deploy-manual.md、update_readme.md）
5. **生成 deploy.md**：环境配置表、目录结构、完整部署步骤、凭据信息
6. **打包**：`dev/` → `<NN-Project>/` → `<NN-Project>.tar.gz`

### 产出文件

| 文件 | 说明 |
|------|------|
| `build/artifacts/<timestamp>-<commit>.tar.gz` | 编译产物归档 |
| `build/artifacts/<timestamp>-<commit>.manifest.json` | 归档清单 |
| `build/dev/` | 完整部署包目录（含 node_modules） |
| `build/<NN-Project>.tar.gz` | 最终部署压缩包 |
| `build/version-log.json` | 构建版本追踪（追加记录） |
| `build/dev/deploy.md` | 部署说明文档 |
