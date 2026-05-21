# PM - 自动化测试智能体工程

自动化测试智能体的中枢工程，用于监控、管理和测试多个外部项目仓库。

## 功能

- **持续监控** — 定时扫描 `repository/` 下各项目仓库的代码变更
- **变更分析** — 自动生成变更报告，分析影响范围和测试建议
- **自动化测试** — 支持四级测试（单元/接口/E2E/UI），Agent 提议测试计划，用户确认后执行
- **问题反馈** — 测试发现的问题整理后提交回原项目仓库

## 快速开始

```bash
# 扫描所有仓库，检测变更
bash .claude/scripts/scan.sh
```

## 目录结构

```
pm/
├── repository/           # 项目仓库（只读克隆）
│   └── READEME.md        # 项目注册清单
├── test_project/         # 测试工程（与 repository 一一对应）
│   ├── READEME.md        # 测试工程清单
│   └── templates/        # 测试用例模板
├── docs/                 # 项目文档
│   ├── 01-TESTING.md     # 测试框架规则
│   └── 02-WORKFLOW.md    # 交互流程规范
└── .claude/
    └── scripts/scan.sh   # 仓库扫描脚本
```

## 添加新项目

在 `repository/READEME.md` 和 `test_project/READEME.md` 的 `<!-- projects-start -->` 标记内添加一行：

```
| NN-项目名 | ./NN-项目名 | https://仓库地址 | Git |
```

下次扫描时自动克隆仓库。

## 文档

| 编号 | 文档 | 说明 |
|------|------|------|
| 01 | [TESTING.md](docs/01-TESTING.md) | 测试框架规则 — 多语言框架映射、四级测试定义、用例格式 |
| 02 | [WORKFLOW.md](docs/02-WORKFLOW.md) | 交互流程规范 — 从变更检测到问题反馈的完整协议 |
