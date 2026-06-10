# 发布包路径解析（需预先设置 ROOT）
release_load_config() {
  local env_file="${ENV_FILE:-$ROOT/config/.env}"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    export DOTENV_CONFIG_PATH="$env_file"
  fi
}

release_resolve_paths() {
  _abs_dir() {
    local p="$1"
    [[ "$p" == /* ]] || p="$ROOT/${p#./}"
    mkdir -p "$p"
    (cd "$p" && pwd)
  }

  BCENTER_DATA_DIR="$(_abs_dir "${BCENTER_DATA_DIR:-data}")"
  export BCENTER_DATA_DIR
  export PORT="${PORT:-3000}"
  mkdir -p "$BCENTER_DATA_DIR/logs"
}

release_pid_file() {
  local f="${BCENTER_PID_FILE:-$BCENTER_DATA_DIR/b-center.pid}"
  [[ "$f" == /* ]] || f="$ROOT/${f#./}"
  printf '%s' "$f"
}

release_log_file() {
  local f="${BCENTER_LOG_FILE:-$BCENTER_DATA_DIR/logs/b-center.log}"
  [[ "$f" == /* ]] || f="$ROOT/${f#./}"
  mkdir -p "$(dirname "$f")"
  printf '%s' "$f"
}
