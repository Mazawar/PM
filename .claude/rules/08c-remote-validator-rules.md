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
