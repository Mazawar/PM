# Agent 调度与工作流规则

## 六阶段流程

```
Detect → Analyze → Plan → Generate → Execute → Report
 扫描     分析      规划    生成      执行      汇报
```

1. **Detect** — `scan.sh` 检测变更，生成报告到 `reports/`
2. **Analyze** — Agent 读报告，写 `reports/summary.md`
3. **Plan** — planner agent 生成测试计划，**用户确认**
4. **Generate** — generator agent 生成测试代码，**用户确认**
5. **Execute** — 运行测试，失败交 healer agent
6. **Report** — 汇总结果，向用户汇报

## 主会话职责（强制）

主会话 **不直接编写或调试测试代码**，只做：

1. 接收任务 → 启动 planner
2. 审阅计划 → 确认后启动 generator
3. 首次运行测试 → 有失败则启动 healer
4. 汇总结果 → 向用户汇报

**关键**：测试生成后运行若出现 **TimeoutError**，**必须委托 healer**，禁止主会话逐步排查。

## Agent 调度管线

```
planner → generator → healer（按需）
```

- Agent 始终 **先提议，等用户确认** 后再执行
- 未经用户批准不自动执行测试
- 启动命令：
  - planner: `Agent(subagent_type="playwright-test-planner")`
  - generator: `Agent(subagent_type="playwright-test-generator")`
  - healer: `Agent(subagent_type="playwright-test-healer")`

## 用户确认点

| 阶段 | 确认内容 |
|------|---------|
| Plan 后 | 测试计划的模块覆盖和 TC 编号分配 |
| Generate 后 | 生成的测试代码 |
| Report 后 | 是否提交 issue 或进一步测试 |

## 禁止修改列表

所有 Agent 禁止修改以下文件：
- `playwright.config.ts`、`package.json`、`.mcp.json`
- CLAUDE.md、`docs/`、agent 定义文件
- `.claude/rules/` 规则文件
- `repository/` 下的源码
