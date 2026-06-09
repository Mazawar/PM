# PM 自动化测试智能体 - 环境搭建指南

## 环境需求概述

| 环境 | 版本要求 | 用途 | 必选 |
|------|----------|------|------|
| Node.js | v18+ | 运行时基础 | 是 |
| npm | 随 Node.js | 包管理器 | 是 |
| Git | 任意稳定版 | 仓库管理、scan.sh 脚本 | 是 |
| Playwright | 1.40+ | 浏览器自动化测试 + MCP Server | 是 |
| MCP SSH Manager | 3.0+ | SSH 远程管理 MCP Server | 否 |
| rsync | 任意 | 文件同步（SSH Manager 可选依赖） | 否 |
| sshpass | 任意 | 密码认证 rsync（SSH Manager 可选依赖） | 否 |

---

## 环境检测

运行以下命令检测所有必需和可选环境：

```bash
# 必选环境
node --version                # v18+
npm --version                 # 9+
git --version                 # 任意版本
npx playwright --version      # 1.40+（含 MCP Server）

# 可选环境
npx mcp-ssh-manager --version # 3.0+（SSH 远程管理）
rsync --version               # 任意（文件同步）
```

---

## 环境安装

### Node.js

**缺失时安装：**

```bash
# Windows
choco install nodejs

# Linux (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs

# macOS
brew install node@18
```

---

### Git

**缺失时安装：**

```bash
# Windows
choco install git

# Linux
apt-get install git

# macOS
brew install git
```

---

### 项目依赖

```bash
# 安装 package.json 中的依赖
npm install
```

---

### Playwright 浏览器

**缺失时安装：**

```bash
npx playwright install chromium
```

---

### MCP SSH Manager（可选）

SSH 远程管理工具，用于通过 Claude Code 直接操作远程服务器。

```bash
# 全局安装
npm install -g mcp-ssh-manager

# 验证安装
npx mcp-ssh-manager --version

# 可选依赖（文件同步功能需要）
# Linux
sudo apt-get install rsync sshpass

# macOS
brew install rsync
brew install hudochenkov/sshpass/sshpass
```

配置方式：复制 `.env.example` 为 `.env` 并填写服务器信息（字段说明见 `README.md`）。

---

## MCP Server 配置

项目通过 `.mcp.json` 配置 MCP Server，Claude Code 启动时自动加载：

| Server | 用途 | 配置文件 |
|--------|------|----------|
| `playwright-test` | 浏览器自动化测试 | `.mcp.json` |
| `ssh-manager` | SSH 远程管理 | `.mcp.json` + `.env` |

确保 `.mcp.json` 中的命令可正常执行：

```bash
# 验证 Playwright MCP Server
npx playwright run-test-mcp-server --help

# 验证 SSH Manager MCP Server
npx mcp-ssh-manager --version
```

---

## 一键环境检查

```bash
echo "=== Node.js ===" && node --version || echo "MISSING: node"
echo "=== npm ===" && npm --version || echo "MISSING: npm"
echo "=== Git ===" && git --version || echo "MISSING: git"
echo "=== Playwright ===" && npx playwright --version || echo "MISSING: playwright"
echo "=== MCP SSH Manager ===" && npx mcp-ssh-manager --version || echo "OPTIONAL: mcp-ssh-manager (未安装，SSH 功能不可用)"
echo "=== 项目依赖 ===" && test -d node_modules && echo "已安装" || echo "未安装: 运行 npm install"
echo "=== Playwright 浏览器 ===" && npx playwright install --dry-run 2>/dev/null || echo "运行 npx playwright install chromium"
```

> 本文件由 PM 自动化测试智能体维护。如有环境变更，请同步更新本文件。
