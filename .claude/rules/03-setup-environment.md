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
