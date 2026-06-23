' One-click launcher for restart-app.ps1 — runs it with NO console window at all
' (double-click this file, or make a desktop shortcut to it).
Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "restart-app.ps1")
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
