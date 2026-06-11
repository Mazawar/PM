# 项目 Agent 索引

> 最后更新：2026-06-04
> 配套规则文件：`.claude/rules/`

## 当前活跃 Agent

| Agent | 职责 | 配套规则 |
|-------|------|---------|
| `project-manage-analyzer` | 只读分析仓库源码、推断技术栈/端口/中间件/凭据、写入 `environment.json.analyzer` 段、生成 `playwright.config.ts`、初始化目录；远程探测在 `remoteConfig.server` 已绑定时执行 | `03-analyzer-rules.md` |
| `project-manage-deployer`  | 验证部署能力。按 `buildMode` 分支：local 编译验证+归档+组装 dev/；remote 在 local 基础上+打包+安装远程运行时+上传+配置 .env+初始化 DB+部署验证报告 | `04-deployer-rules.md` |
| `project-manage-validator` | 环境验证 + 健康检查 + 环境验证报告。启动服务、页面验证、登录验证；mode=remote 时同步 baseURL（附录：runner 工具） | `05-validator-rules.md` |
| `playwright-test-planner`  | 测试规划：读 case/ + 变更报告，生成测试计划，待用户多轮确认 | `06-planner-rules.md` |
| `playwright-test-generator` | 测试代码生成：直接生成（UI Map）/ 录制模式双模式 | `07-generator-rules.md` |
| `playwright-test-healer`   | 测试修复：3 次尝试，失败标 fixme，更新 progress/report/summary | `08-healer-rules.md` |
| `test-result-publisher`    | 测试报告打包 + 上传 Gitee Release | `01-pipeline-rules.md`（Publish 部分） |

## 三段链路：analyzer / deployer / validator

```
[analyzer] → [deployer] → [validator]
   ↓            ↓            ↓
 写入          写入          写入
analyzer.*   build.*      validator.*
 段          段            段
```

- **analyzer**：只读分析，**不构建、不启动**
- **deployer**：按 `environment.json.build.mode`（`local` / `remote`）分支，**不启动服务**；部署前自动备份（数据库 + 配置），产物扁平化到 `backend/`/`frontend/`/`database/`
- **validator**：启动服务、做健康/页面/登录验证、生成 seed，**不修改 build/ 产物**；同时出具 `results/.build/env/` 环境验证报告（**测试流程第一道闸门**，不通过不进入端到端）

状态交接载体：`test_project/<NN-Project>/test-config/environment.json` 的三段字段（`analyzer.*` / `build.*` / `validator.*`）。

## 测试流程入口闸门

```
扫描 → analyzer → deployer → validator (构建测试) ← 第一道闸门
                                            ├─ 全 PASS → planner → generator → healer → 端到端
                                            └─ 有 FAIL（上游）→ 打回，不进入端到端
                                                  ↓
                                            results/.build/ + results/{module}/ 独立报告
                                                  ↓
                                            summary.md 合并汇总
```

两路测试报告平级独立：构建验证（`results/.build/deploy/`）+ 环境验证（`results/.build/env/`）+ 端到端（`results/{module}/`），由 `generate-report.mjs` 合并到 `results/summary.md`。

## 工具脚本

所有脚本统一在 `.claude/scripts/` 下：

| 脚本 | 用途 |
|------|------|
| `scan.sh`   | 仓库扫描（检测变更，生成 scan-logs/） |
| `init-dirs.mjs` | 项目目录初始化（幂等） |
| `pipeline-state.mjs` | pipeline-state 初始化 + 读写（ESM） |
| `generate-report.mjs` | 解析 Playwright 报告生成 progress/report/summary |
| `notify.mjs` | 测试报告邮件通知（位于 `.claude/skills/notify/`） |

## 调度管线

测试执行管线（每模块串行）：

```
planner → generator → healer（按需）
```

环境配置管线（项目级）：

```
analyzer → [主会话问 buildMode] → deployer (按 mode 分支) → validator
```

构建发布管线（Report 后）：

```
Report → [主会话问用户] → publisher → 上传 Gitee Release
```

## 主会话识别用户命令

| 用户说 | 主会话动作 |
|--------|-----------|
| 「启动/停止/重启 xxx」 | 启动 `project-manage-validator`（含服务启停） |
| 「配置 xxx 项目」 | 启动 `project-manage-analyzer` |
| 「部署验证 xxx」 | 询问 buildMode → 启动 `project-manage-deployer` |
| 「验证 xxx」 | 启动 `project-manage-validator` |
| 「部署到远程 xxx」 | 启动 analyzer（重探测）→ buildMode=remote → deployer → validator |
| 「切服务器」 | 清空 remoteConfig + remoteProbe → 启动 deployer |
