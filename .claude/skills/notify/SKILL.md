---
name: notify
description: |
  Manage email notification settings. Configure global SMTP, add/remove recipients
  (global or per-project), test connectivity, and send test reports.
argument-hint: "[setup|list|add|remove|project|test|send] [args]"
allowed-tools: Read, Edit, Write, AskUserQuestion, Bash
---

# Notification Manager

Manage email notification for test reports.

## Config Files

| 文件 | 作用域 | 位置 |
|------|--------|------|
| `notify-config.json` | 全局（SMTP + 默认收件人） | `.claude/notify-config.json`（已 gitignore，含密码） |
| `notify-config.example.json` | 配置模板 | `.claude/skills/notify/notify-config.example.json` |
| `environment.json` | 项目级（收件人覆盖） | `test_project/<NN-Project>/test-config/environment.json` |

**收件人优先级**：项目级 `notification.recipients` > 全局 `recipients`。

## Parse Arguments

从 **$ARGUMENTS** 判断操作：

| Arguments | Action |
|-----------|--------|
| 空 或 `list` 或 `ls` | → 显示当前通知配置 |
| `setup` | → 交互式配置全局 SMTP |
| `add <email>` | → 添加全局收件人 |
| `remove <email>` 或 `rm <email>` | → 移除全局收件人 |
| `send <project>` | → 立即发送项目测试报告 |
| `test [project]` | → Dry-run 预览邮件内容（不发送） |
| `project <name> add <email>` | → 添加项目级收件人 |
| `project <name> remove <email>` | → 移除项目级收件人 |
| `project <name> list` | → 显示项目级通知配置 |

---

## list — Show Current Config

### Step 1: Read Global Config

读取 `.claude/notify-config.json`（不存在则提示先 `setup`）。

### Step 2: Display

```
## 通知配置

### 全局 SMTP
- 服务器: {smtp.host}:{smtp.port} (secure: {smtp.secure})
- 发件人: {from}

### 发送策略
| 条件 | 状态 |
|------|------|
| 每次都发 | {sendOn.always ? '✓' : '✗'} |
| 有失败时发 | {sendOn.onFail ? '✓' : '✗'} |
| 检测到变更时发 | {sendOn.onChangeDetected ? '✓' : '✗'} |

### 全局收件人 ({N} 个)
{recipients 列表，每行一个}

### 项目级收件人
{遍历 test_project/*/test-config/environment.json，找到有 notification.recipients 的项目}
| 项目 | 收件人 |
|------|--------|
| 01-OA-CodeNew | dev@example.com |
```

如果 `notify-config.json` 不存在：
```
⚠ 未配置通知。使用 /notify setup 开始配置。```

---

## setup — Interactive Global SMTP Setup

### Step 1: Check Existing Config

读取 `.claude/notify-config.json`（如有）作为默认值。

### Step 2: Collect SMTP Info

用 **AskUserQuestion** 逐步收集：

1. **SMTP 服务器地址**（如 `smtp.qq.com`、`smtp.gmail.com`、`smtp.163.com`）
2. **SMTP 端口**（默认 465）
3. **是否使用 SSL**（默认 true）
4. **认证用户名**（通常是邮箱地址）
5. **认证密码/授权码**（QQ 邮箱需要授权码，不是登录密码）
6. **发件人显示**（如 `PM 测试中心 <your@email.com>`）
7. **默认收件人**（逗号分隔多个邮箱）
8. **发送策略**（多选：always / onFail / onChangeDetected）

使用 `preview` 展示常见 SMTP 配置供用户选择：

| 服务商 | Host | Port |
|--------|------|------|
| QQ 邮箱 | smtp.qq.com | 465 |
| 163 邮箱 | smtp.163.com | 465 |
| Gmail | smtp.gmail.com | 587 |
| 阿里企业邮 | smtp.mxhichina.com | 465 |
| 腾讯企业邮 | smtp.exmail.qq.com | 465 |

### Step 3: Write Config

写入 `.claude/notify-config.json`：

```json
{
  "smtp": {
    "host": "...",
    "port": 465,
    "secure": true,
    "auth": {
      "user": "...",
      "pass": "..."
    }
  },
  "from": "PM 测试中心 <your@email.com>",
  "recipients": ["dev@example.com"],
  "sendOn": {
    "always": false,
    "onFail": true,
    "onChangeDetected": true
  }
}
```

