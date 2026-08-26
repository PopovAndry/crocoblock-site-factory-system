@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "INSTALL_ROOT=%%~fI"
if not defined INSTALL_ROOT (
  echo Crocoblock Site Factory installation root is invalid.
  exit /b 1
)
for %%I in ("%INSTALL_ROOT%") do set "INSTALL_DRIVE_ROOT=%%~dI\"
if /I "%INSTALL_ROOT%"=="%INSTALL_DRIVE_ROOT%" (
  echo Refusing to remove a drive root.
  exit /b 1
)
if not exist "%INSTALL_ROOT%\installer\.factory-install-root" (
  echo Crocoblock Site Factory installation ownership marker is missing.
  exit /b 1
)
if not exist "%INSTALL_ROOT%\Crocoblock Site Factory.exe" (
  echo Crocoblock Site Factory executable is missing.
  exit /b 1
)
if not exist "%INSTALL_ROOT%\resources\package-manifest.json" (
  echo Crocoblock Site Factory package manifest is missing.
  exit /b 1
)
if not exist "%INSTALL_ROOT%\installer\uninstall-cleanup.ps1" (
  echo Crocoblock Site Factory cleanup helper is missing.
  exit /b 1
)
"%INSTALL_ROOT%\Crocoblock Site Factory.exe" "%INSTALL_ROOT%\app\launcher\src\windows-package-main.js" --shutdown >nul 2>&1
set "CLEANUP_ROOT=%TEMP%\CrocoblockSiteFactory-Uninstall-%RANDOM%-%RANDOM%-%RANDOM%"
if exist "%CLEANUP_ROOT%\" (
  echo Crocoblock Site Factory could not prepare external cleanup.
  exit /b 1
)
mkdir "%CLEANUP_ROOT%" 2>nul
if not exist "%CLEANUP_ROOT%\" (
  echo Crocoblock Site Factory could not prepare external cleanup.
  exit /b 1
)
set "CLEANUP_SCRIPT=%CLEANUP_ROOT%\uninstall-cleanup.ps1"
copy /y "%INSTALL_ROOT%\installer\uninstall-cleanup.ps1" "%CLEANUP_SCRIPT%" >nul
if errorlevel 1 (
  echo Crocoblock Site Factory could not prepare external cleanup.
  exit /b 1
)
set "FACTORY_UNINSTALL_ROOT=%INSTALL_ROOT%"
cd /d "%SystemRoot%"
echo Crocoblock Site Factory removal started. The external cleanup will report the verified result.
start "" /b powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CLEANUP_SCRIPT%"
exit /b 0
