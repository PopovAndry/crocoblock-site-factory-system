$repoRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $PSScriptRoot "..\..")
)

$unstaged = @(& git -C $repoRoot diff --check 2>&1)
$unstagedExit = $LASTEXITCODE

$staged = @(& git -C $repoRoot diff --cached --check 2>&1)
$stagedExit = $LASTEXITCODE

if ($unstagedExit -eq 0 -and $stagedExit -eq 0) {
    exit 0
}

$lines = @()

if ($unstagedExit -ne 0) {
    $lines += "unstaged:"
    $lines += $unstaged
}

if ($stagedExit -ne 0) {
    $lines += "staged:"
    $lines += $staged
}

$details = (($lines | Select-Object -First 20) -join "`n")

if ($details.Length -gt 1800) {
    $details = $details.Substring(0, 1800) + "`n...[truncated]"
}

$message = @"
CSF lightweight Git check found diff problems.

$details

Review the affected diff before declaring the slice ready.
"@

@{
    continue      = $true
    systemMessage = $message.Trim()
} | ConvertTo-Json -Compress
