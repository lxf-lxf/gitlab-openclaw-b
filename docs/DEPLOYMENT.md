# GitLab OpenClaw B 端中台 — 部署文档

本文档描述在生产环境部署 `gitlab-b-center` 的完整流程，适用于 Linux / macOS 服务器。

## 1. 架构概览

```
                    ┌─────────────┐
                    │   GitLab    │
                    └──────┬──────┘
                           │ Webhook POST
                           ▼
┌──────────┐   proxy    ┌──────────────────────────────────┐
│  Nginx   │ ─────────► │  Node.js (Koa)  :3000            │
│  :80/443 │            │  ├── REST API  /api/*              │
└────┬─────┘            │  ├── WebSocket /api/notifications  │
     │ static           │  └── Webhook   /api/webhook/*      │
     ▼                  └───────┬──────────────┬─────────────┘
 dist/web/                     │              │
                               ▼              ▼
                          ┌────────┐    ┌──────────┐
                          │ MySQL  │    │  Redis   │
                          └────────┘    └──────────┘
                               │
                               ▼ spawn
                          ┌──────────┐
                          │ OpenClaw │  ~/.openclaw/agents/
                          │   CLI    │
                          └──────────┘
```

- **Nginx**：托管前端静态资源，反向代理 API 与 WebSocket
- **Node.js**：单一进程承载 API、Webhook 接收、事件队列消费、定时任务
- **OpenClaw**：与本机用户目录 `~/.openclaw/agents/` 下的 Agent 配置交互

## 2. 环境要求

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 18 | 推荐 LTS（v20 / v22） |
| npm | >= 9 | 随 Node 安装 |
| MySQL | >= 5.7 | 需提前创建数据库 |
| Redis | >= 6 | 用于事件队列与缓存 |
| OpenClaw CLI | 最新 | 运行 Agent 的必备工具 |
| Nginx | 任意稳定版 | 生产环境推荐 |

### 2.1 创建 MySQL 数据库

```sql
CREATE DATABASE gitlab_b_center
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

CREATE USER 'bcenter'@'%' IDENTIFIED BY 'your_strong_password';
GRANT ALL PRIVILEGES ON gitlab_b_center.* TO 'bcenter'@'%';
FLUSH PRIVILEGES;
```

服务首次启动时会自动 `sequelize.sync()` 建表，并在空表时写入默认 Agent 模板种子数据。

### 2.2 安装 OpenClaw

确保运行服务的系统用户能执行 `openclaw` 命令：

```bash
# 验证
openclaw --version
openclaw agents list --json
```

若 CLI 不在默认 PATH，通过环境变量指定：

```bash
export OPENCLAW_BIN=/path/to/openclaw
```

服务代码中 `agent-manager.js`、`system-agent.js`、`daily-report.js` 均读取此变量。

## 3. 部署步骤

### 3.1 获取代码

```bash
git clone <your-repo-url> gitlab-b-center
cd gitlab-b-center/gitlab-b-center   # 按实际目录调整
```

### 3.2 安装依赖

```bash
npm ci    # 或 npm install
```

### 3.3 配置环境变量

所有配置从项目根目录 `.env` 读取，代码中无硬编码默认值：

```bash
cp .env.example .env
vim .env
```

`.env` 示例：

```bash
PORT=3000
NODE_ENV=production

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=bcenter
DB_PASSWORD=your_strong_password
DB_NAME=gitlab_b_center

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=

OPENCLAW_BIN=/usr/local/bin/openclaw
OPENCLAW_DEFAULT_WORKSPACE=/opt/workspace
OPENCLAW_DEFAULT_MODEL=deepseek/deepseek-v4-flash

GITLAB_BASE_URL=https://gitlab.example.com/api/v4
WEBHOOK_BASE_URL=https://bcenter.example.com
```

PM2 / systemd 也可通过 `EnvironmentFile=/opt/gitlab-b-center/.env` 注入，无需在代码中修改。

> `.env` 已加入 `.gitignore`，切勿提交到 Git。部署前从 `.env.example` 复制并填写实际值。

### 3.4 构建前端

```bash
npm run build
```

构建产物位于 `dist/web/`，包含 `index.html` 及静态资源。

### 3.5 启动后端

```bash
# 直接启动（前台）
npm start

# 或使用 PM2
pm2 start server/index.js --name gitlab-b-center \
  --cwd /opt/gitlab-b-center \
  --env production

pm2 save
pm2 startup
```

验证健康检查：

```bash
curl http://127.0.0.1:3000/api/health
# {"status":"ok","timestamp":"..."}
```

### 3.6 配置 Nginx

示例配置（HTTPS 略，按需补充证书）：

