# validator 阶段规则（启动验证 + 远程验证 + baseURL 同步 + runner 工具）

> 配套 agent: `project-manage-validator`
> 规则编号：05（上接 04-builder，下接 06-planner）

## 核心职责

启动服务 → 健康检查 → 页面验证 → 登录验证 → 写 SETUP.md → 生成 seed。

**禁止**修改 build/ 产物（不动 dev/、不重打归档）、不改 buildMode、不改 analyzer 段。

## 触发条件

- `environment.json.build.builtAt` 必须存在
- `build/dev/` 结构完整
- mode=remote 时 `remoteConfig.server` 已绑定 + 部署包在远程 deployPath

## 启动前：脚本验证（强制）

**在进入服务启动阶段之前，必须验证 start.sh 能否正常执行。**

### 1. 语法检查
```bash
bash -n test_project/<NN-Project>/start.sh
```
确保无语法错误。

### 2. 试运行
```bash
bash test_project/<NN-Project>/start.sh
```
观察输出：
- 端口检测逻辑是否正确识别当前状态（已运行 / 未运行）
- 健康检查是否能正常完成
- 脚本是否因命令不存在（如 Windows 下 `lsof`）而报错

### 3. 修复脚本问题
试运行暴露问题时立即修复：
- Windows 环境：用 `netstat -ano | grep ":$PORT " | grep LISTENING` 替代 `lsof`
- 工作目录问题：备选启动路径使用绝对路径或正确恢复工作目录
- 后台进程管理：确保 `&` 在当前 shell 环境下正确工作

### 4. 重新验证
修复后再次试运行，直到脚本无错误执行完成。

**前提条件**：运行 start.sh 前必须先完成构建（Step 4），确保 `build/dev/software/` 存在且包含已编译的产物和 node_modules。start.sh 指向的是 `build/dev/software/`，非 `repository/<NN-Project>/`。

**不允许在 start.sh 未通过试运行验证的情况下启动服务。**

## 启动服务

### local

```bash
bash test_project/<NN-Project>/start.sh
```

### remote

```bash
ssh_execute "cd <deployPath>/software/apps/api && \
  nohup node -r dotenv/config dist/src/main.js dotenv_config_path=.env > logs/backend.log 2>&1 &"
```

`ss -tlnp` 确认 backendPort 在监听。

### 远程 Nginx 配置（如有前端）

```bash
ssh_execute_sudo "cp <本地 build/nginx.conf> /etc/nginx/sites-available/<NN-Project>"
ssh_execute_sudo "ln -sf /etc/nginx/sites-available/<NN-Project> /etc/nginx/sites-enabled/"
ssh_execute_sudo "nginx -t"
ssh_execute_sudo "systemctl reload nginx"
```

## 健康检查

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

## 两层部署验证（remote 模式，强制）

**不可跳过，全部通过才算部署完成。**

### 第一层：连通性验证

Agent 根据 `techStack` 和 `dbConfig` 自动选择适用项，不适用项标注 SKIP。

| # | 验证项 | 配置来源 | 方法 |
|---|--------|---------|------|
| 1 | 系统运行时 | `techStack` | node/java/python 版本满足 |
| 2 | ORM/数据库迁移 | `dbConfig` | 检查迁移状态或表结构；无 dbConfig 则 SKIP |
| 3 | Nginx 配置 | `techStack.frontend` | nginx -t 通过；无前端则 SKIP |
| 4 | 后端启动 | `techStack.backend` | 进程存在且 `backendPort` 在监听；无后端则 SKIP |
| 5 | 健康检查 | `healthCheck` | 远程 curl `healthCheck.url` 返回 `expectedStatus` |
| 6 | 外部可访问 | `healthCheck` | 本地 curl `<remote-url>` 返回 `expectedStatus` |
| 7 | 页面内容 | `techStack.frontend` | 返回有效 HTML；无前端则 SKIP |
| 8 | API 代理 | `techStack.frontend` + `backend` | API 请求通过 Nginx 到达后端；无前端/无后端则 SKIP |

### 第二层：功能验证（强制，不可跳过）

| # | 验证项 | 配置来源 | 验证方法 |
|---|--------|---------|---------|
| 10 | 用户登录 | `credentials` + `login` | 调用登录接口返回成功令牌。无 credentials 则 SKIP |
| 11 | 数据完整性 | `dbConfig` | 查询关键表记录数。无 dbConfig 则 SKIP |
| 12 | 前端页面渲染 | `techStack.frontend` | curl 首页验证有效内容。纯后端则 SKIP |

**第二层中可执行的项（非 SKIP）任一失败 = 部署未完成**

结果全部记录到 `version-log.json` 当前构建记录中，每项标注 PASS/FAIL/SKIP + 实际返回值。

## 登录验证

按 `analyzer.login` 段配置：

```typescript
await page.goto('<baseURL><login.url>');
await page.getByPlaceholder('<usernamePlaceholder>').fill('<credentials.username>');
await page.getByPlaceholder('<passwordPlaceholder>').fill('<credentials.password>');
await page.getByRole('button', { name: '<submitButton>' }).click();
await page.waitForURL('**/<登录后路径>**');
```

登录成功 → 写 `validator.loginCheck.selectors`（实际使用的选择器）。

## 配置更新（远程，强制）

- 更新 `environment.json` 的 `baseURL` 前**必须**用 `AskUserQuestion` 向用户确认新 URL
- `environment.json` 和 `playwright.config.ts` 的 `baseURL` **必须**同步更新
- 不修改 `credentials` 字段
- `remoteConfig` 仅补充 `tunnel` 信息，不覆盖已写入的 server/serverIP/deployPath
- 有隧道则 `baseURL` 使用 `localhost:<tunnel-port>`

