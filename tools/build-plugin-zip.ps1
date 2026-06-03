param(
	[string] $OutputDir = "",
	[string] $ZipName = ""
)

$ErrorActionPreference = "Stop"

$SystemRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$PluginTree = "HEAD:wordpress-plugin"
$ShortSha = (git -C $SystemRoot rev-parse --short HEAD).Trim()

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
	$OutputDir = Join-Path $SystemRoot "build"
}

if ([string]::IsNullOrWhiteSpace($ZipName)) {
	$ZipName = "crocoblock-site-factory-v0.2-beta-system-$ShortSha.zip"
}

$OutputDir = [System.IO.Path]::GetFullPath($OutputDir)
$ZipPath = Join-Path $OutputDir $ZipName

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (Test-Path $ZipPath) {
	Remove-Item -LiteralPath $ZipPath -Force
}

git -C $SystemRoot archive `
	--format=zip `
	--prefix="crocoblock-site-factory/" `
	--output="$ZipPath" `
	$PluginTree

$ZipItem = Get-Item -LiteralPath $ZipPath
$SizeMb = [Math]::Round($ZipItem.Length / 1MB, 2)

Write-Host "Plugin ZIP: $($ZipItem.FullName)"
Write-Host "Source tree: wordpress-plugin/"
Write-Host "Archive root: crocoblock-site-factory/"
Write-Host "Commit: $ShortSha"
Write-Host "Size: $SizeMb MB"
