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
if errorlevel 1 (
  echo Node.js chua dat phien ban yeu cau.
  pause
  exit /b 1
)
start "Auto English Reels Studio - Server" /min cmd /c "cd /d ""%~dp0"" && node src\server.mjs"
start "Auto English Reels Studio - Worker" /min cmd /c "cd /d ""%~dp0"" && node src\workers\worker.mjs"
timeout /t 2 /nobreak >nul
start "" "http://localhost:3001"
echo Ung dung dang chay tai http://localhost:3001
echo Dong cua so server va worker de dung hoan toan.
endlocal
