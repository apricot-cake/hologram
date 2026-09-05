'use strict';

// 実際の Electron IPC と Windows の FileDrop を確認し、元のクリップボードを復元する。
// node scripts/test-app-copy-files.cts（事前に npm run build --workspace app）

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-copyfiles-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
fs.writeFileSync(path.join(saveFolder, '日本語 空白.jpg'), jpeg);
// 実ライブラリはsvgを持てる（app/src/main/ipc-transfer.tsが受け入れる）＝
// nativeImageがデコードしない形式。
fs.writeFileSync(path.join(saveFolder, 'dummy-0002.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');

const evalJs = evalSource(async () => {
  const h = (window as any).hologram;
  return [await h.copyFiles(['日本語 空白.jpg']), await h.copyFiles(['日本語 空白.jpg', 'dummy-0002.svg', '日本語 空白.jpg']), await h.copyFiles(['../Hologram/config.json']), await h.copyFiles(['日本語 空白.jpg', 'nope.jpg']), await h.copyFiles([])].join(',');
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
  HOLOGRAM_COPY_TEST_ELECTRON: electronPath,
  HOLOGRAM_COPY_TEST_SAVE: saveFolder,
});

if (process.platform !== 'win32') throw new Error('This native clipboard test requires Windows');
const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
$original = [System.Windows.Forms.Clipboard]::GetDataObject()
$snapshot = [System.Windows.Forms.DataObject]::new()
if ($null -ne $original) {
  foreach ($format in $original.GetFormats($false)) {
    $data = $original.GetData($format, $false)
    if ($null -ne $data) { $snapshot.SetData($format, $false, $data) }
  }
}
try {
  & $env:HOLOGRAM_COPY_TEST_ELECTRON '.' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Electron failed' }
  $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
  $expected = @(Join-Path $env:HOLOGRAM_COPY_TEST_SAVE '日本語 空白.jpg'; Join-Path $env:HOLOGRAM_COPY_TEST_SAVE 'dummy-0002.svg')
  if ($files.Count -ne 2 -or $files[0] -ne $expected[0] -or $files[1] -ne $expected[1]) { throw 'FileDrop mismatch' }
  Write-Output 'FILE_DROP_PASS'
} finally {
  if ($null -ne $original) { [System.Windows.Forms.Clipboard]::SetDataObject($snapshot, $true) }
  else { [System.Windows.Forms.Clipboard]::Clear() }
}
`;
const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const child = spawn(command, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd: appDir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', (code) => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // ハーネスはevalの戻り値をJSONエンコードして出力するので、文字列は引用符付きで届く
  const m = /EVAL_RESULT "?([^"\r\n]+)"?/.exec(out);
  const got = m ? m[1] : '（結果なし）';
  const ok = code === 0 && got === 'true,true,false,false,false' && out.includes('FILE_DROP_PASS');
  console.log(`copyFiles single,stack,traversal,missing,empty = ${got}（true,true,false,false,falseを期待）`);
  console.log(ok ? 'COPY_FILES_TEST_PASS' : 'COPY_FILES_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
