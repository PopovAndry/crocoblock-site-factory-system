Factory Launcher development package

1. Extract the package to a temporary folder.
2. Run installer\install.cmd. Optionally pass --projects-root "<existing Factory projects folder>".
3. Start Factory Launcher from the Start menu shortcut.
4. To close a running package from a command prompt, run:
   FactoryLauncher.exe app\launcher\src\windows-package-main.js --shutdown

Uninstall removes application files and the Start menu shortcut only. It preserves Factory projects and application data.

This is an early development package. It does not install or update Docker, WordPress, databases, or dependencies.
