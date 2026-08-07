# Restart the Hologram viewer (Electron) so every launch is identical and carries the CDP
# port that the real-machine verify workflow connects to (docs/build.md).
#
# Launch: right-click this file -> "Run with PowerShell" (a window shows and closes on
# success; on a manual launch it stays open on failure). Claude also runs it headlessly.
#
# --remote-debugging-port=9222 is the point of this script. It does two jobs:
#   1. the resident instance is always CDP-debuggable, without anyone remembering a flag.
#   2. it is the ONLY marker that identifies the real instance. The stop half below (and
#      the equivalent one-liner in docs/build.md) selects by it, precisely so a worktree's
#      test Electron is not killed along with it. An instance started some other way has
#      no marker and cannot be selected — that happened on 2026-08-06 (#1004).
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
#     and was selected by the command-line filter below — while an instance on a different
#     port was correctly NOT selected. So the ~40 lines of task registration, action-drift
#     detection and self-healing bought nothing, and cost a failure mode of their own:
#     Start-ScheduledTask reports SUCCESS even when its Execute does not exist, so a stale
#     action printed 完了 while nothing started. Start-Process throws instead.
#
# The task may still exist on this machine; this script no longer creates, repairs or uses
# it. Whether to delete it is open (the user may have a shortcut pointing at it) — #1008.
#
# What a direct launch does NOT inherit for free is the task's clean environment, so the
# spawn below builds one. See the comment there.

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

# Two-stage shutdown of ONLY the real instance (leave other Electron apps alone).
# CloseMainWindow lets the app finish its 'close' handler (which writes config) before exit;
# a forced kill mid-write used to truncate config.json.
#
# Picked by COMMAND LINE, not by executable path: a test harness running in a worktree uses
# that tree's own node_modules\electron, and worktrees live inside the repo — so a
# '*hologram*' path match (what this used to do) also swept up whatever a parallel session
# was testing with. Only this script adds --remote-debugging-port=9222, so it names the real
# instance exactly. (It matches the browser process and its renderer child, which Chromium
# gives the same flag; killing the browser takes the child with it either way.)
function Get-HologramProcs {
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*--remote-debugging-port=$port*" } |
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

# Give the app the environment the scheduled task used to give it for free. A direct
# Start-Process inherits THIS shell's environment, and the shells that run this script are
# frequently ones a verify workflow has exported into: HOLOGRAM_CONFIG_DIR would point the
# "real" app at a sandbox config (measured — it comes up on an empty library and looks like
# data loss), HOLOGRAM_SANDBOX would skip native-host registration, HOLOGRAM_SMOKE would
# hide the window. ELECTRON_RENDERER_URL would load the renderer from a dev server that is
# not running. APPDATA is restored from the shell folder, which ignores the env override.
Get-ChildItem Env: | Where-Object { $_.Name -like 'HOLOGRAM_*' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
$env:APPDATA = [Environment]::GetFolderPath('ApplicationData')

# Surface failure LOUDLY: the old instance is already killed, so a swallowed failure would
# leave NO app and NO error. Start-Process throws when the executable is missing, and the
# marker check below catches an instance that started and died on the way up.
# -WorkingDirectory pins the cwd: this script is run from wherever the caller happened to
# be, and the task never had one.
Write-Host 'Hologram(electron) を起動しています...' -ForegroundColor Cyan
try {
  Start-Process -FilePath $electron -ArgumentList "`"$app`" --remote-debugging-port=$port" -WorkingDirectory $PSScriptRoot -ErrorAction Stop
} catch {
  Stop-WithError("Hologram の起動に失敗しました: $($_.Exception.Message)")
}

# Post-condition: the new instance carries the marker. That is what makes it findable by
# the stop half above and by docs/build.md's one-liner, so it is worth one bounded wait
# rather than trusting that a launched process is a running app.
for ($i = 0; $i -lt 40; $i++) {
  if (Get-HologramProcs) { break }
  Start-Sleep -Milliseconds 250
}
if (-not (Get-HologramProcs)) {
  Stop-WithError("起動したはずの Hologram が見つかりません（--remote-debugging-port=$port を持つ electron.exe が10秒経っても現れませんでした）")
}

Write-Host "完了（Hologram を起動しました。CDP: 127.0.0.1:$port）。" -ForegroundColor Green
Start-Sleep -Milliseconds 800
