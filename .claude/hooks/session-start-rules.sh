#!/bin/bash
# SessionStart hook: 注入 CLAUDE.md 核心规则，上下文压缩后仍生效
# 输出到 stdout 的内容会作为 system-reminder 注入

cat <<'EOF'
<system-reminder>
CLAUDE.md 强制规则（每次会话生效，压缩后不丢失）：
1. 执行前看规则：读 .claude/rules/00-README.md 找对应阶段规则，读完再动手
2. 禁止自我发散：规则没说的不做，失败就报告，不猜、不排查、不读源码
3. 最小改动：只改必须改的，每一行改动追溯到用户要求
4. 执行后验证：跑测试确认通过，检查产出文件齐全，不齐不标完成
5. 路径校验：写入文件路径必须以 test_project/<项目>/ 开头，禁止散落到根目录
</system-reminder>
EOF
