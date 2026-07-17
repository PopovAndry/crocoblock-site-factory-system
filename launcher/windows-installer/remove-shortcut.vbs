Option Explicit

Dim shell, fso, shortcutPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
shortcutPath = fso.BuildPath(shell.SpecialFolders("Programs"), "Crocoblock Site Factory\Factory Launcher.lnk")
If fso.FileExists(shortcutPath) Then
  fso.DeleteFile shortcutPath, True
End If
