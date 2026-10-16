@echo off
setlocal
cd /d "%~dp0"
for /d %%F in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg.Shared_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-*\bin") do if exist "%%~fF\ffmpeg.exe" set "PATH=%%~fF;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Chua tim thay Node.js. Cai Node.js 22.13 tro len truoc.
  pause
  exit /b 1
)
echo Dang kiem tra moi truong...
node scripts\setup-check.mjs
if errorlevel 2 (
  echo.
  echo Windows is blocking child-process creation with error EPERM.
  echo Close this window and run start.bat from File Explorer or a regular Windows session.
  pause
  exit /b 1
)
if errorlevel 1 (
  echo Node.js chua dat phien ban yeu cau.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-app-supervisor.ps1"
if errorlevel 1 (
  echo Khong khoi dong duoc bo giam sat server va worker.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-spawn-eperm-bot.ps1"
node tools\wait-for-app.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3001"
echo Ung dung dang chay tai http://127.0.0.1:3001
echo Server va worker se tu khoi dong lai neu bi dung dot ngot.
endlocal
