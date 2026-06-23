# Restart the Corpus viewer (Electron).
# - Kills ONLY the electron instance whose path is under this repo ("*corpus*"),
#   so other Electron apps are left running.
# - Relaunches electron.exe directly (not `npm start`, which leaves a cmd window).
# $PSScriptRoot makes it portable to wherever the repo lives.
$app = Join-Path $PSScriptRoot 'app'

# Two-stage shutdown. CloseMainWindow lets the app finish its 'close' handler
# (which writes config) BEFORE exiting — a forced kill mid-write used to truncate
# config.json and silently drop saveFolder/extensionId/backup. (The app now writes
# config atomically too, but a clean shutdown is still the safer default.)
$procs = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' }
foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch { } }

# Wait up to ~5s for a clean exit, then force-kill only stragglers.
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Milliseconds 200
  if (-not (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' })) { break }
}
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force

Start-Sleep -Milliseconds 500

Start-Process -FilePath (Join-Path $app 'node_modules\electron\dist\electron.exe') `
  -ArgumentList '.' -WorkingDirectory $app
