#!/bin/bash
# PM 日常启停工具（跨平台）
# 用法: bash .claude/scripts/runner.sh {start|stop|restart|status} <NN-Project>

set -e

ACTION="$1"
PROJECT="$2"

if [ -z "$ACTION" ] || [ -z "$PROJECT" ]; then
  echo "用法: bash .claude/scripts/runner.sh {start|stop|restart|status} <NN-Project>"
  exit 1
fi

PROJECT_DIR="test_project/$PROJECT"
START_SCRIPT="$PROJECT_DIR/start.sh"

if [ ! -d "$PROJECT_DIR" ]; then
  echo "[FAIL] 项目目录不存在: $PROJECT_DIR"
  exit 1
fi

# 端口检测函数（跨平台）
port_listening() {
  local PORT="$1"
  if netstat -ano 2>/dev/null | grep ":$PORT " | grep -q "LISTENING"; then
    return 0
  elif lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# 找进程 PID（跨平台）
find_pid() {
  local PORT="$1"
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTENING | awk '{print $5}' | head -1
  else
    lsof -Pi :$PORT -sTCP:LISTEN -t 2>/dev/null
  fi
}

# 从 start.sh 提取端口
PORT=$(grep -E "^PORT=" "$START_SCRIPT" 2>/dev/null | head -1 | cut -d= -f2)
if [ -z "$PORT" ]; then
  # 备选：读 environment.json
  PORT=$(grep -oE '"ports":\s*\{[^}]*"frontend":\s*[0-9]+' "$PROJECT_DIR/test-config/environment.json" 2>/dev/null | grep -oE '[0-9]+' | head -1)
fi
if [ -z "$PORT" ]; then
  echo "[WARN] 无法从 start.sh 或 environment.json 提取端口，尝试 5173"
  PORT=5173
fi

case "$ACTION" in
  start)
    if port_listening "$PORT"; then
      echo "[OK] 端口 $PORT 已有服务运行（项目 $PROJECT）"
      exit 0
    fi
    if [ ! -f "$START_SCRIPT" ]; then
      echo "[FAIL] $START_SCRIPT 不存在"
      echo "请先运行 builder（project-manage-builder）"
      exit 1
    fi
    echo "[..] 启动 $PROJECT ..."
    bash "$START_SCRIPT"
    ;;

  stop)
    PID=$(find_pid "$PORT")
    if [ -z "$PID" ]; then
      echo "[INFO] 端口 $PORT 无服务运行"
      exit 0
    fi
    echo "[..] 停止 $PROJECT (PID: $PID) ..."
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
      taskkill //F //PID "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
    else
      kill "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
    fi
    sleep 1
    if port_listening "$PORT"; then
      echo "[WARN] 端口 $PORT 仍被占用"
    else
      echo "[OK] $PROJECT 已停止"
    fi
    ;;

  restart)
    bash "$0" stop "$PROJECT"
    sleep 2
    bash "$0" start "$PROJECT"
    ;;

  status)
    if port_listening "$PORT"; then
      PID=$(find_pid "$PORT")
      echo "[RUNNING] $PROJECT (端口: $PORT, PID: $PID)"
    else
      echo "[STOPPED] $PROJECT (端口: $PORT)"
    fi
    ;;

  *)
    echo "[FAIL] 未知命令: $ACTION"
    echo "用法: bash .claude/scripts/runner.sh {start|stop|restart|status} <NN-Project>"
    exit 1
    ;;
esac
