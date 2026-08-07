# Restart the Hologram viewer (Electron) so every launch is identical and carries the CDP
# port that the real-machine verify workflow connects to (docs/build.md).
#
# Launch: right-click this file -> "Run with PowerShell" (a window shows and closes on
# success; on a manual launch it stays open on failure). Claude also runs it headlessly.
#
# --remote-debugging-port=9222 makes the resident instance CDP-debuggable, without anyone
# remembering a flag. It is ONLY that now: it used to double as the marker the stop half
# below picked the real instance by, which is why an instance started from the Start Menu
# shortcut (no arguments) could not be stopped (#1004). The stop half no longer looks at
# arguments, or at processes at all — see below.
#
# STOPPING: the app is asked to quit; nothing is hunted down and killed.
#
#   A throwaway launch carrying --hologram-quit loses Electron's single-instance lock and
#   hands its argv to whoever holds it; the holder quits itself (app/src/main/index.ts, via
#   restart-signal.ts). The lock is keyed on app name + userData, i.e. on WHICH CONFIG DIR
#   an instance opened — which is the actual definition of "the real app" and the one thing
#   no external filter could ever read. Everything this script matched on before was a
#   proxy for it and each proxy failed on one side: a '*hologram*' path substring swept up
#   worktree test instances (2026-08-05), the --remote-debugging-port marker missed
#   instances launched without it (#1004), and the exact exe path still could not tell the
#   real app from a sandbox started out of THIS tree (scripts/sandbox-app.cts runs the
#   identical binary and differs only by env). A sandbox holds a different lock, so it
#   simply never hears the signal now.
#
#   The same throwaway launch doubles as the probe for "is it gone yet": exit 3 means an
#   instance was there and has been told to quit, exit 0 means nothing was running. Polling
#   that is what lets the new instance start only once the lock is actually free — asking
#   Windows for a process list to find that out would put the guessing straight back in.
#
#   Process matching survives in Get-HologramProcs as the FROZEN-APP FALLBACK only: an
#   instance whose message loop is stuck never answers the signal. It is a last resort and
#   it does over-match (a sandbox from this tree shares the exe path), so it runs only after
#   the polite path has timed out, and it says so.
#
# This used to go through a 'HologramLaunch' scheduled task. TWO reasons, both now gone:
#
#   - The ORIGINAL one expired on 2026-08-06 (#1003): Claude's shell used to live inside
#     the MSIX-packaged Claude desktop app, so a directly-spawned electron.exe was a child
#     of that container with HKCU + filesystem virtualized, and the app would register the
#     native-messaging host into a private hive the real Chrome could not see. Claude Code
#     now runs outside the package; FS and HKCU reads and writes were all measured as real.
#     Note the layout changed once and could change back — the check is whether
#     (Get-Item <path>).Target points into ...\Packages\<pkg>\LocalCache\...
#   - After that, all the task still bought was "the launched app is not a child of the
#     calling shell". Measured on 2026-08-07 (#1008): Start-Process gives that too. An
#     Electron launched this way outlived both the powershell.exe that started it and the
#     agent shell above that, kept answering CDP (scripts/cdp-verify.cts connected to it),
#     and was selected by the command-line filter of the day — while an instance on a
#     different port was correctly NOT selected. So the ~40 lines of task registration,
#     action-drift detection and self-healing bought nothing, and cost a failure mode of
#     their own: Start-ScheduledTask reports SUCCESS even when its Execute does not exist,
#     so a stale action printed 完了 while nothing started. Start-Process throws instead.
#
# The task may still exist on this machine; this script no longer creates, repairs or uses
# it. Whether to delete it is open (the user may have a shortcut pointing at it) — #1008.
#
# What a direct launch does NOT inherit for free is the task's clean environment, so the
# env block below builds one. See the comment there.

$app     = Join-Path $PSScriptRoot 'app'
$logFile = Join-Path $HOME '.hologram\restart-app.log'
$port    = 9222

# electron lives under app/node_modules or the repo root, depending on how npm
# felt like hoisting: app/ is a workspace, so npm lifts its dependencies to the
# root whenever nothing pins a conflicting version. Both are normal, so probe
# both rather than baking one in.
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

if (-not $electron) {
  Stop-WithError("electron.exe が見つかりません（app/node_modules と リポジトリ直下の node_modules の両方を確認しました）。`n" +
    "npm run setup を実行してください（npm rebuild electron は成功と表示しますがダウンロードしません）")
}

# Refuse to spawn anything when the app is not built, BEFORE the stop loop rather than at
# the launch below: `electron <app>` with no main entry puts an OS modal ("Unable to find
# Electron app at ...") in front of whatever the user is doing, once per launch — and the
# stop loop launches repeatedly, so an unbuilt tree would produce a stack of them. Same
# precondition scripts/lib-electron-path.cts enforces for the test harnesses (#460).
$appEntry = Join-Path $app 'out\main\index.js'
if (-not (Test-Path $appEntry)) {
  Stop-WithError("app がビルドされていません（$appEntry が有りません）。`nnpm run build --workspace=app を実行してください")
}

