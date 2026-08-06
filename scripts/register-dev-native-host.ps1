$ErrorActionPreference = 'Stop'

# Runs scripts/register-dev-native-host.cts through a one-shot scheduled task (#732).
# The original reason (getting outside the MSIX container) expired 2026-08-06 (#1003);
# the detour is kept until someone registers directly and confirms. See the .cts header.
#
# Native messaging registration is an HKCU write. A process started from inside
# the packaged desktop app writes into a per-package virtual hive that the real
# Chrome never reads, so the registration would look successful and do nothing.
# Task Scheduler starts the action from the service, i.e. outside that container
# — the same reason the app itself is launched through HologramLaunch.
#
# The task is one-shot: registered, run, waited on, then removed. Nothing about
# the development setup is resident.

$taskName = 'HologramDevNativeHost'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe).Source
$script = Join-Path $PSScriptRoot 'register-dev-native-host.cts'
$arguments = if ($args.Count -gt 0) { '"{0}" {1}' -f $script, ($args -join ' ') } else { '"{0}"' -f $script }

$action = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $repo
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
# Interactive, not S4U: S4U needs the batch-logon right and Register-ScheduledTask
# returns Access denied without it here (measured 2026-08-02). This task is only
# ever started by hand while the user is logged on, so Interactive is what it is.
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Settings $settings -Principal $principal -Description 'One-shot: registers the Hologram development native messaging host.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$deadline = (Get-Date).AddMinutes(5)
do {
  Start-Sleep -Milliseconds 500
  $info = Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo
} while ($info.LastTaskResult -eq 267009 -and (Get-Date) -lt $deadline)

$result = $info.LastTaskResult
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

if ($result -ne 0) {
  throw "$taskName exited with $result. The registration did NOT happen."
}
Write-Host "Development native messaging host registration ran outside the container (exit 0)."
Write-Host "Verify it by capturing from the development Chrome profile and reading ~/.hologram-dev/bridge.log. (Reading HKCU back is also meaningful since 2026-08-06 — see the .cts header.)"
