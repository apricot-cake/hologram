param(
  [Parameter(Mandatory = $true)][string]$Chrome,
  [Parameter(Mandatory = $true)][string]$ProfileDir
)

$ErrorActionPreference = 'Stop'

# Opens the development Chrome profile OUTSIDE the MSIX container (#857).
#
# Called by scripts/open-dev-profile.cts, which has already established that the
# profile is not open yet. A Chrome started from inside the packaged desktop app
# runs in the container, where filesystem and registry writes land in a
# per-package copy: the profile it is meant to reuse could fork, and the native
# messaging host it has to reach is an HKCU registration written outside. Task
# Scheduler starts the action from the service, i.e. outside that container —
# the same reason the app itself is launched through HologramLaunch.
#
# The action is `cmd /c start`, not chrome.exe directly: that returns at once,
# so the task completes and can be removed while the browser it opened stays up
# (measured 2026-08-03). Nothing about the development setup is resident.

$taskName = 'HologramDevBrowser'
$argument = '/c start "" "{0}" --user-data-dir="{1}"' -f $Chrome, $ProfileDir

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argument
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
# Interactive, not S4U: S4U needs the batch-logon right and Register-ScheduledTask
# returns Access denied without it here (measured 2026-08-02, see
# scripts/register-dev-native-host.ps1). This task is only ever started by hand
# while the user is logged on, so Interactive is what it is.
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $principal -Description 'One-shot: opens the Hologram development Chrome profile outside the MSIX container.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddMinutes(1)
do {
  Start-Sleep -Milliseconds 300
  $info = Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo
} while ($info.LastTaskResult -eq 267009 -and (Get-Date) -lt $deadline)

$result = $info.LastTaskResult
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

if ($result -ne 0) {
  throw "$taskName exited with $result. The browser was NOT opened."
}