```nginx
upstream bcenter_api {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name bcenter.example.com;

    root /opt/gitlab-b-center/dist/web;
    index index.html;

    # 前端 SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理
    location /api/ {
        proxy_pass http://bcenter_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket（系统通知）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

重载 Nginx：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. GitLab Webhook 配置

### 4.1 回调地址

GitLab 项目 Webhook URL 必须指向 **GitLab 能访问到的地址**：

```
http://<内网IP或域名>:3000/api/webhook/receiver
```

若通过 Nginx 暴露，使用：

```
https://bcenter.example.com/api/webhook/receiver
```

在 B 端 **系统设置** 中填写相同的「Webhook 局域网回调地址」，系统同步项目时会将此 URL 写入 GitLab。

### 4.2 触发事件

建议勾选：

- Push events
- Issues events
- Merge request events
- Comments
- Pipeline events
- Job events

### 4.3 关联 Agent 模板

Webhook 开启后，还需在 B 端完成：

1. **Agent 模板** → 创建模板 → **初始化到 OpenClaw**
2. **项目管理** → 进入项目 → 关联 Agent 模板并设置执行顺序

未关联模板时，事件会入库但不会触发 Agent。

## 5. OpenClaw Agent 目录

| 类型 | 路径 |
|------|------|
| 业务 Agent | `~/.openclaw/agents/<agent-name>/agent/` |
| 系统监控 Agent | `~/.openclaw/agents/system-monitor/agent/` |

每个 Agent 目录包含：

- `agent.json` — 模型、指令、工具配置
- `AGENTS.md` — Agent 说明文档
- `plugins/` — 可选插件（如 gitlab-tools）

**系统设置 → 系统监控 Agent** 可在此页面初始化、编辑配置、选择 Workspace。

运行 Node 服务的用户必须与执行 OpenClaw 的用户一致（或共享 `~/.openclaw` 目录权限）。

## 6. systemd 服务示例

`/etc/systemd/system/gitlab-b-center.service`：

```ini
[Unit]
Description=GitLab OpenClaw B Center
After=network.target mysql.service redis.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/gitlab-b-center
EnvironmentFile=/opt/gitlab-b-center/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable gitlab-b-center
sudo systemctl start gitlab-b-center
sudo systemctl status gitlab-b-center
```

## 7. 运维检查清单

### 启动日志应包含

- `Database synced`
- `Server listening on port 3000`
- Redis 连接成功（或 inline 降级警告）
- WebSocket attached

### 常见问题

| 现象 | 排查 |
|------|------|
| Webhook 收到事件但 Agent 不执行 | 检查项目是否关联 Agent 模板；Redis 是否可用 |
| OpenClaw 状态不可用 | 确认 `OPENCLAW_BIN` 路径、`openclaw --version` |
| 前端 404 / 白屏 | 确认 `npm run build` 完成，Nginx `root` 指向 `dist/web` |
| WebSocket 通知不推送 | Nginx 需配置 `Upgrade` / `Connection` 头 |
| 会话显示 Session: unknown | 检查 OpenClaw JSONL 日志格式，服务启动时会尝试回填 |
| 编辑系统 Agent 无弹窗 | 确保前端为最新构建；弹窗依赖 `.modal-overlay` 样式 |

### 日志位置

- PM2：`pm2 logs gitlab-b-center`
- systemd：`journalctl -u gitlab-b-center -f`
- OpenClaw 会话：`~/.openclaw/agents/<name>/sessions/*.jsonl`

### 数据备份

定期备份：

- MySQL 数据库 `gitlab_b_center`
- `~/.openclaw/agents/` 目录（Agent 配置与会话日志）

## 8. 升级流程

```bash
cd /opt/gitlab-b-center
git pull
npm ci
npm run build
pm2 restart gitlab-b-center   # 或 systemctl restart
```

数据库结构变更由 `sequelize.sync()` 自动迁移（当前未使用 `alter: true`，大版本升级前建议先备份）。

## 9. 开发 vs 生产对照

| 项目 | 开发 | 生产 |
|------|------|------|
| 启动命令 | `npm run dev` | `npm start` + Nginx |
| 前端 | Vite dev server `:5173` | `dist/web/` 静态托管 |
| API 地址 | Vite proxy → `:3000` | Nginx → `:3000` |
| 热重载 | `--watch` 后端自动重启 | PM2 / systemd 管理 |
| Webhook URL | 本机局域网 IP | 公网 / 内网域名 |

## 10. 安全建议

- GitLab Token 仅存数据库，勿写入代码或日志
- 生产环境启用 HTTPS
- 限制 Webhook 端点仅允许 GitLab 服务器 IP（Nginx `allow` / `deny` 或防火墙）
- Redis、MySQL 不暴露公网
- 定期轮换 GitLab Personal Access Token
