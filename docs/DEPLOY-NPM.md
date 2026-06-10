# gitlab-b-center 私服部署指南

Verdaccio：**http://172.16.3.201:4873/**

B 端中台：GitLab Webhook、Agent 模板、会话追踪、系统监控。默认端口 **3000**（API + 前端同端口）。

## 1. 安装

```bash
# 一键初始化目录（推荐）
bash scripts/init-bcenter-run-dir.sh /opt/bcenter-run
cd /opt/bcenter-run
```

或手动：

```bash
mkdir bcenter-run && cd bcenter-run
npm init -y
npm install gitlab-b-center --registry http://172.16.3.201:4873/
```

安装后自动生成：

- `.env.example` — 配置模板
- `.env` — 从模板复制（需编辑）
- `BCENTER-DEPLOY.md` — 本说明副本
- `start-b-center.sh` / `b-center-service.sh`
- `logs/`、`data/`

```bash
npx b-center init    # 补全/更新脚本与 env 模板
npx b-center setup   # 引导式交互配置 .env（首次推荐）
```

首次 `npx b-center start` 若未完成配置，会自动进入 `setup` 向导。

## 2. 环境变量 `.env`

见 `.env.example`，主要项：

```bash
PORT=3000
DB_HOST=127.0.0.1
DB_NAME=gitlab_b_center
REDIS_HOST=127.0.0.1
OPENCLAW_BIN=openclaw
OPENCLAW_DEFAULT_WORKSPACE=/path/to/workspace
WEBHOOK_BASE_URL=http://<本机IP>:3000
```

### Windows OpenClaw 配置

npm 全局安装的 OpenClaw 在 Windows 上为 `.cmd` 包装脚本，B 端已内置跨平台调用（`server/utils/openclawCli.js`），**无需** `patch-package` 或 `shell: true`。

```env
OPENCLAW_BIN=C:\Users\<用户>\AppData\Roaming\npm\openclaw.cmd
OPENCLAW_DEFAULT_WORKSPACE=C:\Users\<用户>\workspace
```

首次部署前创建工作空间目录（或由 B 端在 Agent 注册时自动创建）：

```powershell
New-Item -ItemType Directory -Path "C:\Users\<用户>\workspace" -Force
```

验证 OpenClaw 可用：

```powershell
node -e "import('gitlab-b-center/server/utils/openclawCli.js').then(m=>console.log(m.getOpenClawVersionSync()))"
Invoke-WebRequest http://localhost:3000/api/dashboard -UseBasicParsing |
  Select -Expand Content | ConvertFrom-Json | Select -Expand openclawStatus
```

## 3. 启停（推荐 npx，支持 Windows）

```bash
npx b-center start      # 后台，日志 logs/b-center.log
npx b-center stop
npx b-center restart
npx b-center status
npx b-center fg         # 前台调试
npx b-center help
```

Linux 也可：

```bash
./start-b-center.sh start|stop|restart|status
```

或使用 npm scripts（在运行目录 `package.json` 中配置）：

```json
{
  "scripts": {
    "start": "b-center start",
    "stop": "b-center stop"
  }
}
```

## 4. 访问

| 入口 | 地址 |
|------|------|
| 管理界面 | http://127.0.0.1:3000/ |
| 健康检查 | http://127.0.0.1:3000/api/health |
| Webhook | http://<IP>:3000/api/webhook/receiver |

## 5. 发布到私服（开发机）

```bash
npm login --registry http://172.16.3.201:4873/
bash scripts/publish-private-npm.sh
```

## 6. 常见问题

| 现象 | 处理 |
|------|------|
| `EADDRINUSE` | `npx b-center stop` 或 `restart` |
| 页面空白 | 确认包内含 `dist/web/index.html`，升级版本 |
| OpenClaw 不可用 | 配置 `OPENCLAW_BIN` 绝对路径（见下方 Windows 说明） |
| 升级 | `npm update gitlab-b-center`，对比 `.env.example` 合并配置 |
