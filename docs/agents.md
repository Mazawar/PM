# 项目 Agent 索引

> 最后更新：2026-06-04
> 配套规则文件：`.claude/rules/`

## 当前活跃 Agent

| Agent | 职责 | 配套规则 |
|-------|------|---------|
| `project-manage-analyzer` | 只读分析仓库源码、推断技术栈/端口/中间件/凭据、写入 `environment.json.analyzer` 段、生成 `playwright.config.ts`、初始化目录；远程探测在 `remoteConfig.server` 已绑定时执行 | `03-analyzer-rules.md` |
| `project-manage-builder`  | 按 `buildMode` 分支：local 编译+归档+组装 dev/；remote 在 local 基础上+打包+安装远程运行时+上传+配置 .env+初始化 DB | `04-builder-rules.md` |
| `project-manage-validator` | 启动服务（local 执行 start.sh / remote 启动后端+Nginx）、健康检查、页面验证、登录验证、生成 seed.spec.ts、写 SETUP.md；mode=remote 时同步 baseURL（附录：runner 工具） | `05-validator-rules.md` |
| `playwright-test-planner`  | 测试规划：读 case/ + 变更报告，生成测试计划，待用户多轮确认 | `06-planner-rules.md` |
| `playwright-test-generator` | 测试代码生成：直接生成（UI Map）/ 录制模式双模式 | `07-generator-rules.md` |
| `playwright-test-healer`   | 测试修复：3 次尝试，失败标 fixme，更新 progress/report/summary | `08-healer-rules.md` |
| `test-result-publisher`    | 测试报告打包 + 上传 Gitee Release | `01-pipeline-rules.md`（Publish 部分） |

## 三段链路：analyzer / builder / validator

```
[analyzer] → [builder] → [validator]
   ↓            ↓            ↓
 写入          写入          写入
analyzer.*   build.*      validator.*
 段          段            段
```

- **analyzer**：只读分析，**不构建、不启动**
- **builder**：按 `environment.json.build.mode`（`local` / `remote`）分支，**不启动服务**
- **validator**：启动服务、做健康/页面/登录验证、生成 seed，**不修改 build/ 产物**

状态交接载体：`test_project/<NN-Project>/test-config/environment.json` 的三段字段（`analyzer.*` / `build.*` / `validator.*`）。

## 工具脚本

所有脚本统一在 `.claude/scripts/` 下：

| 脚本 | 用途 |
|------|------|
| `runner.sh` | 日常启停服务（`start` / `stop` / `restart` / `status`） |
| `scan.sh`   | 仓库扫描（检测变更，生成 reports/） |
| `init-dirs.mjs` | 项目目录初始化（幂等） |
| `migrate-pipeline-state.mjs` | pipeline-state 迁移 + 读写（ESM） |
| `generate-report.mjs` | 解析 Playwright 报告生成 progress/report/summary |
| `notify.mjs` | 测试报告邮件通知 |

## 调度管线

测试执行管线（每模块串行）：

```
planner → generator → healer（按需）
```

环境配置管线（项目级）：

```
analyzer → [主会话问 buildMode] → builder (按 mode 分支) → validator
```

构建发布管线（Report 后）：

```
Report → [主会话问用户] → publisher → 上传 Gitee Release
```

## 主会话识别用户命令

| 用户说 | 主会话动作 |
|--------|-----------|
| 「启动/停止/重启 xxx」 | `bash .claude/scripts/runner.sh {start\|stop\|restart} <NN-Project>` |
| 「配置 xxx 项目」 | 启动 `project-manage-analyzer` |
| 「构建 xxx」 | 询问 buildMode → 启动 `project-manage-builder` |
| 「验证 xxx」 | 启动 `project-manage-validator` |
| 「部署到远程 xxx」 | 启动 analyzer（重探测）→ buildMode=remote → builder → validator |
| 「切服务器」 | 清空 remoteConfig + remoteProbe → 启动 builder |
