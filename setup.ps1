$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

Write-Host 'Auto English Reels Studio - local TTS setup' -ForegroundColor Green
$NodeVersion = node --version 2>$null
if (-not $NodeVersion) { throw 'Node.js was not found. Install Node.js 22.13 or newer, then run setup again.' }
Write-Host "Node: $NodeVersion"

Write-Host 'Microsoft Edge TTS has been removed. The studio uses local TTS models.' -ForegroundColor Green
Write-Host 'Install only the models you need:'
Write-Host '  npm run setup:vieneu'
Write-Host '  npm run setup:kokoro'
Write-Host '  npm run setup:multilingual-tts'
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe -ErrorAction SilentlyContinue)) {
  Write-Host 'FFmpeg/FFprobe are missing from PATH. Install FFmpeg, open a new terminal, then run npm run setup.' -ForegroundColor Yellow
  Write-Host 'Example: winget install --id Gyan.FFmpeg.Shared --exact'
}
Write-Host 'SQLite is built into Node.js 22.13 or newer; no separate database install is needed.'
Write-Host 'Next: npm run setup, then start.bat.'
