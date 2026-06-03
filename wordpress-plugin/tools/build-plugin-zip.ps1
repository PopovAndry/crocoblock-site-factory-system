param(
	[string] $OutputDir = "",
	[string] $ZipName = "crocoblock-site-factory-v0.2-beta-git.zip"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
	$OutputDir = Join-Path $RepoRoot "build"
}

$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$ZipPath = Join-Path $OutputDir $ZipName

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Test-Path $ZipPath) {
	Remove-Item -LiteralPath $ZipPath -Force
}

Push-Location $RepoRoot
try {
	git archive --format=zip --prefix="crocoblock-site-factory/" --output="$ZipPath" HEAD
}
finally {
	Pop-Location
}

$ZipItem = Get-Item -LiteralPath $ZipPath
$SizeMb = [Math]::Round($ZipItem.Length / 1MB, 2)

Write-Host "Plugin ZIP: $($ZipItem.FullName)"
Write-Host "Size: $SizeMb MB"
