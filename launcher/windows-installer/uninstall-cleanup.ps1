[CmdletBinding()]
param(
  [ValidateSet("Cleanup", "ResolveTrustedPaths", "ResolveAndValidateInstallPaths", "ValidateInstallPaths", "CreateShortcut")]
  [string]$Mode = "Cleanup"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ApplicationName = "Crocoblock Site Factory"
$InstallDirectoryName = "Crocoblock Site Factory"
$ExpectedArtifactLabel = "INTERNAL EVALUATION BUILD"
$ExpectedArchitecture = "x64"
$ResultPath = Join-Path $PSScriptRoot "uninstall-result.json"

function Write-CleanupResult {
  param(
    [string]$Status,
    [string]$Code,
    [string]$Message
  )

  $payload = [ordered]@{
    schema_version = 1
    status = $Status
    code = $Code
    message = $Message
    completed_at = [DateTime]::UtcNow.ToString("o")
  }
  [IO.File]::WriteAllText(
    $ResultPath,
    ($payload | ConvertTo-Json -Compress) + [Environment]::NewLine,
    (New-Object Text.UTF8Encoding($false))
  )
  Write-Host $Message
}

function Get-CanonicalPath {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathRooted($Value)) {
    throw "invalid_path"
  }
  $fullPath = [IO.Path]::GetFullPath($Value)
  $rootPath = [IO.Path]::GetPathRoot($fullPath)
  if ([string]::Equals($fullPath, $rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    return $rootPath
  }
  return $fullPath.TrimEnd([char[]]"\/")
}

if (-not ("CsfInstallerKnownFolders" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CsfInstallerKnownFolders {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  public static extern int SHGetKnownFolderPath(ref Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);
}
'@
}

$KnownFolderLocalAppData = [guid]"F1B32785-6FBA-4FCF-9D55-7B8E7F157091"
$KnownFolderRoamingAppData = [guid]"3EB685DB-65F9-4CF6-A03A-E3EF65729F3D"
$KnownFolderDocuments = [guid]"FDD39AD0-238F-46AF-ADB4-6C85480369C7"
$CurrentKnownFolderFlags = [uint32]0

function Get-TrustedKnownFolderPath {
  param([guid]$KnownFolderId)

  $allocated = [IntPtr]::Zero
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try {
    $status = [CsfInstallerKnownFolders]::SHGetKnownFolderPath(
      [ref]$KnownFolderId,
      $CurrentKnownFolderFlags,
      $identity.Token,
      [ref]$allocated
    )
  } finally {
    $identity.Dispose()
  }
  if ($status -ne 0 -or $allocated -eq [IntPtr]::Zero) {
    throw "known_folder_unavailable"
  }
  try {
    $resolved = [Runtime.InteropServices.Marshal]::PtrToStringUni($allocated)
  } finally {
    [Runtime.InteropServices.Marshal]::FreeCoTaskMem($allocated)
  }
  $canonical = Get-CanonicalPath $resolved
  if ([string]::IsNullOrWhiteSpace($canonical) -or (Test-SamePath $canonical ([IO.Path]::GetPathRoot($canonical)))) {
    throw "known_folder_invalid"
  }
  return $canonical
}

function Get-TrustedLayout {
  $localAppData = Get-TrustedKnownFolderPath $KnownFolderLocalAppData
  $roamingAppData = Get-TrustedKnownFolderPath $KnownFolderRoamingAppData
  $documents = Get-TrustedKnownFolderPath $KnownFolderDocuments
  $installParent = Get-CanonicalPath (Join-Path $localAppData "Programs")
  $installRoot = Get-CanonicalPath (Join-Path $installParent $InstallDirectoryName)
  $shortcutDirectory = Get-CanonicalPath (Join-Path $roamingAppData "Microsoft\Windows\Start Menu\Programs\$ApplicationName")
  [ordered]@{
    local_app_data = $localAppData
    roaming_app_data = $roamingAppData
    documents = $documents
    install_parent = $installParent
    install_root = $installRoot
    shortcut_directory = $shortcutDirectory
    shortcut_path = Join-Path $shortcutDirectory "$ApplicationName.lnk"
  }
}

function Test-IsSameOrDescendant {
  param([string]$Path, [string]$Boundary)

  $canonicalPath = Get-CanonicalPath $Path
  $canonicalBoundary = Get-CanonicalPath $Boundary
  if (Test-SamePath $canonicalPath $canonicalBoundary) {
    return $true
  }
  return $canonicalPath.StartsWith($canonicalBoundary.TrimEnd([char[]]"\\/") + "\", [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NormalExistingDirectory {
  param([string]$Path)

  if (-not [IO.Directory]::Exists($Path)) {
    throw "missing_directory"
  }
  $attributes = [IO.File]::GetAttributes($Path)
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "reparse_point"
  }
  if (($attributes -band [IO.FileAttributes]::Directory) -eq 0) {
    throw "unexpected_filesystem_type"
  }
}

function Assert-NormalDirectoryChain {
  param([string]$Boundary, [string]$Target)

  $canonicalBoundary = Get-CanonicalPath $Boundary
  $canonicalTarget = Get-CanonicalPath $Target
  if (-not (Test-IsSameOrDescendant $canonicalTarget $canonicalBoundary)) {
    throw "outside_trusted_boundary"
  }
  Assert-NormalExistingDirectory $canonicalBoundary
  $relative = $canonicalTarget.Substring($canonicalBoundary.Length).TrimStart([char[]]"\\/")
  if ([string]::IsNullOrWhiteSpace($relative)) {
    return
  }
  $current = $canonicalBoundary
  foreach ($component in ($relative -split "[\\/]+")) {
    $current = Join-Path $current $component
    if ([IO.Directory]::Exists($current)) {
      Assert-NormalExistingDirectory $current
      continue
    }
    if ([IO.File]::Exists($current)) {
      throw "unexpected_filesystem_type"
    }
    try {
      $attributes = [IO.File]::GetAttributes($current)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "reparse_point"
      }
      throw "unexpected_filesystem_type"
    } catch [IO.FileNotFoundException] {
      return
    } catch [IO.DirectoryNotFoundException] {
      return
    }
  }
}

function Assert-NormalFileOrAbsent {
  param([string]$Path)

  try {
    $attributes = [IO.File]::GetAttributes($Path)
  } catch [IO.FileNotFoundException] {
    return $false
  } catch [IO.DirectoryNotFoundException] {
    return $false
  }
  if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "reparse_point"
  }
  if (($attributes -band [IO.FileAttributes]::Directory) -ne 0) {
    throw "unexpected_filesystem_type"
  }
  return $true
}

