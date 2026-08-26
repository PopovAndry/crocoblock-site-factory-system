@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul

set "PACKAGE_ROOT=%~dp0.."
set "PRODUCT_NAME=Crocoblock Site Factory"
set "PRODUCT_DIRECTORY_NAME=Crocoblock Site Factory"
set "DATA_ROOT="
set "PROJECTS_ROOT="
set "DATA_ROOT_SET="
set "PROJECTS_ROOT_SET="

:parse
if [%1]==[] goto install
if "%~1"=="" (
  echo Installer argument is invalid.
  exit /b 2
)
if /I "%~1"=="--data-root" goto parse_data_root
if /I "%~1"=="--projects-root" goto parse_projects_root
echo Unsupported installer argument.
exit /b 2

:parse_data_root
if defined DATA_ROOT_SET (
  echo Installer argument is duplicated.
  exit /b 2
)
if "%~2"=="" (
  echo Installer argument value is missing.
  exit /b 2
)
set "FACTORY_ARGUMENT_VALUE=%~2"
if "%FACTORY_ARGUMENT_VALUE:~0,1%"=="-" goto invalid_argument_value
if "%FACTORY_ARGUMENT_VALUE:~0,1%"=="/" goto invalid_argument_value
set "DATA_ROOT=%~2"
set "DATA_ROOT_SET=1"
set "FACTORY_ARGUMENT_VALUE="
shift
shift
goto parse

:parse_projects_root
if defined PROJECTS_ROOT_SET (
  echo Installer argument is duplicated.
  exit /b 2
)
if "%~2"=="" (
  echo Installer argument value is missing.
  exit /b 2
)
set "FACTORY_ARGUMENT_VALUE=%~2"
if "%FACTORY_ARGUMENT_VALUE:~0,1%"=="-" goto invalid_argument_value
if "%FACTORY_ARGUMENT_VALUE:~0,1%"=="/" goto invalid_argument_value
set "PROJECTS_ROOT=%~2"
set "PROJECTS_ROOT_SET=1"
set "FACTORY_ARGUMENT_VALUE="
shift
shift
goto parse

:invalid_argument_value
set "FACTORY_ARGUMENT_VALUE="
echo Installer argument value is invalid.
exit /b 2

:install
call :resolve_trusted_paths
if errorlevel 1 (
  echo Windows known folders could not be resolved.
  exit /b 1
)
set "INSTALL_ROOT=%TRUSTED_LOCAL_APPDATA%\Programs\%PRODUCT_DIRECTORY_NAME%"
set "SHORTCUT_DIR=%TRUSTED_ROAMING_APPDATA%\Microsoft\Windows\Start Menu\Programs\%PRODUCT_NAME%"
if not defined DATA_ROOT set "DATA_ROOT=%TRUSTED_LOCAL_APPDATA%\%PRODUCT_NAME%"
if not defined PROJECTS_ROOT set "PROJECTS_ROOT=%TRUSTED_DOCUMENTS%\Factory Projects"

if not exist "%PACKAGE_ROOT%\%PRODUCT_NAME%.exe" (
  echo Crocoblock Site Factory package files are missing.
  exit /b 1
)
if exist "%INSTALL_ROOT%\" (
  if not exist "%INSTALL_ROOT%\installer\.factory-install-root" (
    for /f "delims=" %%F in ('dir /a /b "%INSTALL_ROOT%" 2^>nul') do (
      echo The installation root must be empty or owned by Crocoblock Site Factory.
      exit /b 1
    )
  )
)
mkdir "%INSTALL_ROOT%" 2>nul
if errorlevel 1 (
  echo Factory Launcher files could not be installed.
  exit /b 1
)
robocopy "%PACKAGE_ROOT%" "%INSTALL_ROOT%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Factory Launcher files could not be installed.
  exit /b 1
)
> "%INSTALL_ROOT%\installer\.factory-install-root" echo Crocoblock Site Factory installer-owned directory
"%INSTALL_ROOT%\%PRODUCT_NAME%.exe" "%INSTALL_ROOT%\app\launcher\src\windows-package-main.js" --configure --data-root "%DATA_ROOT%" --projects-root "%PROJECTS_ROOT%"
if errorlevel 1 (
  echo Factory Launcher settings could not be saved.
  exit /b 1
)
call :create_trusted_shortcut
if errorlevel 1 (
  echo Crocoblock Site Factory shortcut could not be created.
  exit /b 1
)
echo Crocoblock Site Factory is installed.
exit /b 0

:resolve_trusted_paths
set "TRUSTED_LOCAL_APPDATA="
set "TRUSTED_ROAMING_APPDATA="
set "TRUSTED_DOCUMENTS="
set "TRUSTED_LOCAL_APPDATA_COUNT=0"
set "TRUSTED_ROAMING_APPDATA_COUNT=0"
set "TRUSTED_DOCUMENTS_COUNT=0"
set "TRUSTED_RESOLVER_EXIT="
set "TRUSTED_RESOLVER_EXIT_COUNT=0"
set "TRUSTED_RESOLVER_HELPER=%~dp0uninstall-cleanup.ps1"
for /f "tokens=1,* delims=|" %%A in ('powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; try { $info = New-Object Diagnostics.ProcessStartInfo; $info.FileName = 'powershell.exe'; $info.UseShellExecute = $false; $info.RedirectStandardOutput = $true; $info.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + [char]34 + $env:TRUSTED_RESOLVER_HELPER + [char]34 + ' -Mode ResolveAndValidateInstallPaths'; $process = New-Object Diagnostics.Process; $process.StartInfo = $info; if (-not $process.Start()) { throw 'resolver_start_failed' }; $output = $process.StandardOutput.ReadToEnd(); $process.WaitForExit(); [Console]::Out.Write($output); [Console]::Out.WriteLine('RESOLVER_EXIT|' + $process.ExitCode) } catch { [Console]::Out.WriteLine('RESOLVER_EXIT|9009') }" 2^>nul') do (
  if /I "%%A"=="LOCAL" (
    set /a TRUSTED_LOCAL_APPDATA_COUNT+=1
    set "TRUSTED_LOCAL_APPDATA=%%B"
  )
  if /I "%%A"=="ROAMING" (
    set /a TRUSTED_ROAMING_APPDATA_COUNT+=1
    set "TRUSTED_ROAMING_APPDATA=%%B"
  )
  if /I "%%A"=="DOCUMENTS" (
    set /a TRUSTED_DOCUMENTS_COUNT+=1
    set "TRUSTED_DOCUMENTS=%%B"
  )
  if /I "%%A"=="RESOLVER_EXIT" (
    set /a TRUSTED_RESOLVER_EXIT_COUNT+=1
    set "TRUSTED_RESOLVER_EXIT=%%B"
  )
)
if not "%TRUSTED_LOCAL_APPDATA_COUNT%"=="1" exit /b 1
if not "%TRUSTED_ROAMING_APPDATA_COUNT%"=="1" exit /b 1
if not "%TRUSTED_DOCUMENTS_COUNT%"=="1" exit /b 1
if not "%TRUSTED_RESOLVER_EXIT_COUNT%"=="1" exit /b 1
if not defined TRUSTED_LOCAL_APPDATA exit /b 1
if not defined TRUSTED_ROAMING_APPDATA exit /b 1
if not defined TRUSTED_DOCUMENTS exit /b 1
if not "%TRUSTED_RESOLVER_EXIT%"=="0" exit /b 1
set "TRUSTED_RESOLVER_HELPER="
exit /b 0

:create_trusted_shortcut
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0uninstall-cleanup.ps1" -Mode CreateShortcut >nul
exit /b %errorlevel%