# Give the app the environment the scheduled task used to give it for free. A direct
# Start-Process inherits THIS shell's environment, and the shells that run this script are
# frequently ones a verify workflow has exported into: HOLOGRAM_CONFIG_DIR would point the
# "real" app at a sandbox config (measured — it comes up on an empty library and looks like
# data loss), HOLOGRAM_SANDBOX would skip native-host registration, HOLOGRAM_SMOKE would
# hide the window. ELECTRON_RENDERER_URL would load the renderer from a dev server that is
# not running. APPDATA is restored from the shell folder, which ignores the env override.
#
# This has to happen BEFORE the stop loop, not just before the launch: the single-instance
# lock the signal travels on is keyed on userData, so a leftover HOLOGRAM_CONFIG_DIR would
# aim the "please quit" at whatever sandbox that variable names instead of at the real app.
Get-ChildItem Env: | Where-Object { $_.Name -like 'HOLOGRAM_*' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
$env:APPDATA = [Environment]::GetFolderPath('ApplicationData')

$configDir = Join-Path $env:APPDATA 'Hologram'

# FALLBACK ONLY — see the header. Front-anchored on the resolved $electron path (Windows
# quotes the exe in the command line when nothing forces it not to, but not always, so match
# both forms). It catches every instance run from this binary, INCLUDING a sandbox started
# from this tree, which is why nothing but a timed-out signal may reach it.
function Get-HologramProcs {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "`"$electron`"*" -or $_.CommandLine -like "$electron *" } |
    ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
}

Write-Host 'Hologram(electron) に終了を伝えています...' -ForegroundColor Cyan
$stopped   = $false
$signalled = $false
$deadline  = (Get-Date).AddSeconds(20)
do {
  try {
    $probe = Start-Process -FilePath $electron -ArgumentList "`"$app`" --hologram-quit" -WorkingDirectory $PSScriptRoot -Wait -PassThru -ErrorAction Stop
  } catch {
    Stop-WithError("終了の合図を送れませんでした: $($_.Exception.Message)")
  }
  # 0 = nothing was running, 3 = an instance was there and has been told to quit.
  # Anything else means the app died on the way up rather than answering, and retrying
  # would just repeat it — app/src/main/restart-signal.ts owns these numbers.
  if ($probe.ExitCode -eq 0) { $stopped = $true; break }
  if ($probe.ExitCode -ne 3) {
    Stop-WithError("終了の合図に予期しない終了コードが返りました（$($probe.ExitCode)）。app のビルドが壊れている可能性があります: npm run build --workspace=app")
  }
  $signalled = $true
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if (-not $stopped) {
  # The polite path timed out: the app is up but its message loop is not answering.
  # This is the over-matching path — say so, because it can take a sandbox instance
  # started from this same tree with it.
  Write-Host '応答がないため、実行ファイルのパス一致で強制終了します（このツリーから起動したサンドボックスも巻き添えになります）。' -ForegroundColor Yellow
  Get-HologramProcs | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
}

# Post-condition for the launch below: Chromium writes DevToolsActivePort into userData when
# the debug port opens, with a per-process UUID on the second line, and it is the config dir
# that makes an instance the real one. So "this file's content changed" means the new
# instance is up AND its CDP port is actually open — a stronger check than the old "some
# electron.exe exists", and one that needs no process matching. Read after the stop so a
# file the outgoing instance removed on its way out counts as a change too.
$activePortFile = Join-Path $configDir 'DevToolsActivePort'
$portMarkerBefore = Get-Content $activePortFile -Raw -ErrorAction SilentlyContinue

# Surface failure LOUDLY: the old instance is already gone, so a swallowed failure would
# leave NO app and NO error. Start-Process throws when the executable is missing, and the
# post-condition below catches an instance that started and died on the way up.
# -WorkingDirectory pins the cwd: this script is run from wherever the caller happened to
# be, and the task never had one.
Write-Host 'Hologram(electron) を起動しています...' -ForegroundColor Cyan
try {
  Start-Process -FilePath $electron -ArgumentList "`"$app`" --remote-debugging-port=$port" -WorkingDirectory $PSScriptRoot -ErrorAction Stop
} catch {
  Stop-WithError("Hologram の起動に失敗しました: $($_.Exception.Message)")
}

$up = $false
for ($i = 0; $i -lt 80; $i++) {
  $now = Get-Content $activePortFile -Raw -ErrorAction SilentlyContinue
  if ($now -and $now -ne $portMarkerBefore) { $up = $true; break }
  Start-Sleep -Milliseconds 250
}
if (-not $up) {
  Stop-WithError("起動したはずの Hologram が CDP を開きませんでした（$activePortFile が20秒経っても更新されませんでした）")
}

if ($signalled) {
  Write-Host "完了（動いていた Hologram を終了させ、起動し直しました。CDP: 127.0.0.1:$port）。" -ForegroundColor Green
} else {
  Write-Host "完了（Hologram を起動しました。CDP: 127.0.0.1:$port）。" -ForegroundColor Green
}
Start-Sleep -Milliseconds 800
