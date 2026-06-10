#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=lib/release-env.sh
source "$ROOT/bin/lib/release-env.sh"

mkdir -p "$ROOT/config" "$ROOT/data"

if [[ ! -f "$ROOT/config/.env" ]]; then
  cp "$ROOT/config/env.example" "$ROOT/config/.env"
  echo "已生成 config/.env，请编辑数据库、Redis、OpenClaw 等配置"
else
  echo "config/.env 已存在"
fi

if [[ ! -f "$ROOT/config/env.example" ]]; then
  echo "缺少 config/env.example" >&2
  exit 1
fi

cp "$ROOT/config/env.example" "$ROOT/.env.example" 2>/dev/null || true

if [[ ! -d "$ROOT/app/node_modules" ]]; then
  echo "==> npm install --omit=dev (app/)"
  (cd "$ROOT/app" && npm ci --omit=dev 2>/dev/null || npm install --omit=dev)
fi

echo ""
echo "安装完成。请确认 config/.env 后启动:"
echo "  $ROOT/bin/start-b-center.sh start"
echo "  $ROOT/bin/start-b-center.sh status"
echo "访问: http://<服务器IP>:\${PORT:-3000}/"
