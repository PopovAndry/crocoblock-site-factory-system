Option Explicit

Dim shell, fso, installRoot, executablePath, entryPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
installRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
executablePath = fso.BuildPath(installRoot, "FactoryLauncher.exe")
entryPath = fso.BuildPath(installRoot, "app\launcher\src\windows-package-main.js")
shell.Run Chr(34) & executablePath & Chr(34) & " " & Chr(34) & entryPath & Chr(34) & " --launch", 0, False
