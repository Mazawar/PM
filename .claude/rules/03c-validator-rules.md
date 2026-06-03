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
