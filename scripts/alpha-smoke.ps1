[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Slug,
  [ValidateSet("generated-site", "full-alpha")][string]$Require = "generated-site",
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LauncherCommand = Join-Path $RepoRoot "launcher\src\cli.js"

if (-not (Test-Path $LauncherCommand)) {
  throw "Launcher CLI not found at $LauncherCommand"
}

$arguments = @(
  $LauncherCommand,
  "alpha-smoke",
  "--slug", $Slug,
  "--require", $Require
)

if ($Json) {
  $arguments += "--json"
}

& node @arguments
exit $LASTEXITCODE
