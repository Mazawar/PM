# validator 阶段规则（环境验证 + 健康检查 + 报告）

> 配套 agent: `project-manage-validator`
> 规则编号：05（上接 04-deployer，下接 06-planner）

## 核心职责

环境验证 + 健康检查 + 出报告。验证部署后的环境是否正常运行。

**禁止**修改 build/ 产物、不改 buildMode、不改 analyzer 段、不生成 SETUP.md、不生成 seed。

## 触发条件

- `environment.json.build.builtAt` 必须存在
- `build/dev/` 结构完整
- mode=remote 时 `remoteConfig.server` 已绑定 + 部署包在远程 deployPath

## 环境验证流程

### 1. 启动服务

**local**：
从 `environment.json.analyzer.startCommand` 读取启动命令，在 `build/dev/software/` 下执行。预创建 `build/dev/logs/` 目录，日志重定向到 `build/dev/logs/<service>.log`。

**remote**：
```bash
ssh_execute "cd <deployPath>/software/apps/api && \
  nohup node -r dotenv/config dist/src/main.js dotenv_config_path=.env > logs/backend.log 2>&1 &"
```
`ss -tlnp` 确认 backendPort 在监听。

**远程 Nginx（如有前端）**：
```bash
ssh_execute_sudo "cp <本地 build/nginx.conf> /etc/nginx/sites-available/<NN-Project>"
ssh_execute_sudo "ln -sf /etc/nginx/sites-available/<NN-Project> /etc/nginx/sites-enabled/"
ssh_execute_sudo "nginx -t"
ssh_execute_sudo "systemctl reload nginx"
```

### 2. 健康检查

轮询 `analyzer.healthCheck.url`，最多 60 秒：
- local：直接 curl
- remote：通过 `ssh_execute curl` 或本地通过 tunnel

```bash
for i in $(seq 1 30); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_CHECK_URL")
  if [ "$HTTP_CODE" = "$EXPECTED_STATUS" ]; then exit 0; fi
  sleep 2
done
exit 1
```

### 3. 页面验证

1. `browser_snapshot` 确认页面渲染出实际内容（不是空白页或错误提示）
2. `browser_console_messages`（level=error）确认无模块解析失败、JS 运行时错误
3. 页面加载失败时检查 `build/dev/` 完整性和 workspace 包是否构建

### 4. 登录验证

按 `analyzer.login` 段配置填写表单、提交、确认跳转正确页。

## 出具报告

完成验证后，在 `test_project/<NN-Project>/results/.build/env/` 下写两份文件。

### progress.txt

```
ENV-001:PASS
ENV-002:PASS
ENV-003:FAIL
ENV-004:PASS
```

| 编号 | 检查项 | 来源 |
|------|--------|------|
| ENV-001 | 服务启动 | 进程存在 + 端口在监听 |
| ENV-002 | 健康检查 | healthCheck 端点返回 expectedStatus |
| ENV-003 | 页面渲染 | HTML 200 + 实际内容非空 + 控制台无 JS 错误 |
| ENV-004 | 登录验证 | 凭据能登录 + 跳正确页（无 credentials 则 SKIP） |

无对应配置时标 SKIP。

### report.md

```markdown
# <NN-Project> 环境验证报告

## 概要
- 验证时间: <YYYY-MM-DD HH:mm>
- 验证模式: <local|remote>
- 验证结果: <通过数>/<总数> 通过

## 结果概览
| 编号 | 检查项 | 结果 | 备注 |
|------|--------|------|------|
| ENV-001 | 服务启动 | ✅/❌ | |
| ENV-002 | 健康检查 | ✅/❌ | |
| ENV-003 | 页面渲染 | ✅/❌ | |
| ENV-004 | 登录验证 | ✅/❌/⏭ | |

## 详细结果
### ENV-NNN: <检查项> - PASS/FAIL/SKIP
**预期**: ...
**实际**: ...

## 下一步
- 全通过 → 进入测试流程（planner → generator → healer）
- 有失败 → 排查原因，上游问题打回，平台问题修复后重跑
```

## 配置更新（远程）

- 更新 `baseURL` 前**必须**用 `AskUserQuestion` 向用户确认
- `environment.json` 和 `playwright.config.ts` 的 `baseURL` **必须同步更新**
- 有隧道则 `baseURL` 使用 `localhost:<tunnel-port>`

## SSH 隧道（远程，可选）

端口无法从本地直接访问时创建本地端口转发。

## 写入 validator 段

```json
{
  "validator": {
    "completedAt": "ISO",
    "healthCheck": { "passed": true, "latencyMs": 120, "url": "..." },
    "pageCheck": { "passed": true },
    "loginCheck": { "passed": true },
    "remote": {
      "baseURL": "http://server-ip:80",
      "tunnelEnabled": false
    }
  }
}
```

## 问题处理策略

**必须向用户汇报**：端口冲突、中间件未运行、配置推断与实际不符、启动命令失败、DB 连接失败、baseURL 变更（远程）。

**可以自动处理**：依赖缺失（自动安装）、DB 未迁移（自动执行）。

**核心原则：凡涉及配置变更，必须先汇报后执行。禁止静默修改配置。**

## 禁止

- 修改 `build/dev/` 产物
- 修改 `buildMode`
- 修改 `analyzer.*` 段
- 生成 `SETUP.md`
- 生成 `seed.spec.ts`
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`
