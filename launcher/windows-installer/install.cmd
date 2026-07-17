@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "PACKAGE_ROOT=%~dp0.."
set "INSTALL_ROOT=%LOCALAPPDATA%\Programs\Crocoblock Site Factory"
set "DATA_ROOT=%LOCALAPPDATA%\Crocoblock Site Factory"
set "PROJECTS_ROOT=%USERPROFILE%\Documents\Factory Projects"

:parse
if "%~1"=="" goto install
if /I "%~1"=="--install-root" (
  set "INSTALL_ROOT=%~2"
  shift
  shift
  goto parse
)
if /I "%~1"=="--data-root" (
  set "DATA_ROOT=%~2"
  shift
  shift
  goto parse
)
if /I "%~1"=="--projects-root" (
  set "PROJECTS_ROOT=%~2"
  shift
  shift
  goto parse
)
echo Unsupported installer argument.
exit /b 2

:install
if not exist "%PACKAGE_ROOT%\FactoryLauncher.exe" (
  echo Factory Launcher package files are missing.
  exit /b 1
)
mkdir "%INSTALL_ROOT%" 2>nul
robocopy "%PACKAGE_ROOT%" "%INSTALL_ROOT%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Factory Launcher files could not be installed.
  exit /b 1
)
"%INSTALL_ROOT%\FactoryLauncher.exe" "%INSTALL_ROOT%\app\launcher\src\windows-package-main.js" --configure --data-root "%DATA_ROOT%" --projects-root "%PROJECTS_ROOT%"
if errorlevel 1 (
  echo Factory Launcher settings could not be saved.
  exit /b 1
)
cscript //nologo "%INSTALL_ROOT%\installer\create-shortcut.vbs" "%INSTALL_ROOT%" >nul
echo Factory Launcher is installed.
exit /b 0
