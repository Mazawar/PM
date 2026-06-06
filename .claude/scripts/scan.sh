#!/bin/bash
# PM 自动化测试智能体 - 仓库扫描脚本
# 扫描 repository/ 下所有项目，检测代码变更并记录到 test_project/ 对应目录

set -euo pipefail

PM_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_DIR="$PM_ROOT/repository"
TEST_DIR="$PM_ROOT/test_project"
REPO_README="$REPO_DIR/README.md"
TEST_README="$TEST_DIR/README.md"
TEMPLATE_DIR="$PM_ROOT/.claude/templates"
LOG_FILE="$PM_ROOT/.omc/logs/scan.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# 确保 README 文件存在，不存在则从模板复制
if [ ! -f "$REPO_README" ]; then
  mkdir -p "$REPO_DIR"
  cp "$TEMPLATE_DIR/repository-README.md" "$REPO_README"
  log "从模板创建: $REPO_README"
fi

if [ ! -f "$TEST_README" ]; then
  mkdir -p "$TEST_DIR"
  cp "$TEMPLATE_DIR/test-project-README.md" "$TEST_README"
  log "从模板创建: $TEST_README"
fi

# 从 README.md 的 <!-- projects-start --> ~ <!-- projects-end --> 之间解析项目
# 仅匹配包含编号和仓库地址的数据行，忽略表头、分隔行、空行
parse_projects() {
  sed -n '/<!-- projects-start -->/,/<!-- projects-end -->/p' "$REPO_README" \
    | grep -P '^\|\s*\d{2}-' \
    | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2}' \
    | sort -u
}

# 从 README.md 获取指定项目的仓库地址（仅在标记区间内查找）
get_repo_url() {
  local project="$1"
  sed -n '/<!-- projects-start -->/,/<!-- projects-end -->/p' "$REPO_README" \
    | grep "$project" \
    | grep -oP 'https?://[^\s|]+' \
    | head -1
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

# 首次扫描基线报告（新克隆或 .last_hash 丢失）
generate_initial_report() {
  local repo_path="$1"
  local new_hash="$2"
  local project_name="$3"

  local report_dir="$TEST_DIR/$project_name/scan-logs"
  local scan_time
  scan_time=$(date '+%Y-%m-%d_%H%M%S')
  local report_file="$report_dir/${scan_time}.md"

  mkdir -p "$report_dir"

  local short_new recent_count
  short_new=$(echo "$new_hash" | cut -c1-7)
  recent_count=$(git -C "$repo_path" rev-list --count --since="30 days ago" HEAD 2>/dev/null || echo "0")
  if [ "$recent_count" -eq 0 ]; then
    recent_count=$(git -C "$repo_path" rev-list --count HEAD 2>/dev/null || echo "?")
  fi

  local display_time
  display_time=$(date '+%Y-%m-%d %H:%M:%S')

  cat > "$report_file" <<HEADER
# ${project_name} 基线报告（首次扫描）

- **扫描时间**: ${display_time}
- **基线提交**: \`${short_new}\`
- **近期提交数（30天）**: ${recent_count}

## 最近提交记录

$(git -C "$repo_path" log --format="- **%h** %s (*%an*, %ar)" -30 2>/dev/null || echo "无")

## 变更文件统计（最近 30 次提交）

$(git -C "$repo_path" diff --stat HEAD~30..HEAD 2>/dev/null || echo "无")

HEADER

  # 保存当前 hash 供下次对比
  echo "$new_hash" > "$TEST_DIR/$project_name/.last_hash"

  log "  生成基线报告: ${recent_count} 个近期提交 -> $report_file"
}

# 生成变更摘要报告
generate_summary() {
  local repo_path="$1"
  local old_hash="$2"
  local new_hash="$3"
  local project_name="$4"

  local report_dir="$TEST_DIR/$project_name/scan-logs"
  local scan_time
  scan_time=$(date '+%Y-%m-%d_%H%M%S')
  local report_file="$report_dir/${scan_time}.md"

  mkdir -p "$report_dir"

  local short_old short_new commit_count
  short_old=$(echo "$old_hash" | cut -c1-7)
  short_new=$(echo "$new_hash" | cut -c1-7)
  commit_count=$(git -C "$repo_path" rev-list --count "${old_hash}..${new_hash}" 2>/dev/null || echo "0")

  local display_time
  display_time=$(date '+%Y-%m-%d %H:%M:%S')

  # 写入报告
  cat > "$report_file" <<HEADER
# ${project_name} 变更报告

- **扫描时间**: ${display_time}
- **提交范围**: \`${short_old}..${short_new}\` (${commit_count} 个提交)

## 提交记录

$(git -C "$repo_path" log --format="- **%h** %s (*%an*, %ar)" "${old_hash}..${new_hash}" 2>/dev/null || echo "无")

## 变更文件统计

$(git -C "$repo_path" diff --stat "${old_hash}..${new_hash}" 2>/dev/null || echo "无")

## 文件变更明细

HEADER

  # 按变更类型分类
  local added modified deleted renamed
  added=$(git -C "$repo_path" diff --diff-filter=A --name-only "${old_hash}..${new_hash}" 2>/dev/null || true)
  modified=$(git -C "$repo_path" diff --diff-filter=M --name-only "${old_hash}..${new_hash}" 2>/dev/null || true)
  deleted=$(git -C "$repo_path" diff --diff-filter=D --name-only "${old_hash}..${new_hash}" 2>/dev/null || true)
  renamed=$(git -C "$repo_path" diff --diff-filter=R --name-only "${old_hash}..${new_hash}" 2>/dev/null || true)

  {
    if [ -n "$added" ]; then
      echo "### 新增文件"
      echo ""
      echo "$added" | while read -r f; do
        [ -n "$f" ] && echo "- \`$f\`"
      done
      echo ""
    fi

    if [ -n "$modified" ]; then
      echo "### 修改文件"
      echo ""
      echo "$modified" | while read -r f; do
        [ -n "$f" ] && echo "- \`$f\`"
      done
      echo ""
    fi

    if [ -n "$deleted" ]; then
      echo "### 删除文件"
      echo ""
      echo "$deleted" | while read -r f; do
        [ -n "$f" ] && echo "- \`$f\`"
      done
      echo ""
    fi

    if [ -n "$renamed" ]; then
      echo "### 重命名文件"
      echo ""
      echo "$renamed" | while read -r f; do
        [ -n "$f" ] && echo "- \`$f\`"
      done
      echo ""
    fi

    echo "## 关键 diff 摘要"
    echo ""
    echo '```diff'
    git -C "$repo_path" diff --unified=3 "${old_hash}..${new_hash}" -- '*.java' '*.vue' '*.js' '*.ts' '*.py' '*.xml' '*.yml' '*.yaml' '*.properties' '*.sql' 2>/dev/null | head -500 || true
    echo '```'
  } >> "$report_file"

  # 追加关注路径变更追踪
  append_track_diff "$report_file" "$repo_path" "$old_hash" "$new_hash" "$project_name"

  # 保存当前 hash 供下次对比
  echo "$new_hash" > "$TEST_DIR/$project_name/.last_hash"

  log "  生成报告: ${commit_count} 个提交 -> $report_file"
}

