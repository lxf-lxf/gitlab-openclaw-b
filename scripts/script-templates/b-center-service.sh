#!/usr/bin/env bash
# B 端中台启停（由 npx b-center init 生成，升级可重新执行 init）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ENV_FILE="${BCENTER_ENV_FILE:-.env}"
PID_FILE="${BCENTER_PID_FILE:-.b-center.pid}"
LOG_FILE="${BCENTER_LOG_FILE:-logs/b-center.log}"
LABEL="gitlab-b-center"

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "缺少 $ENV_FILE，请先执行: npx b-center init" >&2
    exit 1
  fi
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
}

service_port() {
  load_env
  echo "${PORT:-3000}"
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

cmd_start() {
  local daemon=1
  if [[ "${1:-}" == "--fg" || "${1:-}" == "fg" ]]; then
    daemon=0
  fi
  if is_running; then
    echo "[$LABEL] 已在运行 PID=$(cat "$PID_FILE")"
    return 0
  fi
  load_env
  mkdir -p logs data
  if [[ "$daemon" -eq 0 ]]; then
    echo "[$LABEL] 前台运行（Ctrl+C 退出）..."
    exec npx b-center fg
  fi
  nohup npx b-center start >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 1
  if is_running; then
    echo "[$LABEL] 已后台启动 PID=$(cat "$PID_FILE")"
    echo "  日志: $ROOT/$LOG_FILE"
    echo "  访问: http://0.0.0.0:$(service_port)/"
  else
    echo "[$LABEL] 启动失败，请查看 $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
}

cmd_stop() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      is_running || break
      sleep 0.5
    done
    if is_running; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
  echo "[$LABEL] 已停止"
}

cmd_status() {
  if is_running; then
    echo "[$LABEL] 运行中 PID=$(cat "$PID_FILE")  端口=$(service_port)  日志=$ROOT/$LOG_FILE"
  else
    echo "[$LABEL] 未运行"
    rm -f "$PID_FILE"
    return 1
  fi
}

usage() {
  cat <<EOF
用法: $0 {start|stop|status|restart|fg}

跨平台推荐: npx b-center start|stop|restart|status|fg
EOF
}

ACTION="${1:-start}"
case "$ACTION" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  restart) cmd_stop || true; cmd_start ;;
  fg|foreground) cmd_start fg ;;
  -h|--help|help) usage ;;
  *)
    echo "未知操作: $ACTION" >&2
    usage
    exit 1
    ;;
esac
