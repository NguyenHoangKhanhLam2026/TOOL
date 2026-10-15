@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Khong tim thay Node.js trong PATH.
  pause
  exit /b 1
)
node tools\spawn-eperm-bot.mjs --start
set BOT_EXIT=%ERRORLEVEL%
echo.
pause
exit /b %BOT_EXIT%