### Step 4: Verify Connectivity

```bash
node .claude/skills/notify/notify.mjs --project <任意已有项目> --dry-run
```

输出验证结果：

```
✓ 通知配置已保存
✓ SMTP 连接验证通过（dry-run）
  服务器: smtp.qq.com:465
  发件人: PM 测试中心 <xxx@qq.com>
  收件人: dev@example.com
  发送策略: onFail + onChangeDetected
```

如果 dry-run 报 SMTP 连接错误，提示用户检查密码/授权码。

---

## add — Add Global Recipient

### Step 1: Parse Email

从 `$ARGUMENTS` 提取 email 地址。缺失则报错。

验证格式：包含 `@` 和 `.`。

### Step 2: Update Config

读取 `notify-config.json` → 检查是否已存在 → 不存在则追加到 `recipients` 数组 → 写回。

```
✓ 已添加全局收件人: {email}
  当前收件人: {列出全部}
```

已存在时：`该邮箱已在全局收件人列表中。`

---

## remove — Remove Global Recipient

### Step 1: Parse Email

从 `$ARGUMENTS` 提取 email 地址。

### Step 2: Update Config

读取 `notify-config.json` → 从 `recipients` 数组移除 → 写回。

```
✓ 已移除全局收件人: {email}
  当前收件人: {列出全部，或 "无"}
```

不存在时：`该邮箱不在全局收件人列表中。`

---

## send — Send Report Email

### Step 1: Parse Project Name

从 `$ARGUMENTS` 提取项目名（支持部分匹配，如 `oa` 匹配 `01-OA-CodeNew`）。

### Step 2: Validate

检查：
- `notify-config.json` 存在
- `test_project/<NN-Project>/results/summary.md` 存在
- 收件人非空（全局或项目级至少有一个）

### Step 3: Confirm

用 **AskUserQuestion** 展示发送预览并确认：

```
即将发送 {project} 测试报告邮件：
  收件人: {最终收件人列表}
  发送后: 通过 SMTP ({smtp.host})
```

### Step 4: Send

```bash
node .claude/skills/notify/notify.mjs --project <NN-Project>
```

```
✓ 邮件已发送
  收件人: {to}
  主题: {subject}
  附件: {N} 个
```

---

## test — Dry-Run Notification

### Step 1: Parse Project Name

从 `$ARGUMENTS` 提取项目名（可选，缺省则用第一个有 summary.md 的项目）。

### Step 2: Validate

检查 `notify-config.json` 存在、项目存在、summary.md 存在。

### Step 3: Dry-Run

```bash
node .claude/skills/notify/notify.mjs --project <NN-Project> --dry-run
```

直接输出 dry-run 结果（收件人、主题、HTML 预览）。

---

## project — Manage Per-Project Recipients

### project list <name>

1. 模糊匹配项目名
2. 读取 `test_project/<NN-Project>/test-config/environment.json`
3. 显示：

```
## {NN-Project} 通知配置

### 收件人
{notification.recipients 列表，或 "未配置（使用全局收件人）"}

### 当前全局收件人（兜底）
{全局 recipients}
```

### project add <name> <email>

1. 模糊匹配项目名
2. 解析 email
3. 读取 `environment.json`
4. 确保 `notification` 对象存在，追加到 `notification.recipients`
5. 写回

`environment.json` 中的结构：
```json
{
  "notification": {
    "recipients": ["project-dev@example.com"]
  }
}
```

```
✓ 已添加项目收件人: {email} → {NN-Project}
  项目收件人: {列出全部}
```

### project remove <name> <email>

1. 模糊匹配项目名
2. 解析 email
3. 从 `notification.recipients` 移除
4. 如果数组为空，删除 `notification` 段
5. 写回

```
✓ 已移除项目收件人: {email} ← {NN-Project}
  项目收件人: {列出全部，或 "无（将使用全局收件人）"}
```

---

## 项目名模糊匹配（共用逻辑）

所有需要项目名的子命令都支持部分匹配：

1. 读取 `repository/README.md` 的项目表
2. 在编号列中搜索包含 `name` 的条目（不区分大小写）
3. 唯一匹配 → 直接使用
4. 多个匹配 → 列出候选，让用户选择
5. 无匹配 → 报错：`未找到项目: {name}`
