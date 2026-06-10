# 打包与私服部署

对齐 [cursor-acp-gateway](https://github.com) 部署模式：Verdaccio npm + `npx b-center` CLI + 离线发布包。

私服：**http://172.16.3.201:4873/**

---

## 方式一：Verdaccio npm（推荐）

### 开发机发布

```bash
npm login --registry http://172.16.3.201:4873/
bash scripts/publish-private-npm.sh
# 或 npm run publish:verdaccio
```

### 目标机一键安装

```bash
bash scripts/init-bcenter-run-dir.sh /opt/bcenter-run
cd /opt/bcenter-run
vim .env                 # 编辑配置（.env.example 已附带）
npm start                # 一键启动
```

生成文件：

| 文件 | 说明 |
|------|------|
| `.env.example` | 配置模板 |
| `.env` | 自动生成，需编辑 |
| `BCENTER-DEPLOY.md` | 部署说明 |
| `start-b-center.sh` | Linux 启停脚本 |

### 启停命令（跨平台）

```bash
npx b-center init        # 补全/更新 env 与脚本
npx b-center start       # 后台
npx b-center stop
npx b-center restart
npx b-center status
npx b-center fg          # 前台
npm start                # 等同 b-center start
```

详见 [DEPLOY-NPM.md](./DEPLOY-NPM.md)

---

## 方式二：离线发布包

参考 `cursor-acp-gateway/scripts/package-release.mjs`：

```bash
npm run pack
# RELEASE_TARGETS=linux-amd64 npm run pack
# SKIP_BUILD=1 npm run pack
```

产出 `release/gitlab-b-center-<version>-linux-amd64.tar.gz` 等。

### Linux 部署

```bash
tar xzf gitlab-b-center-1.0.2-linux-amd64.tar.gz
cd gitlab-b-center-1.0.2-linux-amd64
./bin/install.sh           # config/.env + config/env.example
vi config/.env
./bin/start-b-center.sh start
./bin/start-b-center.sh status
```

目录结构：

```
gitlab-b-center-x.x.x-linux-amd64/
├── app/              # 应用代码 + node_modules
├── config/
│   ├── env.example
│   └── .env          # install 生成
├── bin/
│   ├── install.sh
│   └── start-b-center.sh
└── README-DEPLOY.txt
```

---

## 脚本对照（cursor-acp-gateway → gitlab-b-center）

| acp-gateway | gitlab-b-center |
|-------------|-----------------|
| `scripts/publish-private-npm.sh` | `scripts/publish-private-npm.sh` |
| `scripts/init-npm-run-dir.sh` | `scripts/init-bcenter-run-dir.sh` |
| `scripts/package-release.mjs` | `scripts/pack.mjs` |
| `npx acp-gateway init/start` | `npx b-center init/start` |
| `.env.acp-gateway` | `.env` |
| `scripts/release-templates/` | `scripts/release-templates/` |

---

## 命令速查

| 操作 | 命令 |
|------|------|
| 发布私服 | `bash scripts/publish-private-npm.sh` |
| 初始化运行目录 | `bash scripts/init-bcenter-run-dir.sh ./bcenter-run` |
| 打离线包 | `npm run pack` |
| 启动 | `npm start` / `npx b-center start` |
