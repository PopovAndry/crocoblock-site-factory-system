Option Explicit

Dim shell, fso, installRoot, programsPath, shortcutPath, shortcut
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
installRoot = WScript.Arguments(0)
programsPath = shell.SpecialFolders("Programs")
shortcutPath = fso.BuildPath(programsPath, "Crocoblock Site Factory\Factory Launcher.lnk")
If Not fso.FolderExists(fso.GetParentFolderName(shortcutPath)) Then
  fso.CreateFolder(fso.GetParentFolderName(shortcutPath))
End If
Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
shortcut.Arguments = Chr(34) & fso.BuildPath(installRoot, "installer\launch.vbs") & Chr(34)
shortcut.WorkingDirectory = installRoot
shortcut.Description = "Factory Launcher"
shortcut.Save
