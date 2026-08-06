# Restart the Hologram viewer (Electron) through a scheduled task, so every launch is
# identical and carries the CDP port.
#
# Why a scheduled task instead of launching electron.exe directly:
#   1. The action carries --remote-debugging-port=9222, so the resident instance is always
#      CDP-debuggable for the real-machine verify workflow (docs/build.md).
#   2. That argument is also the ONLY marker that identifies the real instance. The stop
#      command in docs/build.md selects by it, precisely so a worktree's test Electron is
#      not killed along with it. An instance started some other way has no marker and
#      cannot be selected — that happened on 2026-08-06 (#1004).
#
# The ORIGINAL reason was different and has expired (2026-08-06, #1003): Claude's shell
# used to live inside the MSIX-packaged Claude desktop app, so a directly-spawned
# electron.exe was a child of that container with HKCU + filesystem virtualized, and the
# app would register the native-messaging host into a private hive the real Chrome could
# not see. Claude Code now runs outside the package; FS and HKCU reads and writes were all
# measured as real (the HKCU write was confirmed by the user in regedit). Direct launches
# no longer break registration. Note the layout changed once and could change back — the
# check is whether (Get-Item <path>).Target points into ...\Packages\<pkg>\LocalCache\...
#
# Launch: right-click this file -> "Run with PowerShell" (a window shows and closes on
# success; on a manual launch it stays open on failure). Claude also runs it headlessly.

$app      = Join-Path $PSScriptRoot 'app'
$taskName = 'HologramLaunch'
$logFile  = Join-Path $HOME '.hologram\restart-app.log'
$desiredArgs = "`"$app`" --remote-debugging-port=9222"

# electron lives under app/node_modules or the repo root, depending on how npm
# felt like hoisting: app/ is a workspace, so npm lifts its dependencies to the
# root whenever nothing pins a conflicting version. Both are normal, so probe
# both rather than baking one in — the hardcoded app/ path made the task launch
# a file that wasn't there, and Start-ScheduledTask reports SUCCESS for that
# (the failure only shows up as LastTaskResult 0x80070002 afterwards), so this
# script printed 完了 while nothing started.
$electron = @(
  (Join-Path $app 'node_modules\electron\dist\electron.exe'),
  (Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1

# Label the window so a right-click launch is self-explanatory (guarded: some hosts lack RawUI).
try { $Host.UI.RawUI.WindowTitle = 'Hologram 再起動' } catch {}

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

# A missing binary has to be caught HERE. Registering the task with an empty
# Execute throws something unrelated, and launching a task whose Execute does
# not exist looks like success from PowerShell's side.
if (-not $electron) {
  Stop-WithError("electron.exe が見つかりません（app/node_modules と リポジトリ直下の node_modules の両方を確認しました）。`n" +
    "npm run setup を実行してください（npm rebuild electron は成功と表示しますがダウンロードしません）")
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
  Write-Host 'HologramLaunch タスクを登録/修復しています...' -ForegroundColor Cyan
  try {
    $action    = New-ScheduledTaskAction -Execute $electron -Argument $desiredArgs
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    $settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances Parallel
    $t = New-ScheduledTask -Action $action -Principal $principal -Settings $settings -Description 'Launch the Hologram Electron app with CDP on :9222 for verify, from a single known path. On-demand only; triggered by restart-app.ps1.'
    Register-ScheduledTask -TaskName $taskName -InputObject $t -Force -ErrorAction Stop | Out-Null
  } catch {
    Stop-WithError("HologramLaunch タスクの登録に失敗しました: $($_.Exception.Message)")
  }
}

# Two-stage shutdown of ONLY the real instance (leave other Electron apps alone).
# CloseMainWindow lets the app finish its 'close' handler (which writes config) before exit;
# a forced kill mid-write used to truncate config.json.
#
# Picked by COMMAND LINE, not by executable path: a test harness running in a worktree uses
# that tree's own node_modules\electron, and worktrees live inside the repo — so a
# '*hologram*' path match (what this used to do) also swept up whatever a parallel session
# was testing with. '--remote-debugging-port=9222' is added by the HologramLaunch task and
# nothing else, so it names the real instance exactly. See docs/build.md.
function Get-HologramProcs {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*--remote-debugging-port=9222*' } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}
Write-Host 'Hologram(electron) を停止しています...' -ForegroundColor Cyan
$procs = Get-HologramProcs
foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }

# Wait up to ~5s for a clean exit, then force-kill only stragglers.
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 200
  if (-not (Get-HologramProcs)) { break }
}
Get-HologramProcs | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 500

# Relaunch OUTSIDE the sandbox via the Task Scheduler service. Surface failure LOUDLY: the
# old instance is already killed, so a swallowed failure would leave NO app and NO error.
Write-Host 'HologramLaunch で起動しています...' -ForegroundColor Cyan
try {
  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
} catch {
  Stop-WithError("HologramLaunch の起動に失敗しました: $($_.Exception.Message)")
}

Write-Host '完了（HologramLaunch を起動しました）。' -ForegroundColor Green
Start-Sleep -Milliseconds 800
