# 项目结构与文件系统规则

## 核心不变量

- `repository/` 与 `test_project/` 条目 **1:1 对应**（如 `01-RuoYi-Vue`）
- `repository/` **只读** — 仅 `git clone` / `git pull`，禁止修改源码
- 所有测试代码和产物在 `test_project/` 下
- 仅以下内容提交到版本库：注册表文件（READEME.md）、docs、templates、scripts、agent 定义、配置文件

## 注册表双写

- 必须同时写入 `repository/READEME.md` 和 `test_project/READEME.md`
- 只在 `<!-- projects-start -->` / `<!-- projects-end -->` 标记内添加
- 标记外的内容扫描脚本不解析，禁止在此区域添加项目条目
- 使用 `/pm` skill 管理，确保原子性

## 目录结构

```
test_project/<NN-Project>/
├── playwright.config.ts       # 项目级 Playwright 配置（必须）
├── start.sh                   # 一键启动脚本（project-manage-setup 生成）
├── test-config/
│   ├── test-plan.md          # 总计划索引（仅模块索引表）
│   ├── plans/{module}.md     # 模块详细计划
│   └── environment.json      # 环境配置（技术栈、端口、凭据、中间件、启动命令）
├── tests/
│   ├── unit/                 # L1
│   ├── api/                  # L2
│   ├── e2e/                  # L3
│   └── ui/                   # L4
├── results/
│   ├── summary.md
│   └── {module}/
│       ├── progress.txt
│       ├── report.md
│       └── screenshots/
└── reports/
    ├── startup.md            # 环境启动报告（project-manage-setup 生成）
    └── {timestamp}.md        # 变更报告（scan.sh 生成）
```

## 项目级 Playwright 配置（约定）

每个项目 **必须** 拥有独立的 `playwright.config.ts`，不依赖全局配置。

### 创建时机

首次测试时由 `project-manage-setup` agent 创建，从源码推断或询问用户确定 `baseURL`。

### 配置模板

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  outputDir: './results/artifacts',
  use: {
    baseURL: 'http://localhost:<端口>',  // 项目指定
    headless: true,
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

### 运行命令

```bash
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

### 约束

- 测试代码使用相对路径（如 `page.goto('/login')`），由项目配置提供 `baseURL`
- 全局 `playwright.config.ts` 仅作为参考模板，不参与实际测试运行
- `environment.json` 是环境的**唯一真实来源**，`playwright.config.ts` 的 `baseURL` 必须与 `environment.json` 的 `baseURL` 一致
- `project-manage-setup` 同时生成两个文件时确保值同步；修改时必须同步更新两者

## 项目环境分析（约定）

### 触发时机

用户首次要求测试某项目时，主会话检测到 `playwright.config.ts` 不存在，启动 `project-manage-setup` agent。

### 产出文件

| 文件 | 生成者 | 内容 |
|------|--------|------|
| `test-config/environment.json` | project-manage-setup | 端口、凭据、技术栈、中间件、启动命令 |
| `playwright.config.ts` | project-manage-setup | baseURL 指向正确端口 |
| `start.sh` | project-manage-setup | 一键启动脚本（端口检查 + 健康检查） |
| `reports/startup.md` | project-manage-setup | 环境启动报告（技术架构、中间件状态、验证结果） |

### 环境检查（每次测试前）

主会话在启动测试前，检查 `environment.json` 中的 `healthCheck`：
- 服务是否运行在指定端口
- 健康检查 URL 是否返回预期状态码
- 未通过则提示用户先启动服务（可运行 `start.sh`）

