#!/usr/bin/env bash
# 在空目录通过 Verdaccio 安装并生成 .env / 部署文档 / 启停脚本
set -euo pipefail
DIR="${1:-./bcenter-run}"
REGISTRY="${NPM_REGISTRY:-http://172.16.3.201:4873/}"
VERSION="${BCENTER_VERSION:-latest}"
PKG="gitlab-b-center@${VERSION}"

mkdir -p "$DIR"
cd "$DIR"
npm init -y >/dev/null 2>&1 || npm init -y

echo "==> 私服: ${REGISTRY}"
echo "==> 安装 ${PKG} ..."
npm install "$PKG" --registry "$REGISTRY"

echo "==> 补全初始化（若 postinstall 未写入）"
npx b-center init

echo "==> 引导式配置 .env"
npx b-center setup

npm pkg set scripts.start="b-center start" >/dev/null 2>&1 || true
npm pkg set scripts.stop="b-center stop" >/dev/null 2>&1 || true
npm pkg set scripts.restart="b-center restart" >/dev/null 2>&1 || true
npm pkg set scripts.status="b-center status" >/dev/null 2>&1 || true

echo ""
echo "已初始化目录: $(pwd)"
echo "  配置模板: .env.example"
echo "  配置文件: .env"
echo "  部署文档: BCENTER-DEPLOY.md"
echo "  一键启动: npm start"
echo "  后台启停: npx b-center start|stop|restart|status"
echo "  Linux:    ./start-b-center.sh start"
