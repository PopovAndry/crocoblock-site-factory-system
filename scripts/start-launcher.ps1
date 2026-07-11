[CmdletBinding()]
param(
  [switch]$SkipPreflight,
  [int]$Port = 3847
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PreflightScript = Join-Path $PSScriptRoot "factory-preflight.ps1"
$LauncherCommand = Join-Path $RepoRoot "launcher\src\cli.js"

if (-not (Test-Path $LauncherCommand)) {
  throw "Launcher CLI not found at $LauncherCommand"
}

if (-not $SkipPreflight) {
  if (-not (Test-Path $PreflightScript)) {
    throw "Preflight script not found at $PreflightScript"
  }

  Write-Output "Running Factory preflight..."
  & powershell -ExecutionPolicy Bypass -File $PreflightScript
  if ($LASTEXITCODE -ne 0) {
    throw "Preflight failed. Fix the reported FAIL items before starting Launcher."
  }
}

$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingListener) {
  throw ("Launcher port {0} is already in use by PID {1}. Stop the stale Launcher process or choose another port with -Port." -f $Port, $existingListener.OwningProcess)
}

Set-Location $RepoRoot

Write-Output ("Starting Factory Launcher on http://127.0.0.1:{0}" -f $Port)
Write-Output "In another terminal you can run:"
Write-Output "  node launcher/src/cli.js alpha-smoke --slug alpha-v01-fresh-smoke-1"
Write-Output ""

& node $LauncherCommand start --port $Port
exit $LASTEXITCODE
