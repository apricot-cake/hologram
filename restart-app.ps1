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
#
# The task action also carries --remote-debugging-port=9222 so the resident instance is
# CDP-debuggable for the real-machine verify workflow (docs/build.md) WHILE still launching
# outside the container. (Want port-free normal launches? Drop the port from $desiredArgs
# and add a separate 'CorpusLaunchDebug' task for verification instead.)
#
# Launch: right-click this file -> "Run with PowerShell" (a window shows and closes on
# success; on a manual launch it stays open on failure). Claude also runs it headlessly.

$app      = Join-Path $PSScriptRoot 'app'
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
$taskName = 'CorpusLaunch'
$logFile  = Join-Path $HOME '.corpus\restart-app.log'
$desiredArgs = "`"$app`" --remote-debugging-port=9222"

# Label the window so a right-click launch is self-explanatory (guarded: some hosts lack RawUI).
try { $Host.UI.RawUI.WindowTitle = 'Corpus 再起動' } catch {}

# On failure: log, and keep the window open ONLY for an interactive (human) launch so the
# error is never missed. When Claude runs this headlessly stdin is redirected -> skip the
# prompt so automation never blocks. Default to NOT blocking if the check itself fails.
function Stop-WithError($message) {
  Write-Host ''
  Write-Host $message -ForegroundColor Red
  Add-Content -Path $logFile -Value ("[{0}] {1}" -f (Get-Date -Format o), $message) -ErrorAction SilentlyContinue
  $interactive = $false
  try { $interactive = -not [Console]::IsInputRedirected } catch { $interactive = $false }
  if ($interactive) {
    Write-Host 'エラーを確認したら Enter キー（または×ボタン）で閉じてください。' -ForegroundColor Yellow
    try { [void](Read-Host) } catch { }
  }
  exit 1
}

# Self-heal: (re)register the task when it is MISSING or when its stored action has DRIFTED
# from the current paths/args (e.g. the repo moved/renamed, or the port arg changed). The
# create-only-if-missing form would silently keep launching a stale path; comparing the
# action every run auto-corrects that and costs nothing when unchanged.
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$drift = $true
if ($existing -and $existing.Actions.Count -ge 1) {
  $a = $existing.Actions[0]
  if ($a.Execute -eq $electron -and $a.Arguments -eq $desiredArgs) { $drift = $false }
}
if ($drift) {
  Write-Host 'CorpusLaunch タスクを登録/修復しています...' -ForegroundColor Cyan
  try {
    $action    = New-ScheduledTaskAction -Execute $electron -Argument $desiredArgs
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel
    $t = New-ScheduledTask -Action $action -Principal $principal -Settings $settings -Description 'Launch the Corpus Electron app outside the MSIX sandbox (real HKCU/filesystem), CDP on :9222 for verify. On-demand only; triggered by restart-app.ps1.'
    Register-ScheduledTask -TaskName $taskName -InputObject $t -Force -ErrorAction Stop | Out-Null
  } catch {
    Stop-WithError("CorpusLaunch タスクの登録に失敗しました: $($_.Exception.Message)")
  }
}

# Two-stage shutdown of ONLY this repo's electron (leave other Electron apps alone).
# CloseMainWindow lets the app finish its 'close' handler (which writes config) before exit;
# a forced kill mid-write used to truncate config.json.
Write-Host 'Corpus(electron) を停止しています...' -ForegroundColor Cyan
$procs = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' }
foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }

# Wait up to ~5s for a clean exit, then force-kill only stragglers.
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 200
  if (-not (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' })) { break }
}
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 500

# Relaunch OUTSIDE the sandbox via the Task Scheduler service. Surface failure LOUDLY: the
# old instance is already killed, so a swallowed failure would leave NO app and NO error.
Write-Host 'CorpusLaunch で起動しています...' -ForegroundColor Cyan
try {
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
} catch {
  Stop-WithError("CorpusLaunch の起動に失敗しました: $($_.Exception.Message)")
}

Write-Host '完了（CorpusLaunch を起動しました）。' -ForegroundColor Green
Start-Sleep -Milliseconds 800
