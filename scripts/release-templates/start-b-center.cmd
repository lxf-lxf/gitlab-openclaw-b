@echo off
setlocal
cd /d "%~dp0.."
set DOTENV_CONFIG_PATH=%CD%\config\.env
set NODE_ENV=production
set PORT=3000
if "%1"=="start" goto daemon
if "%1"=="stop" goto stop
cd app
echo Foreground: http://localhost:%PORT%/
node server\index.js
exit /b %ERRORLEVEL%

:daemon
cd app
start /B cmd /c "node server\index.js >> ..\data\logs\b-center.log 2>&1"
echo Started in background. Logs: data\logs\b-center.log
exit /b 0

:stop
taskkill /F /IM node.exe 2>nul
echo Stopped
exit /b 0