function Assert-TrustedLayout {
  param([System.Collections.IDictionary]$Layout)

  Assert-NormalDirectoryChain $Layout.local_app_data $Layout.install_parent
  Assert-NormalDirectoryChain $Layout.install_parent $Layout.install_root
  Assert-NormalDirectoryChain $Layout.roaming_app_data $Layout.shortcut_directory
  [void](Assert-NormalFileOrAbsent $Layout.shortcut_path)
}

function Write-TrustedLayoutRecords {
  param([System.Collections.IDictionary]$Layout)

  Write-Output ("LOCAL|" + $Layout.local_app_data)
  Write-Output ("ROAMING|" + $Layout.roaming_app_data)
  Write-Output ("DOCUMENTS|" + $Layout.documents)
}

function Resolve-AndValidateInstallPaths {
  $layout = Get-TrustedLayout
  Assert-TrustedLayout $layout
  if ([IO.Directory]::Exists($layout.install_root)) {
    Assert-NoReparsePoints $layout.install_root
  }
  Write-TrustedLayoutRecords $layout
}

function Test-SamePath {
  param([string]$Left, [string]$Right)
  return [string]::Equals(
    (Get-CanonicalPath $Left),
    (Get-CanonicalPath $Right),
    [StringComparison]::OrdinalIgnoreCase
  )
}

function Assert-NoReparsePoints {
  param([string]$RootPath)

  $root = New-Object IO.DirectoryInfo($RootPath)
  if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "reparse_point"
  }
  $pending = New-Object "Collections.Generic.Stack[IO.DirectoryInfo]"
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    foreach ($entry in $directory.EnumerateFileSystemInfos()) {
      if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "reparse_point"
      }
      if ($entry -is [IO.DirectoryInfo]) {
        $pending.Push($entry)
      }
    }
  }
}

function Get-RemovalTimeoutSeconds {
  $requested = 15
  if (-not [string]::IsNullOrWhiteSpace($env:FACTORY_UNINSTALL_TIMEOUT_SECONDS)) {
    $parsed = 0
    if ([int]::TryParse($env:FACTORY_UNINSTALL_TIMEOUT_SECONDS, [ref]$parsed) -and $parsed -ge 1 -and $parsed -le 30) {
      $requested = $parsed
    }
  }
  return $requested
}

