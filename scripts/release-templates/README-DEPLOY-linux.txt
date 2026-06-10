gitlab-b-center {{VERSION}} — Linux 离线发布包
============================================

要求: Node.js >= 18、MySQL、Redis、OpenClaw CLI

部署（解压后两步）
----
  tar xzf gitlab-b-center-{{VERSION}}-linux-amd64.tar.gz
  cd gitlab-b-center-{{VERSION}}-linux-amd64
  ./bin/install.sh              # 生成 config/.env、config/env.example
  vi config/.env                # 填写 DB / Redis / OpenClaw
  ./bin/start-b-center.sh start   # 后台启动
  ./bin/start-b-center.sh status

  访问: http://<服务器IP>:3000/
  健康: curl http://127.0.0.1:3000/api/health

npm 私服安装（推荐）
----
  bash scripts/init-bcenter-run-dir.sh /opt/bcenter-run
  cd /opt/bcenter-run
  vi .env
  npx b-center start

环境变量见 config/env.example
