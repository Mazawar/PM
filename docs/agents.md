# 项目 Agent 索引

> 最后更新：2026-06-03
> 配套规则文件：`.claude/rules/`

## 当前活跃 Agent

| Agent | 行数 | 职责 | 配套规则 |
|-------|------|------|---------|
| `project-manage-analyzer` | 112 | 只读分析仓库源码、推断技术栈/端口/中间件/凭据、写入 `environment.json.analyzer` 段、生成 `playwright.config.ts`、初始化目录；远程探测在 `remoteConfig.server` 已绑定时执行 | `03a-analyzer-rules.md` + `08a-remote-analyzer-rules.md` |
| `project-manage-builder`  | 113 | 按 `buildMode` 分支：local 编译+归档+组装 dev/；remote 在 local 基础上+打包+安装远程运行时+上传+配置 .env+初始化 DB | `03b-builder-rules.md` + `08b-remote-builder-rules.md` |
| `project-manage-validator` | 106 | 启动服务（local 执行 start.sh / remote 启动后端+Nginx）、健康检查、页面验证、登录验证、生成 seed.spec.ts、写 SETUP.md；mode=remote 时同步 baseURL | `03c-validator-rules.md` + `08c-remote-validator-rules.md` |
| `playwright-test-planner`  | -   | 测试规划：读 case/ + 变更报告，生成测试计划，待用户多轮确认 | `07-agent-behavior.md`（planner 部分） |
| `playwright-test-generator` | - | 测试代码生成：直接生成（UI Map）/ 录制模式双模式 | `07-agent-behavior.md`（generator 部分） |
| `playwright-test-healer`   | -   | 测试修复：3 次尝试，失败标 fixme | `07-agent-behavior.md`（healer 部分） |
| `test-result-publisher`    | -   | 测试报告打包 + 上传 Gitee Release | `06-agent-workflow.md`（Publish 部分） |

## 三段链路：analyzer / builder / validator

Setup Agent 链路（原 `project-manage-setup` + `remote-env-setup` 融合体）已拆分为三段：

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

`pipeline-state.json` 的 `global` 字段从旧的 `Setup/RemoteSetup` 改为 `Analyze/Build/Validate`（见 `migrate-pipeline-state.mjs` STAGES_GLOBAL）。

## 已废弃 Agent（保留作历史参考）

> ⚠️ 以下 agent 已废弃，**新项目不要再用**。保留仅供查阅和过渡期参考。

| Agent | 状态 | 替代方案 |
|-------|------|---------|
| `project-manage-setup` | **DEPRECATED** 2026-06-03 | `project-manage-analyzer` + `project-manage-builder` + `project-manage-validator` |
| `remote-env-setup`     | **DEPRECATED** 2026-06-03 | `project-manage-builder`（mode=remote 时）+ `project-manage-validator`（远程验证） |

详见 `docs/superpowers/specs/2026-06-03-setup-agent-decomposition-design.md` 和 `docs/superpowers/plans/2026-06-03-setup-agent-decomposition.md`。

## 工具脚本

| 脚本 | 用途 | 配套规则 |
|------|------|---------|
| `scripts/runner.sh` | 日常启停服务（`start` / `stop` / `restart` / `status`） | `03d-runner-rules.md` |
| `scripts/scan.sh`   | 仓库扫描（检测变更，生成 reports/） | - |
| `scripts/init-dirs.mjs` | 项目目录初始化（幂等） | - |
| `scripts/migrate-pipeline-state.mjs` | pipeline-state 迁移 + 读写（ESM） | - |
| `scripts/generate-report.mjs` | 解析 Playwright 报告生成 progress/report/summary | - |
| `scripts/notify.mjs` | 测试报告邮件通知 | - |

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
| 「启动/停止/重启 xxx」 | `bash scripts/runner.sh {start\|stop\|restart} <NN-Project>` |
| 「配置 xxx 项目」 | 启动 `project-manage-analyzer` |
| 「构建 xxx」 | 询问 buildMode → 启动 `project-manage-builder` |
| 「验证 xxx」 | 启动 `project-manage-validator` |
| 「部署到远程 xxx」 | 启动 analyzer（重探测）→ buildMode=remote → builder → validator |
| 「切服务器」 | 清空 remoteConfig + remoteProbe → 启动 builder |
