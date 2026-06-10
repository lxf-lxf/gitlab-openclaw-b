@echo off
setlocal
cd /d "%~dp0.."
if not exist config\.env (
  copy /Y config\env.example config\.env
  echo Created config\.env
) else (
  echo config\.env already exists
)
cd app
call npm ci --omit=dev 2>nul || call npm install --omit=dev
cd ..
echo.
echo Install done. Edit config\.env then:
echo   bin\start-b-center.cmd start
exit /b 0