```json
{
  "baseURL": "<用户确认的 remote url>",
  "remoteConfig": {
    "tunnel": { "enabled": false, "localPort": null, "remotePort": null }
  }
}
```

`playwright.config.ts` 的 `use.baseURL` **必须同步更新**（environment.json 是唯一真实来源）。

## SSH 隧道（远程，可选）

端口无法从本地直接访问时：

```bash
ssh_tunnel_create localPort=5173 remoteHost=127.0.0.1 remotePort=80 server=<server>
```

有隧道则 baseURL 用 `localhost:<tunnel-port>`（本地 tunnel 端口）。

## 生成 seed.spec.ts

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

- **local**：`storageState` 写到 `test-config/auth.json`（chromium project 自动加载）
- **remote**：写远程 `test-config/auth.json`（通过 tunnel 复用）

## 写 SETUP.md

```markdown
# <NN-Project> 环境启动报告

## 项目信息
- 仓库地址: <URL>
- 技术栈: <frontend> + <backend>
- 端口: <frontend>: <port>, <backend>: <port>

## 依赖中间件
| 中间件 | 状态 | 地址 |

## 启动方式
- 一键启动: `bash .claude/scripts/runner.sh start <NN-Project>`
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
<按 04-builder-rules.md 自检清单的执行结果>

## 遇到的问题（如有）

## 测试执行命令
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

## 写入 validator 段

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

## 任务完成条件（强制）

**以下条件全部满足才算完成，缺一不可：**

- 生产构建完成，`build/dev/` 部署包组装完毕（含 node_modules、编译产物）
- 服务已启动，健康检查通过
- 页面可访问，内容非空白
- 浏览器控制台无模块解析失败或 JS 运行时错误
- 登录功能正常（如有凭据）

**不允许在服务未运行或验证失败时结束任务。** 唯一例外：遇到 Agent 无法解决的根本性阻塞（如数据库未安装、操作系统不兼容），此时必须向用户报告具体原因并等待用户指示。

## 问题处理策略（强制）

### 必须向用户汇报，等待指示

- **端口冲突** → 汇报冲突端口和占用情况，由用户决定换端口或关闭占用进程
- **中间件未运行** → 汇报缺少哪些中间件，由用户确认启动方式
- **配置推断与实际不符** → 汇报推断值和实际值的差异，由用户确认正确配置
- **启动命令失败** → 汇报错误日志，由用户确认正确的启动方式
- **需要修改已有配置文件** → 汇报修改内容和原因，由用户确认后再修改
- **数据库连接失败** → 汇报连接参数和错误信息，由用户提供正确的连接信息
- **baseURL 变更**（远程模式）→ 必须用 `AskUserQuestion` 询问用户新 URL

### 可以自动处理（无需汇报）

- **依赖缺失** → 自动安装（`pnpm install`、`npm install` 等）
- **数据库未迁移** → 自动执行迁移命令（前提是连接信息正确）

**核心原则：凡涉及配置变更（端口、凭据、启动命令、环境变量），必须先汇报后执行。禁止静默修改配置后继续运行。**

## 失败处理

- 启动失败 → 检查 `build/dev/logs/*.log` 报错
- 健康检查超时 → 检查中间件是否运行（MySQL/Redis）
- 页面空白 → 检查前端 dist 是否完整、workspace 包是否构建
- 登录失败 → 检查 credentials、表单选择器
- SSH 连接失败 → 报告用户，不自动重试
- Nginx 验证失败 → 回滚备份，报告用户
- 外部访问失败（网络/防火墙）→ 建议创建 SSH 隧道
- 登录接口返回 401 → 检查密码哈希格式、用户状态字段
- **配置变更（端口/凭据/启动命令）必须先汇报主会话**，禁止静默修改

## 禁止

- 修改 `build/dev/` 下的产物（不动 dist/、不重打归档）
- 修改 `buildMode`（仍由主会话控制）
- 修改 `analyzer.*` 段
- 删除 `case/`、`.last_hash`、`.pipeline-state.json`

---

## 附录 A：runner 工具（日常启停服务）

> 配套脚本: `.claude/scripts/runner.sh`
> **非 agent**，由主会话在收到「启动/停止/重启 xxx」命令时直接调用

### 命令协议

```bash
bash .claude/scripts/runner.sh start <NN-Project>     # 检查端口 → 未占用则执行 start.sh
bash .claude/scripts/runner.sh stop <NN-Project>      # 找进程 → kill
bash .claude/scripts/runner.sh restart <NN-Project>   # stop + start
bash .claude/scripts/runner.sh status <NN-Project>    # 端口 + 进程查询
```

### 不写 environment.json

runner.sh 只操作进程/端口，**不读不写** `environment.json`、`pipeline-state.json`、`build/dev/`。

### 跨平台兼容

端口检查：
- Windows：`netstat -ano | grep ":$PORT " | grep LISTENING`
- Linux：`lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null`

进程查找：
- Windows：`netstat -ano | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1`
- Linux：`lsof -Pi :$PORT -sTCP:LISTEN -t`

### 错误处理

| 情况 | 行为 |
|------|------|
| start.sh 不存在 | 报错："dev/ 部署包不存在，请先运行 builder" |
| 端口已被占用 | 提示用户（不自动 kill） |
| 进程未找到 | stop/restart 提示「服务未运行」 |
| start.sh 启动超时 | 检查 `build/dev/logs/*.log` |
