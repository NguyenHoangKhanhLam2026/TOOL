$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

Write-Host 'Auto English Reels Studio - environment setup' -ForegroundColor Green
$NodeVersion = node --version 2>$null
if (-not $NodeVersion) { throw 'Node.js was not found. Install Node.js 22.13 or newer, then run setup again.' }
Write-Host "Node: $NodeVersion"

$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCommand) { throw 'Python 3 was not found. Install Python, then run setup again.' }
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
  python -m venv .venv
}
$VenvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
# Use the installed pip to target this venv. Some Windows Python builds omit ensurepip.
python -m pip --python $VenvPython install -r 'packages\tts-engine\python\requirements.txt'
if ($LASTEXITCODE -ne 0) { throw 'Could not install edge-tts. Check the network connection and try again.' }

Write-Host ''
Write-Host 'Edge TTS is installed in the project virtual environment.' -ForegroundColor Green
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
  Write-Host 'FFmpeg/FFprobe are missing from PATH. Install FFmpeg, open a new terminal, then run npm run setup.' -ForegroundColor Yellow
  Write-Host 'Example: winget install --id Gyan.FFmpeg.Shared --exact'
}
Write-Host 'SQLite is built into Node.js 22.13 or newer; no separate database install is needed.'
Write-Host 'Next: npm run setup, then start.bat.'
