[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ProjectsRoot = "C:\sf-factory-projects"
$VendorRoot = "C:\sf-vendor"
$AlphaProjects = @(
  "alpha-e2e-smoke-1",
  "alpha-v01-fresh-smoke-1"
)
$VendorZips = @(
  @{ Name = "kava.zip"; Path = Join-Path $VendorRoot "kava.zip" },
  @{ Name = "jet-engine.zip"; Path = Join-Path $VendorRoot "jet-engine.zip" },
  @{ Name = "jet-smart-filters.zip"; Path = Join-Path $VendorRoot "jet-smart-filters.zip" }
)

$script:HasFail = $false
$script:HasWarn = $false

function Write-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Level,
    [Parameter(Mandatory = $true)][string]$Message
  )

  Write-Output ("[{0}] {1}" -f $Level.ToUpperInvariant(), $Message)
  if ($Level -eq "FAIL") {
    $script:HasFail = $true
  } elseif ($Level -eq "WARN") {
    $script:HasWarn = $true
  }
}

function Test-Command {
  param(
    [Parameter(Mandatory = $true)][string]$Name
  )

  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-CommandVersion {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$ScriptBlock
  )

  try {
    return (& $ScriptBlock 2>$null | Select-Object -First 1)
  } catch {
    return $null
  }
}

function Format-Value {
  param(
    [Parameter(Mandatory = $false)]$Value,
    [Parameter(Mandatory = $true)][string]$Fallback
  )

  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    return $Fallback
  }

  return [string]$Value
}

Write-Output "Factory Preflight"
Write-Output ("Repo: {0}" -f $RepoRoot)
Write-Output ""

if (Test-Path $RepoRoot) {
  Write-Check "PASS" ("Repo path: {0}" -f $RepoRoot)
} else {
  Write-Check "FAIL" ("Repo path missing: {0}" -f $RepoRoot)
}

if (Test-Command "node") {
  $nodeVersion = Get-CommandVersion { node --version }
  Write-Check "PASS" ("Node: {0}" -f (Format-Value -Value $nodeVersion -Fallback "available"))
} else {
  Write-Check "FAIL" "Node: not found"
}

$packageJsonPath = Join-Path $RepoRoot "package.json"
if (Test-Path $packageJsonPath) {
  if (Test-Command "npm") {
    $npmVersion = Get-CommandVersion { npm --version }
    Write-Check "PASS" ("npm: {0}" -f (Format-Value -Value $npmVersion -Fallback "available"))
  } else {
    Write-Check "FAIL" "npm: package.json exists but npm is not available"
  }
} else {
  Write-Check "PASS" "npm: not required because package.json is absent"
}

if (Test-Command "docker") {
  $dockerVersion = Get-CommandVersion { docker --version }
  Write-Check "PASS" ("Docker: {0}" -f (Format-Value -Value $dockerVersion -Fallback "available"))
} else {
  Write-Check "FAIL" "Docker: not found"
}

$composeVersion = $null
if (Test-Command "docker") {
  $composeVersion = Get-CommandVersion { docker compose version }
}
if (-not $composeVersion -and (Test-Command "docker-compose")) {
  $composeVersion = Get-CommandVersion { docker-compose version }
}
if ($composeVersion) {
  Write-Check "PASS" ("Docker Compose: {0}" -f $composeVersion)
} else {
  Write-Check "FAIL" "Docker Compose: neither 'docker compose' nor 'docker-compose' is available"
}

if (Test-Command "git") {
  $gitVersion = Get-CommandVersion { git --version }
  Write-Check "PASS" ("Git: {0}" -f (Format-Value -Value $gitVersion -Fallback "available"))
} else {
  Write-Check "FAIL" "Git: not found"
}

$cliPath = Join-Path $RepoRoot "launcher\src\cli.js"
if (Test-Path $cliPath) {
  Write-Check "PASS" ("Launcher CLI: {0}" -f $cliPath)
} else {
  Write-Check "FAIL" ("Launcher CLI missing: {0}" -f $cliPath)
}

if (Test-Path $ProjectsRoot) {
  Write-Check "PASS" ("Projects root: {0}" -f $ProjectsRoot)
} else {
  Write-Check "FAIL" ("Projects root missing: {0}. Create or restore the local runtime root before evaluation." -f $ProjectsRoot)
}

foreach ($vendorZip in $VendorZips) {
  if (Test-Path $vendorZip.Path) {
    Write-Check "PASS" ("Vendor ZIP: {0}" -f $vendorZip.Name)
  } else {
    Write-Check "FAIL" ("Vendor ZIP missing: {0}" -f $vendorZip.Path)
  }
}

foreach ($slug in $AlphaProjects) {
  $projectPath = Join-Path $ProjectsRoot $slug
  if (Test-Path $projectPath) {
    Write-Check "PASS" ("Project present: {0}" -f $slug)
    $aiEnvPath = Join-Path $projectPath "secrets\ai.env"
    if (Test-Path $aiEnvPath) {
      Write-Check "FAIL" ("secrets/ai.env present: {0}" -f $slug)
    } else {
      Write-Check "PASS" ("secrets/ai.env absent: {0}" -f $slug)
    }
  } else {
    Write-Check "WARN" ("Project not found: {0}" -f $slug)
  }
}

Write-Output ""
if ($script:HasFail) {
  Write-Output "Final: FAIL"
  exit 1
}
if ($script:HasWarn) {
  Write-Output "Final: WARN"
  exit 0
}
Write-Output "Final: PASS"
exit 0
