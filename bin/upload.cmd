@echo off
setlocal
cd /d "%~dp0.."
node scripts\upload.mjs %*
exit /b %ERRORLEVEL%
