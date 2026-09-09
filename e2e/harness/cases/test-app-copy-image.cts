'use strict';

// 実際の Electron IPC と Windows の 画像 を確認し、元のクリップボードを復元する。
// node e2e/harness/cases/test-app-copy-image.cts（事前に npm run build --workspace app）

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-copyimage-'));
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
  const results = [await h.copyImage('日本語 空白.jpg'), await h.copyImage('dummy-0002.svg'), await h.copyImage('../Hologram/config.json'), await h.copyImage('missing.jpg')];
  let emptyRejected = false;
  try {
    await h.copyImage('');
  } catch (error) {
    emptyRejected = String(error).includes('Invalid IPC input: copy-image');
  }
  return [...results, emptyRejected ? 'rejected' : 'accepted'].join(',');
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
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($null -eq $image -or $image.Width -ne 1 -or $image.Height -ne 1) { throw 'Image mismatch' }
  Write-Output 'IMAGE_PASS'
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
  const ok = code === 0 && got === 'true,false,false,false,rejected' && out.includes('IMAGE_PASS');
  console.log(`copyImage single,unsupported,traversal,missing,empty = ${got}（true,false,false,false,rejectedを期待）`);
  console.log(ok ? 'COPY_IMAGE_TEST_PASS' : 'COPY_IMAGE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
