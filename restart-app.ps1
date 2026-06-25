# Restart the Corpus viewer (Electron) so it ALWAYS runs OUTSIDE the MSIX sandbox.
#
# Why a scheduled task instead of launching electron.exe directly:
# When this script is run by Claude (whose shell lives inside the MSIX-packaged Claude
# desktop app), a directly-spawned electron.exe is a CHILD of that container and gets its
# HKCU + filesystem virtualized. The app would then register the native-messaging host into
# a private registry hive that the real Chrome can't see -> capture silently breaks.
# A Task Scheduler task is launched by the Task Scheduler SERVICE (outside any container),
# so the app sees the REAL HKCU + filesystem. Run by the user directly, the result is the
# same. (Proven 2026-06-26: a probe task's HKCU writes landed in a hive the container could
# not see, while the container's own writes stayed in the private hive.)

$ErrorActionPreference = 'SilentlyContinue'
$app      = Join-Path $PSScriptRoot 'app'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$taskName = 'CorpusLaunch'

# Self-heal: (re)create the on-demand launch task if it's missing (e.g. after a Claude reinstall).
# No trigger -> on-demand only. Interactive logon -> window appears on the desktop. Limited -> no elevation.
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  $action    = New-ScheduledTaskAction -Execute $electron -Argument "`"$app`""
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel
  $t = New-ScheduledTask -Action $action -Principal $principal -Settings $settings -Description 'Launch the Corpus Electron app outside the MSIX sandbox. On-demand only; triggered by restart-app.ps1.'
  Register-ScheduledTask -TaskName $taskName -InputObject $t -Force | Out-Null
}

# Two-stage shutdown of ONLY this repo's electron (leave other Electron apps alone).
# CloseMainWindow lets the app finish its 'close' handler (which writes config) before exit;
# a forced kill mid-write used to truncate config.json.
$procs = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' }
foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }

# Wait up to ~5s for a clean exit, then force-kill only stragglers.
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 200
  if (-not (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' })) { break }
}
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force

Start-Sleep -Milliseconds 500

# Relaunch OUTSIDE the sandbox via the Task Scheduler service.
Start-ScheduledTask -TaskName $taskName
