# {{module}} 测试报告

## 概要
- 测试需求: {{module}} 模块自动化测试
- 目标应用: {{baseURL}}
- 测试时间: {{testTime}}
- 执行结果: {{passCount}}/{{totalCount}} 通过（通过率 {{passRate}}%）

## 结果概览
| # | 用例编号 | 用例名称 | 结果 | 截图 |
|---|---------|---------|------|------|
{{#rows}}| {{index}} | {{tcId}} | {{name}} | {{status}} | {{shot}} |
{{/rows}}

## 详细结果
{{tcDetails}}
{{defectSummary}}
## 环境信息
- 浏览器: Chromium
- 分辨率: 1920x1080