# 从 README.md 获取指定项目的「追踪」字段（目录路径列表，逗号分隔）
# 列名：追踪（第 5 列），空 = 不追踪
# 值是仓库内的目录路径（相对仓库根），不支持正则
# 注意：表格行首尾各有一个 |，awk 切分后「追踪」实际落在 $6
get_track_paths() {
  local project="$1"
  sed -n '/<!-- projects-start -->/,/<!-- projects-end -->/p' "$REPO_README" \
    | grep -P '^\|\s*\d{2}-' \
    | grep "$project" \
    | head -1 \
    | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $6); print $6}'
}

# 解析追踪字段为多个目录路径，去除空白和空项
parse_track_paths() {
  local track_field="$1"
  [ -z "$track_field" ] && return 0
  IFS=',' read -ra paths <<< "$track_field"
  for p in "${paths[@]}"; do
    p=$(echo "$p" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s|/$||')  # trim + 去尾斜杠
    [ -n "$p" ] && echo "$p"
  done
}

# 删除 track/ 下所有软链接（不动用户放的真实文件）
clean_track_links() {
  local track_dir="$1"
  [ ! -d "$track_dir" ] && return 0
  find "$track_dir" -type l -delete 2>/dev/null
  find "$track_dir" -mindepth 1 -type d -empty -delete 2>/dev/null
}

# 创建单个软链接
create_symlink() {
  local link="$1"
  local target="$2"

  mkdir -p "$(dirname "$link")"

  if command -v cmd.exe >/dev/null 2>&1; then
    local win_link win_target
    win_link="$(cygpath -w "$link" 2>/dev/null || echo "$link")"
    win_target="$(cygpath -w "$target" 2>/dev/null || echo "$target")"
    local bat_tmp
    bat_tmp="$(mktemp -t mklink.XXXXXX.bat)"
    printf '@echo off\r\nmklink /D "%s" "%s"\r\n' "$win_link" "$win_target" > "$bat_tmp"
    if cmd.exe //c "$(cygpath -w "$bat_tmp")" >/dev/null 2>&1; then
      log "    track: $link -> $target (mklink)"
    else
      log "    WARN: 无法创建软链接 $link"
    fi
    rm -f "$bat_tmp"
  else
    local target_abs
    target_abs="$(cd "$target" && pwd)"
    if ln -s "$target_abs" "$link" 2>/dev/null; then
      log "    track: $link -> $target_abs"
    else
      log "    WARN: 无法创建软链接 $link"
    fi
  fi
}

# 重建项目的所有追踪软链接
# 规则：track/ 目录不存在 → 按当前追踪字段建一次；存在 → 跳过（用户删了才会重建）
ensure_track_links() {
  local project="$1"
  local repo_path="$REPO_DIR/$project"
  local test_path="$TEST_DIR/$project"
  local track_dir="$test_path/track"
  local track_field
  track_field=$(get_track_paths "$project")

  # 空字段 = 不追踪
  [ -z "$track_field" ] && return 0

  # track/ 目录已存在 → 跳过（用户想重建请手动 rm -rf test_project/<project>/track/）
  if [ -d "$track_dir" ]; then
    log "  track: 目录已存在，跳过（手动 rm -rf 重建）"
    return 0
  fi

  mkdir -p "$track_dir"

  # 对每个目录建软链接
  local count=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    local target="$repo_path/$p"
    local link="$track_dir/$p"

    if [ ! -e "$target" ]; then
      log "  WARN track: $project -> $p (仓库中不存在)"
      continue
    fi

    create_symlink "$link" "$target"
    count=$((count + 1))
  done < <(parse_track_paths "$track_field")

  log "  track: 共建立 $count 个软链接"
}

# 在变更报告末尾追加"关注路径变更追踪"章节
# 对每个目录路径单独统计变更
append_track_diff() {
  local report_file="$1"
  local repo_path="$2"
  local old_hash="$3"
  local new_hash="$4"
  local project_name="$5"
  local track_field
  track_field=$(get_track_paths "$project_name")

  [ -z "$track_field" ] && return 0

  local paths=()
  while IFS= read -r line; do
    [ -n "$line" ] && paths+=("$line")
  done < <(parse_track_paths "$track_field")

  if [ ${#paths[@]} -eq 0 ]; then
    return 0
  fi

  {
    echo ""
    echo "---"
    echo ""
    echo "## 关注路径变更追踪"
    echo ""
    echo "本项目在 \`repository/README.md\` 中标记了以下关注路径，扫描时按路径单独统计。"
    echo "软链接位于 \`test_project/${project_name}/track/\` 下，每次扫描时按当前模式重新生成。"

    for p in "${paths[@]}"; do
      local changed
      changed=$(git -C "$repo_path" diff --name-only "${old_hash}..${new_hash}" -- "$p" 2>/dev/null || true)

      echo ""
      echo "### \`$p\`"
      echo ""
      if [ -z "$changed" ]; then
        echo "本次扫描无变更"
      else
        echo "$changed" | while IFS= read -r line; do
          [ -n "$line" ] && echo "- \`$line\`"
        done
      fi
    done
  } >> "$report_file"
}

# 主流程
# 用法: scan.sh [项目名]
#   无参数       — 扫描所有项目
#   指定项目名   — 仅扫描指定项目（支持部分匹配，如 oa-llm 匹配 01-oa-llm）
main() {
  local target="${1:-}"
  local projects has_change=0

  if [ -n "$target" ]; then
    # 指定项目模式：从注册表中模糊匹配
    local matched
    matched=$(parse_projects | grep "$target" || true)
    if [ -z "$matched" ]; then
      log "未在 $REPO_README 中找到项目: $target"
      exit 1
    fi
    projects="$matched"
    log "===== 开始扫描（指定项目: $matched）====="
  else
    projects=$(parse_projects)
    if [ -z "$projects" ]; then
      log "未在 $REPO_README 中发现项目，退出"
      exit 0
    fi
    log "===== 开始扫描 ====="
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

    # 首次扫描（新克隆或 .last_hash 丢失）：生成基线报告
    if [ ! -f "$test_path/.last_hash" ] || [ -z "$old_hash" ]; then
      generate_initial_report "$repo_path" "$new_hash" "$project" || { log "  FAIL: 基线报告生成失败"; continue; }
      ensure_track_links "$project" || log "  WARN: 软链接建立失败"
      continue
    fi

    # 无变更
    if [ "$old_hash" = "$new_hash" ]; then
      log "  无新提交"
      ensure_track_links "$project" || log "  WARN: 软链接建立失败"
      continue
    fi

    # 有变更，生成摘要
    generate_summary "$repo_path" "$old_hash" "$new_hash" "$project" || { log "  FAIL: 变更报告生成失败"; continue; }
    ensure_track_links "$project" || log "  WARN: 软链接建立失败"
    has_change=1
  done

  if [ "$has_change" -eq 1 ]; then
    log "检测到变更，请查看 test_project/ 下对应项目的 scan-logs/ 目录"
  else
    log "所有项目均无新变更"
  fi

  log "===== 扫描完成 ====="
}

main "$@"