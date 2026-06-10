#!/usr/bin/env bash
# 用法:
#   ./bin/start-b-center.sh          前台
#   ./bin/start-b-center.sh start    后台
#   ./bin/start-b-center.sh stop|status|restart
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/release-env.sh
source "$ROOT/bin/lib/release-env.sh"

release_load_config
release_resolve_paths

PID_FILE="$(release_pid_file)"
LOG_FILE="$(release_log_file)"
APP_ROOT="$ROOT/app"
SERVER_ENTRY="$APP_ROOT/server/index.js"

usage() {
  cat <<EOF
用法: $0 [命令]
  (无参数)   前台运行
  start      后台启动
  stop       停止
  status     状态
  restart    重启
EOF
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)" || return 1
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

run_foreground() {
  [[ -f "$ROOT/config/.env" ]] || { echo "缺少 config/.env，请先 ./bin/install.sh"; exit 1; }
  cd "$APP_ROOT"
  export DOTENV_CONFIG_PATH="$ROOT/config/.env"
  export NODE_ENV=production
  echo "前台启动: http://0.0.0.0:${PORT}/"
  exec node server/index.js
}

run_start() {
  if is_running; then
    echo "已在运行 pid=$(cat "$PID_FILE")"
    exit 0
  fi
  [[ -f "$ROOT/config/.env" ]] || { echo "缺少 config/.env"; exit 1; }
  mkdir -p "$(dirname "$LOG_FILE")"
  cd "$APP_ROOT"
  export DOTENV_CONFIG_PATH="$ROOT/config/.env"
  export NODE_ENV=production
  nohup node server/index.js >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 0.5
  if is_running; then
    echo "已后台启动 pid=$(cat "$PID_FILE")"
    echo "  访问: http://0.0.0.0:${PORT}/"
    echo "  日志: $LOG_FILE"
  else
    echo "启动失败，查看 $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

run_stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
  echo "已停止"
}

run_status() {
  if is_running; then
    echo "运行中 pid=$(cat "$PID_FILE") port=${PORT}"
    curl -sf "http://127.0.0.1:${PORT}/api/health" && echo "" || true
  else
    rm -f "$PID_FILE"
    echo "未运行"
    exit 1
  fi
}

CMD="${1:-run}"
case "$CMD" in
  -h|--help|help) usage ;;
  start) run_start ;;
  stop) run_stop ;;
  status) run_status ;;
  restart) run_stop || true; run_start ;;
  run|foreground|fg|"") run_foreground ;;
  *) echo "未知命令: $CMD"; usage; exit 1 ;;
esac
