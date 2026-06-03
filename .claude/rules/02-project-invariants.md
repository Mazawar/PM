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
├── case/                      # 用户提供的业务案例（自由格式，不提交 git）
│   ├── README.md              # 目录说明（Setup Agent 生成）
│   └── *.{md,txt,...}         # 任意文件名、任意数量，planner 优先读取
│                              # ⚠️ 任何 Agent 禁止删除、清空或覆盖用户文件
├── start.sh                   # 一键启动脚本（Setup Agent 生成）
├── remote-start.sh            # 远程启动脚本（远程服务器上执行，不归档到 build/）
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
├── build/                  # 构建部署产物（Remote Setup Agent 生成）
│   ├── version-log.json    # 构建版本追踪总表（每次构建追加一条记录）
│   ├── deploy-config.json  # 部署配置快照（可复用）
│   ├── nginx.conf          # Nginx 配置文件
│   └── artifacts/          # 构建归档（不可删除）
│       ├── <timestamp>-<commit>.tar.gz
│       └── <timestamp>-<commit>.manifest.json
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

## 项目环境分析

环境检查、Setup 触发条件、产出文件定义详见 `06-agent-workflow.md` 的「测试前环境检查」章节。本节仅定义配置模板和约束。

## build/ 目录产物约定（强制）

`build/` 下的产物**必须与构建模式严格匹配**。Setup Agent 完成构建后必须按当前构建模式自检，违规产物需立即删除（不留待主会话清理）。

### 两种构建模式

| 模式 | 触发条件 |
|------|---------|
| **本地构建** | 用户选择"本地构建"（不部署到远程） |
| **远程部署** | 用户选择"远程部署"，且 `build/dev/` 已就绪 + Remote Setup Agent 已执行 |

### 本地构建 — 必含 / 必不含

| 必含 | 必不含（出现即违规，需删除） |
|------|------|
| `build/dev/`（完整部署包，含 software/ database/ sh/ deploy-manual.md update_readme.md） | `build/<NN-Project>/`（项目副本，由远程部署前的"组装副本"产生） |
| `build/artifacts/<timestamp>-<commit>.tar.gz` + `.manifest.json` | `build/<NN-Project>.tar.gz`（远程部署包，本地无需） |
| `build/tmp/`（可空，预留给远程部署用） | `build/pre-deploy-backup-*.sql.gz`（部署前数据库备份，本地无需） |
| `build/version-log.json`（含 `archiveVerification` 校验记录） | `build/deploy-config.json`（远程部署配置，本地无需） |
|  | `build/nginx.conf`（远程部署配置，本地无需） |
|  | `build/dev/software/**/*.log`（散落日志，统一在 `build/dev/logs/`） |

### 远程部署 — 在本地构建基础上追加

| 追加产物 | 部署后清理策略 |
|---------|--------------|
| `build/deploy-config.json` | 保留（下次部署复用） |
| `build/nginx.conf` | 保留（本地副本） |
| `build/<NN-Project>.tar.gz`（部署包，部署成功后可清理） | 部署成功后删除，仅保留 artifacts/ 中的源码归档 |
| `build/pre-deploy-backup-*.sql.gz` | 部署成功后删除 |
| `build/tmp/` 下的临时文件 | 部署成功后清理，仅保留 `.gitkeep` 占位 |

### 违规示例（已发生事故，本规则为补强）

> 2026-06-03 在 01-oa-llm 项目 Setup 中，本地构建场景下 build/ 误生成 `<NN-Project>/`、`<NN-Project>.tar.gz`、`pre-deploy-backup-*.sql.gz`，并散落 `api.log` / `web.log` 在 `build/dev/software/apps/`。本地构建场景无远程部署需求，违反"按构建模式严格匹配"原则。

### 检查时机

- Setup Agent 完成 Step 7（输出启动报告）前**必须**执行「build/ 自检清单」（定义在 `03-setup-environment.md`）
- 主会话在 `updateStage('global', null, 'Setup', { status: 'completed' })` 前可触发复核（可选）

### 日志输出规范

- **本地构建**：`nohup ... > build/dev/logs/<service>.log 2>&1 &`
- **远程部署**：`<deployPath>/logs/<service>.log`
- **禁止**：`build/`、`build/dev/`、`build/dev/software/` 下任何子目录直接放 `*.log`
- 启动脚本（`start.sh`）必须将日志输出到 `build/dev/logs/`，避免散落

