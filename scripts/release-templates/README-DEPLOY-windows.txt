gitlab-b-center {{VERSION}} — Windows 离线发布包
================================================

要求: Node.js >= 18、MySQL、Redis、OpenClaw CLI

部署
----
  解压 gitlab-b-center-{{VERSION}}-win-amd64.zip
  cd gitlab-b-center-{{VERSION}}-win-amd64
  bin\install.cmd
  编辑 config\.env
  bin\start-b-center.cmd start
  bin\start-b-center.cmd status

npm 私服（推荐，跨平台）
----
  npm install gitlab-b-center --registry http://172.16.3.201:4873/
  npx b-center init
  npx b-center start

环境变量见 config\env.example
