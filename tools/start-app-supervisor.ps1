$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$port = if ($env:APP_PORT) { [int]$env:APP_PORT } else { 3001 }
$lockPath = Join-Path $root 'data\logs\app-supervisor.lock'
$replace = $false

try {
  $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/system" -TimeoutSec 8
  $restrictedSpawn = $status.tools.errors.ffmpeg -eq 'EPERM' -or $status.tools.errors.ffprobe -eq 'EPERM'
  $replace = !$status.worker -or $restrictedSpawn
  if (!$replace -and $status.tools.ffmpeg -and $status.tools.ffprobe) { exit 0 }
} catch {
  $replace = Test-Path -LiteralPath $lockPath
}

if ($replace -and (Test-Path -LiteralPath $lockPath)) {
  try {
    $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    $supervisorPid = [int]$owner.pid
    $supervisor = Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue
    if ($supervisor) {
      $lockStartedAt = [datetime]::Parse($owner.startedAt).ToUniversalTime()
      if ($supervisor.Path -ne $node -or $supervisor.StartTime.ToUniversalTime() -gt $lockStartedAt.AddSeconds(3)) {
        throw "PID $supervisorPid no longer matches the saved supervisor process."
      }
      $taskkill = (Get-Command taskkill.exe -ErrorAction Stop).Source
      $killOutput = & $taskkill /PID $supervisorPid /T /F 2>&1
      for ($attempt = 0; $attempt -lt 20 -and (Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue); $attempt++) {
        Start-Sleep -Milliseconds 250
      }
      if (Get-Process -Id $supervisorPid -ErrorAction SilentlyContinue) {
        throw "Windows refused to stop the old supervisor (taskkill exit $LASTEXITCODE): $killOutput"
      }
    }
  } catch {
    throw "Khong the thay the bo giam sat dang loi: $($_.Exception.Message)"
  }
}

Start-Process -FilePath $node -ArgumentList @('tools/app-supervisor.mjs') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
