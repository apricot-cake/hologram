'use strict';

// copy-imageのIPCハンドラ（#132）を実際のElectron mainで試す。それがかかって
// いるのはnativeImageの実際のデコードだから: ハンドラは、nativeImageが読めない
// ファイル（svg）を、その結果の空の画像をクリップボードへ書くのではなく拒否
// しなければならない＝それだとユーザーがコピーしていたものを黙って消して
// しまう。名前のゲートとdrag-outのパス解決は純粋関数でscripts/test-library-files.cts
// がカバーしている。このElectronが要る分岐だけがここの対象。
//
//   node scripts/test-app-copy-image.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-copyimg-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
fs.writeFileSync(path.join(saveFolder, 'dummy-0001.jpg'), jpeg);
// 実ライブラリはsvgを持てる（app/src/main/ipc-transfer.tsが受け入れる）＝
// nativeImageがデコードしない形式。
fs.writeFileSync(path.join(saveFolder, 'dummy-0002.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');

// デコード可能な画像のときだけtrue。それ以外の全てのケースは失敗を報告
// しなければならない。レンダラーが、起きなかったコピーをあったかのように
// 匂わせるのではなく、そう言えるように。
const evalJs = evalSource(async () => {
  const h = (window as any).hologram;
  return [await h.copyImage('dummy-0001.jpg'), await h.copyImage('dummy-0002.svg'), await h.copyImage('../Hologram/config.json'), await h.copyImage('nope.jpg')].join(',');
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // ハーネスはevalの戻り値をJSONエンコードして出力するので、文字列は引用符付きで届く
  const m = /EVAL_RESULT "?([^"\r\n]+)"?/.exec(out);
  const got = m ? m[1] : '（結果なし）';
  const ok = got === 'true,false,false,false';
  console.log(`copyImage jpg,svg,traversal,missing = ${got}（true,false,false,falseを期待）`);
  console.log(ok ? 'COPY_IMAGE_TEST_PASS' : 'COPY_IMAGE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
