$ErrorActionPreference = 'Stop'

$taskName = 'HologramExtensionDev'
$repo = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe).Source
$supervisor = Join-Path $PSScriptRoot 'extension-dev-supervisor.cts'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" run' -f $supervisor) -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -Hidden -MultipleInstances IgnoreNew -RestartCount 12 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Keeps the Hologram CRXJS development server ready on 127.0.0.1:51731.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "$taskName was registered and started."
