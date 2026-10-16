$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList @('tools/spawn-eperm-bot.mjs', '--watch') -WorkingDirectory $root -WindowStyle Hidden
