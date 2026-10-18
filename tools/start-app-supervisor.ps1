$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
$port = if ($env:APP_PORT) { [int]$env:APP_PORT } else { 3001 }
$lockPath = Join-Path $root 'data\logs\app-supervisor.lock'
$replace = $false
$runtimeChanged = $false
$activeJobs = @()

try {
  $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/system" -TimeoutSec 8
  $restrictedSpawn = $status.tools.errors.ffmpeg -eq 'EPERM' -or $status.tools.errors.ffprobe -eq 'EPERM'
  $replace = !$status.worker -or $restrictedSpawn

  # Restart a healthy process if it serves an older runtime than the source on disk.
  if (!$status.PSObject.Properties.Name.Contains('styleBertVits2') -or !$status.PSObject.Properties.Name.Contains('cosyVoice3')) {
    $replace = $true
    $runtimeChanged = $true
  }
  try {
    $jobStatus = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/jobs" -TimeoutSec 5
    $activeJobs = @($jobStatus.jobs | Where-Object { $_.status -eq 'running' })
  } catch { $activeJobs = @() }
  if (Test-Path -LiteralPath $lockPath) {
    try {
      $owner = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
      $startedAt = [datetime]::Parse($owner.startedAt).ToUniversalTime()
      $sourceRoots = @((Join-Path $root 'src'), (Join-Path $root 'packages')) | Where-Object { Test-Path -LiteralPath $_ }
      $latestRuntimeSource = Get-ChildItem -LiteralPath $sourceRoots -Recurse -File -ErrorAction Stop |
        Where-Object { $_.Extension -in '.mjs', '.js', '.cjs', '.py' } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
      if ($latestRuntimeSource -and $latestRuntimeSource.LastWriteTimeUtc -gt $startedAt.AddSeconds(1)) {
        $replace = $true
        $runtimeChanged = $true
      }
    } catch {
      $replace = $true
    }
  }

  if (!$replace -and $status.tools.ffmpeg -and $status.tools.ffprobe) { exit 0 }
} catch {
  $replace = Test-Path -LiteralPath $lockPath
}

# Refresh only the HTTP server while a render is active; the supervisor then
# relaunches it, while the independent worker and its current job keep running.
if ($runtimeChanged -and $activeJobs.Count -gt 0 -and $status.worker -and !$restrictedSpawn) {
  $netstat = (Get-Command netstat.exe -ErrorAction Stop).Source
  $listener = & $netstat -ano -p tcp | ForEach-Object {
    $match = [regex]::Match($_, "^\s*TCP\s+\S+:$port\s+\S+\s+LISTENING\s+(\d+)\s*$")
    if ($match.Success) { [int]$match.Groups[1].Value }
  } | Select-Object -First 1
  if (!$listener) { throw "An active job exists, but no server listener was found on port $port. The worker was left untouched." }
  $serverProcess = Get-Process -Id ([int]$listener) -ErrorAction Stop
  if ($serverProcess.Path -ne $node) { throw "The listener on port $port is not the application's Node process. The worker was left untouched." }
  & $node -e "process.kill(Number(process.argv[1]), 'SIGTERM')" ([string]$listener)
  if ($LASTEXITCODE -ne 0) { throw "Could not request a server restart. The worker was left untouched." }
  Write-Output "Requested a server-only restart; the worker continues job $($activeJobs[0].id)."
  exit 0
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
    throw "Could not replace the unhealthy supervisor: $($_.Exception.Message)"
  }
}

Start-Process -FilePath $node -ArgumentList @('tools/app-supervisor.mjs') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
