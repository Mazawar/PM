# PM 自动化测试智能体 - 环境搭建指南

## 环境需求概述

| 环境 | 版本要求 | 用途 |
|------|----------|------|
| Node.js | v18+ | Playwright 测试框架 |
| npm | 随 Node.js | 包管理器 |
| Git | 任意稳定版 | 仓库管理、scan.sh 脚本 |
| Playwright | 1.40+ | 浏览器自动化测试 |

---

## 环境检测

检测所有必需环境是否已安装：

```bash
node --version          # v18+
npm --version           # 9+
git --version           # 任意版本
npx playwright --version  # 1.40+
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

### Playwright 浏览器

**缺失时安装：**

```bash
npm install
npx playwright install chromium
```

---

> 本文件由 PM 自动化测试智能体生成。如有环境变更，请同步更新本文件。
