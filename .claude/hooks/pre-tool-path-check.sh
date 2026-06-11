#!/bin/bash
# PreToolUse hook: 拦截 Write/Edit 时检查文件路径和内容
# 规则1：目标文件路径禁止散落到根目录
# 规则2：文件内容中的截图/结果路径必须带项目前缀

input=$(cat)
tool=$(echo "$input" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# 只拦截 Write 和 Edit
if [[ "$tool" != "Write" && "$tool" != "Edit" ]]; then
  exit 0
fi

# 提取文件路径
file_path=$(echo "$input" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -z "$file_path" ]]; then
  file_path=$(echo "$input" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [[ -z "$file_path" ]]; then
  exit 0
fi

# 只对 test_project/ 下的 .ts 文件检查内容
check_content=false
if [[ "$file_path" == test_project/* && "$file_path" == *.ts ]]; then
  check_content=true
fi

# 规则1：目标文件路径禁止散落到根目录
if [[ "$file_path" == results/* ]]; then
  echo "BLOCKED: 截图/结果路径缺少项目前缀。正确: test_project/<NN-Project>/results/... 错误: results/..." >&2
  exit 1
fi

if [[ "$file_path" == tests/* || "$file_path" == e2e/* || "$file_path" == api/* ]]; then
  echo "BLOCKED: 测试文件路径缺少项目前缀。正确: test_project/<NN-Project>/tests/... 错误: tests/..." >&2
  exit 1
fi

# 规则2：检查文件内容中的裸路径（仅 .ts 测试文件）
if [[ "$check_content" == "true" ]]; then
  # 提取 new_string（Edit）或 content（Write）
  content=""
  if [[ "$tool" == "Write" ]]; then
    content=$(echo "$input" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)
  elif [[ "$tool" == "Edit" ]]; then
    content=$(echo "$input" | grep -o '"new_string":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi

  # 检查 page.screenshot 或 screenshot 中的裸路径
  if echo "$content" | grep -qE "path:\s*['\"]results/"; then
    echo "BLOCKED: 测试代码中发现裸截图路径 'results/...'。必须使用 'test_project/<NN-Project>/results/...' 前缀。" >&2
    exit 1
  fi

  if echo "$content" | grep -qE "path:\s*['\"]tests/"; then
    echo "BLOCKED: 测试代码中发现裸测试路径 'tests/...'。必须使用 'test_project/<NN-Project>/tests/...' 前缀。" >&2
    exit 1
  fi
fi

exit 0
