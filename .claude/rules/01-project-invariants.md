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
├── test-config/
│   ├── test-plan.md          # 总计划索引（仅模块索引表）
│   ├── plans/{module}.md     # 模块详细计划
│   └── environment.json      # 环境配置
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
└── reports/                  # 变更报告
```

