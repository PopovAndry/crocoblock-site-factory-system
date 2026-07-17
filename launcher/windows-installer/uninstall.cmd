@echo off
setlocal EnableExtensions DisableDelayedExpansion

for %%I in ("%~dp0..") do set "INSTALL_ROOT=%%~fI"
cscript //nologo "%~dp0remove-shortcut.vbs" >nul
cd /d "%SystemRoot%"
echo Factory Launcher application files were removed. Factory project and application data were preserved.
start "" /b cmd.exe /d /c "rmdir /s /q ""%INSTALL_ROOT%"""
exit /b 0
