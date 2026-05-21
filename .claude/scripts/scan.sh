#!/bin/bash
# PM 自动化测试智能体 - 仓库扫描脚本
# 扫描 repository/ 下所有项目，检测代码变更并记录到 test_project/ 对应目录

set -euo pipefail

PM_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_DIR="$PM_ROOT/repository"
TEST_DIR="$PM_ROOT/test_project"
REPO_README="$REPO_DIR/READEME.md"
LOG_FILE="$PM_ROOT/.omc/logs/scan.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# 从 READEME.md 解析项目编号列表
parse_projects() {
  grep -oP '\d{2}-[A-Za-z0-9_-]+' "$REPO_README" | sort -u
}

# 从 READEME.md 获取指定项目的仓库地址
get_repo_url() {
  local project="$1"
  grep "$project" "$REPO_README" | grep -oP 'https?://[^\s|]+' | head -1
}

# 克隆或拉取仓库，返回新旧 HEAD hash
sync_repo() {
  local project="$1"
  local repo_path="$REPO_DIR/$project"
  local repo_url
  repo_url=$(get_repo_url "$project")

  # 仓库不存在 → 克隆
  if [ ! -d "$repo_path/.git" ]; then
    if [ -z "$repo_url" ]; then
      log "  SKIP: $project - 未找到仓库地址"
      return 1
    fi
    log "  CLONE: $project <- $repo_url"
    git clone --quiet "$repo_url" "$repo_path" 2>/dev/null || {
      log "  WARN: clone 失败 - $repo_url"
      return 1
    }
    new_hash=$(git -C "$repo_path" rev-parse HEAD 2>/dev/null || echo "")
    echo ""
    echo "$new_hash"
    return 0
  fi

  # 仓库已存在 → 拉取
  local old_hash new_hash
  old_hash=$(git -C "$repo_path" rev-parse HEAD 2>/dev/null || echo "")
  git -C "$repo_path" pull --ff-only --quiet 2>/dev/null || {
    log "  WARN: pull 失败或冲突 - $repo_path"
    return 1
  }
  new_hash=$(git -C "$repo_path" rev-parse HEAD 2>/dev/null || echo "")
  echo "$old_hash"
  echo "$new_hash"
}

# 生成变更摘要
generate_summary() {
  local repo_path="$1"
  local old_hash="$2"
  local new_hash="$3"
  local project_name="$4"

  local changelog_file="$TEST_DIR/$project_name/changelog.md"

  mkdir -p "$(dirname "$changelog_file")"

  # 如果是首次记录，写入表头
  if [ ! -f "$changelog_file" ]; then
    cat > "$changelog_file" <<HEADER
# $project_name 变更记录

| 扫描时间 | 提交数 | 提交范围 |
| -------- | ------ | -------- |
HEADER
  fi

  local commit_count
  commit_count=$(git -C "$repo_path" rev-list --count "${old_hash}..${new_hash}" 2>/dev/null || echo "0")

  local short_old short_new
  short_old=$(echo "$old_hash" | cut -c1-7)
  short_new=$(echo "$new_hash" | cut -c1-7)

  local scan_time
  scan_time=$(date '+%Y-%m-%d %H:%M:%S')

  # 追加表格行
  echo "| $scan_time | $commit_count | \`$short_old..$short_new\` |" >> "$changelog_file"

  # 追加详细提交信息
  echo "" >> "$changelog_file"
  echo "### $scan_time 详细提交" >> "$changelog_file"
  echo "" >> "$changelog_file"
  git -C "$repo_path" log --format="- **%h** %s (*%an*, %ar)" "${old_hash}..${new_hash}" >> "$changelog_file" 2>/dev/null || true
  echo "" >> "$changelog_file"

  # 保存当前 hash 供下次对比
  echo "$new_hash" > "$TEST_DIR/$project_name/.last_hash"

  log "  记录 $commit_count 个新提交 -> $changelog_file"
}

# 主流程
main() {
  log "===== 开始扫描 ====="
  local projects has_change=0

  projects=$(parse_projects)

  if [ -z "$projects" ]; then
    log "未在 $REPO_README 中发现项目，退出"
    exit 0
  fi

  for project in $projects; do
    local repo_path="$REPO_DIR/$project"
    local test_path="$TEST_DIR/$project"

    log "同步: $project"

    # 确保测试目录存在
    mkdir -p "$test_path"

    # 克隆或拉取仓库
    local sync_result
    sync_result=$(sync_repo "$project") || continue
    local old_hash new_hash
    old_hash=$(echo "$sync_result" | sed -n '1p')
    new_hash=$(echo "$sync_result" | sed -n '2p')

    # 首次扫描（新克隆或无历史记录）：记录基线
    if [ ! -f "$test_path/.last_hash" ] || [ -z "$old_hash" ]; then
      echo "$new_hash" > "$test_path/.last_hash"
      log "  基线记录: ${new_hash:0:7}"
      continue
    fi

    # 无变更
    if [ "$old_hash" = "$new_hash" ]; then
      log "  无新提交"
      continue
    fi

    # 有变更，生成摘要
    generate_summary "$repo_path" "$old_hash" "$new_hash" "$project"
    has_change=1
  done

  if [ "$has_change" -eq 1 ]; then
    log "检测到变更，请查看 test_project/ 下对应项目的 changelog.md"
  else
    log "所有项目均无新变更"
  fi

  log "===== 扫描完成 ====="
}

main