function Assert-InstallationIdentity {
  param([System.Collections.IDictionary]$Layout)

  $installRoot = $Layout.install_root
  Assert-NoReparsePoints $installRoot
  $markerPath = Join-Path $installRoot "installer\.factory-install-root"
  $manifestPath = Join-Path $installRoot "resources\package-manifest.json"
  $executablePath = Join-Path $installRoot "$ApplicationName.exe"
  if (-not (Assert-NormalFileOrAbsent $markerPath) -or -not (Assert-NormalFileOrAbsent $manifestPath) -or -not (Assert-NormalFileOrAbsent $executablePath)) {
    throw "missing_package_identity"
  }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (
    $manifest.application_name -ne $ApplicationName -or
    $manifest.architecture -ne $ExpectedArchitecture -or
    $manifest.artifact_label -ne $ExpectedArtifactLabel
  ) {
    throw "invalid_package_manifest"
  }
  return $executablePath
}

function New-TrustedShortcut {
  $layout = Get-TrustedLayout
  Assert-TrustedLayout $layout
  Assert-NormalExistingDirectory $layout.install_root
  Assert-NoReparsePoints $layout.install_root
  if (-not [IO.Directory]::Exists($layout.shortcut_directory)) {
    [IO.Directory]::CreateDirectory($layout.shortcut_directory) | Out-Null
  }
  Assert-TrustedLayout $layout
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($layout.shortcut_path)
  $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
  $shortcut.Arguments = [char]34 + (Join-Path $layout.install_root "installer\launch.vbs") + [char]34
  $shortcut.WorkingDirectory = $layout.install_root
  $shortcut.Description = "$ApplicationName - Internal Evaluation Build"
  $shortcut.Save()
  if (-not (Assert-NormalFileOrAbsent $layout.shortcut_path)) {
    throw "shortcut_missing"
  }
}

function Invoke-Cleanup {
  $layout = Get-TrustedLayout
  Assert-TrustedLayout $layout
  $installRoot = $layout.install_root
  $executablePath = Join-Path $installRoot "$ApplicationName.exe"
  if ([IO.Directory]::Exists($installRoot)) {
    $executablePath = Assert-InstallationIdentity $layout
    $timeoutSeconds = Get-RemovalTimeoutSeconds
    $processDeadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    do {
      $running = @(
        Get-Process -Name $ApplicationName -ErrorAction SilentlyContinue |
          Where-Object {
            try {
              Test-SamePath $_.Path $executablePath
            } catch {
              $false
            }
          }
      )
      if ($running.Count -eq 0) {
        break
      }
      Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $processDeadline)
    if ($running.Count -gt 0) {
      throw "process_timeout"
    }
  } else {
    $timeoutSeconds = Get-RemovalTimeoutSeconds
  }

  if (Assert-NormalFileOrAbsent $layout.shortcut_path) {
    [IO.File]::Delete($layout.shortcut_path)
    if (Assert-NormalFileOrAbsent $layout.shortcut_path) {
      throw "shortcut_cleanup_failed"
    }
  }
  if ([IO.Directory]::Exists($layout.shortcut_directory) -and [IO.Directory]::GetFileSystemEntries($layout.shortcut_directory).Count -eq 0) {
    [IO.Directory]::Delete($layout.shortcut_directory)
  }

  $removalDeadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
  do {
    try {
      if ([IO.Directory]::Exists($installRoot)) {
        [IO.Directory]::Delete($installRoot, $true)
      }
    } catch {
      # The original batch file may still be releasing its handle.
    }
    if (-not [IO.Directory]::Exists($installRoot)) {
      break
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $removalDeadline)

  if ([IO.Directory]::Exists($installRoot) -or [IO.File]::Exists($executablePath) -or (Assert-NormalFileOrAbsent $layout.shortcut_path)) {
    throw "cleanup_failed"
  }
}

if ($Mode -ne "Cleanup") {
  try {
    if ($Mode -eq "ResolveTrustedPaths") {
      $layout = Get-TrustedLayout
      Write-TrustedLayoutRecords $layout
    } elseif ($Mode -eq "ResolveAndValidateInstallPaths") {
      Resolve-AndValidateInstallPaths
    } elseif ($Mode -eq "ValidateInstallPaths") {
      $layout = Get-TrustedLayout
      Assert-TrustedLayout $layout
      if ([IO.Directory]::Exists($layout.install_root)) {
        Assert-NoReparsePoints $layout.install_root
      }
    } elseif ($Mode -eq "CreateShortcut") {
      New-TrustedShortcut
    }
    exit 0
  } catch {
    [Console]::Error.WriteLine("Trusted installer path validation failed.")
    exit 1
  }
}

try {
  Invoke-Cleanup
  Write-CleanupResult "succeeded" "removed" "Crocoblock Site Factory was removed. Factory projects and application data were preserved."
  exit 0
} catch {
  Write-CleanupResult "failed" "cleanup_failed" "Crocoblock Site Factory could not be removed. Factory projects and application data were not targeted."
  exit 1
}
