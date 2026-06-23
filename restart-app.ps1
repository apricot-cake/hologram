# Restart the Corpus viewer (Electron).
# - Kills ONLY the electron instance whose path is under this repo ("*corpus*"),
#   so other Electron apps are left running.
# - Relaunches electron.exe directly (not `npm start`, which leaves a cmd window).
# $PSScriptRoot makes it portable to wherever the repo lives.
$app = Join-Path $PSScriptRoot 'app'

Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like '*corpus*' } |
  Stop-Process -Force

Start-Sleep -Milliseconds 500

Start-Process -FilePath (Join-Path $app 'node_modules\electron\dist\electron.exe') `
  -ArgumentList '.' -WorkingDirectory $app
