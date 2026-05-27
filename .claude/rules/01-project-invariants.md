# 项目结构与文件系统规则

## 核心不变量

- `repository/` 与 `test_project/` 条目 **1:1 对应**（如 `01-RuoYi-Vue`）
- `repository/` **只读** — 仅 `git clone` / `git pull`，禁止修改源码
- 所有测试代码和产物在 `test_project/` 下
- 仅以下内容提交到版本库：注册表文件（README.md）、docs、scripts、agent 定义、配置文件

## 注册表双写

- 必须同时写入 `repository/README.md` 和 `test_project/README.md`
- 只在 `<!-- projects-start -->` / `<!-- projects-end -->` 标记内添加
- 标记外的内容扫描脚本不解析，禁止在此区域添加项目条目
- 使用 `/pm` skill 管理，确保原子性

## 目录结构

```
test_project/<NN-Project>/
├── playwright.config.ts       # 项目级 Playwright 配置（必须）
├── vitest.config.ts           # 项目级 Vitest 配置（L2 API 测试，Setup Agent 生成）
├── plans/                     # 测试计划
│   ├── 00-test-plan.md        # 总计划索引（仅模块索引表）
│   └── NN-{module}.md         # 模块详细计划（NN 为两位序号，按模块递增）
├── start.sh                   # 一键启动脚本（Setup Agent 生成）
├── test-config/
│   └── environment.json       # 环境配置（技术栈、端口、凭据、中间件、启动命令）
├── tests/
│   ├── unit/                 # L1
│   │   └── {module}/
│   │       └── tc-{编号}-{简称}.spec.ts
│   ├── api/                  # L2
│   │   └── {module}/
│   │       └── tc-{编号}-{简称}.spec.ts
│   ├── e2e/                  # L3
│   │   └── {module}/         # 按模块分子目录
│   │       ├── tc-{编号}-{简称}.spec.ts
│   │       └── ...
│   └── ui/                   # L4
│       └── {module}/
│           ├── tc-{编号}-{简称}.spec.ts
│           └── ...
├── results/
│   ├── summary.md
│   └── {module}/
│       ├── progress.txt
│       ├── report.md
│       └── screenshots/
├── SETUP.md                # 环境启动报告（Setup Agent 生成）
└── reports/
    ├── summary.md            # 变更分析汇总（定时扫描写入）
    └── {timestamp}.md        # 变更报告（scan.sh 生成）
```

## 项目级 Playwright 配置（约定）

每个项目 **必须** 拥有独立的 `playwright.config.ts` 和 `vitest.config.ts`，不依赖全局配置。

### 创建时机

测试前环境检查时由 Setup Agent 创建（已配置则跳过），从源码推断或询问用户确定 `baseURL`。

### Playwright 配置模板

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  outputDir: './artifacts',
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

### Vitest 配置模板

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    root: path.resolve(__dirname),
    include: ['tests/api/**/*.spec.ts'],
    timeout: 30000,
    testTimeout: 15000,
  },
});
```

### 运行命令

L3/L4:
```bash
npx playwright test --config=test_project/<NN-Project>/playwright.config.ts
```

L2:
```bash
npx vitest run --config=test_project/<NN-Project>/vitest.config.ts
```

### 约束

- 测试代码使用相对路径（如 `page.goto('/login')`），由项目配置提供 `baseURL`
- 全局 `playwright.config.ts` 仅作为参考模板，不参与实际测试运行
- `environment.json` 是环境的**唯一真实来源**，`playwright.config.ts` 的 `baseURL` 必须与 `environment.json` 的 `baseURL` 一致
- Setup Agent 同时生成两个文件时确保值同步；修改时必须同步更新两者

## 项目环境分析（约定）

### 触发时机

每次测试前，主会话检查 `test_project/<NN-Project>/playwright.config.ts` 是否存在：
- **不存在** → 启动 Setup Agent 分析源码并生成配置
- **已存在** → 检查服务是否运行，跳过配置步骤

### 产出文件

| 文件 | 生成者 | 内容 |
|------|--------|------|
| `test-config/environment.json` | Setup Agent | 端口、凭据、技术栈、中间件、启动命令 |
| `playwright.config.ts` | Setup Agent | L3/L4 baseURL 指向正确端口 |
| `vitest.config.ts` | Setup Agent | L2 API 测试配置 |
| `start.sh` | Setup Agent | 一键启动脚本（端口检查 + 健康检查） |
| `SETUP.md` | Setup Agent | 环境启动报告（含实际验证结果，非假设） |

### 环境检查（每次测试前）

主会话在启动测试前，检查 `environment.json` 中的 `healthCheck`：
- 服务是否运行在指定端口
- 健康检查 URL 是否返回预期状态码
- **未通过** → 启动 Setup Agent，由 Agent 负责启动服务并验证（不是仅提示用户）

