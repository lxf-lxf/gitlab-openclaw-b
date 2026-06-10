#!/usr/bin/env bash
# 构建并发布 gitlab-b-center 到 Verdaccio 私服
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGISTRY="${NPM_REGISTRY:-http://172.16.3.201:4873/}"
REGISTRY_HOST="${REGISTRY#http://}"
REGISTRY_HOST="${REGISTRY_HOST#https://}"
REGISTRY_HOST="${REGISTRY_HOST%/}"

echo "==> 私服: ${REGISTRY}"

if [[ -n "${NPM_TOKEN:-}" ]]; then
  AUTH_NPMRC="${ROOT}/.npmrc.publish"
  cat > "${AUTH_NPMRC}" <<EOF
registry=${REGISTRY}
//${REGISTRY_HOST}/:_authToken=${NPM_TOKEN}
EOF
  export NPM_CONFIG_USERCONFIG="${AUTH_NPMRC}"
  echo "==> 使用环境变量 NPM_TOKEN 鉴权"
elif ! npm whoami --registry "${REGISTRY}" >/dev/null 2>&1; then
  echo "ERROR: 未登录私服。请先执行其一："
  echo "  npm login --registry=${REGISTRY}"
  echo "  或: export NPM_TOKEN=你的token && bash scripts/publish-private-npm.sh"
  exit 1
fi

echo "==> 当前用户: $(npm whoami --registry "${REGISTRY}")"

echo "==> 构建前端"
npm run build

echo "==> 发布 gitlab-b-center"
npm publish --registry "${REGISTRY}"

echo ""
echo "完成。目标机安装示例："
echo "  bash scripts/init-bcenter-run-dir.sh /opt/bcenter-run"
echo "  或:"
echo "  mkdir bcenter-run && cd bcenter-run && npm init -y"
echo "  npm install gitlab-b-center --registry ${REGISTRY}"
echo "  npx b-center init"
echo "  npx b-center start"
