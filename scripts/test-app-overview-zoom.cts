'use strict';

// 俯瞰ズーム (#141) の挙動を隔離インスタンスで検証する。Ctrl+ホイールがサイズ軸を
// 1ノッチ動かし、下限側で情報オーバーレイが自動的に消え（.overview）、停止後に
// 確定して imageTileSize が永続化されるか。実機ではなく HOLOGRAM_SMOKE の別
// プロセス・別 config なので、ユーザーが本体アプリを操作していても混ざらない
// （docs/build.md）。test-app-tagtypes.cts と同じハーネス。
//
//   node scripts/test-app-overview-zoom.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overview-zoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
// tile ビューで起動し、下限(48)まで数ノッチ分の余地がある位置から始める。
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', viewMode: 'tile', imageTileSize: 180, tileOverlay: true }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

// 列数トラックは1ノッチ=1列なので、何枚あっても効く。走査対象らしく数枚置く。
for (let i = 0; i < 12; i++) {
  const captureId = `171750000000${i}-abcd`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
  fs.writeFileSync(
    path.join(saveFolder, `${captureId}.json`),
    JSON.stringify({
      captureId,
      image: `${captureId}.jpg`,
      url: `https://x.com/testuser/status/${i}`,
      platform: 'x',
      text: `俯瞰ズーム検証用のダミー投稿 ${i}`,
      displayName: 'てすと太郎',
      screenName: 'testuser',
      date: '2026-04-04T10:30:00Z',
      capturedAt: '2026-04-04T12:00:00Z',
    }),
  );
}

// ホイールは #postGrid 上で発火させる（ハンドラは #mode-post の内側だけを見る）。
// window 直撃だと target が window になり、スクロール外として無視される。
const evalJs = `(async () => {
  const grid = document.getElementById('postGrid');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const size = () => Number.parseInt(grid.style.getPropertyValue('--tile-size'), 10);
  const fire = (deltaY) => {
    const r = grid.getBoundingClientRect();
    grid.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: r.left + 20, clientY: r.top + 20, bubbles: true, cancelable: true }));
  };
  const start = size();
  // 下限まで引き切る（トラックの端で止まる＝それ以上は no-op）。ノッチは1フレームに
  // まとめて適用されるので、同期読みでは反映前を読む＝確定(150ms)まで待ってから読む。
  for (let i = 0; i < 40; i++) fire(120);
  await sleep(300);
  const small = size();
  const overviewOn = grid.classList.contains('overview');
  const prefs = await window.hologram.getPrefs();
  // 戻す（ズームインは deltaY<0）
  for (let i = 0; i < 3; i++) fire(-120);
  await sleep(300);
  const back = size();
  return [start, small, overviewOn, prefs.imageTileSize, prefs.tileOverlay, back, grid.classList.contains('overview')].join(',');
})()`;

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
  const m = out.match(/EVAL_RESULT "([^"]*)"/);
  if (!m) {
    console.log('OVERVIEW_ZOOM_TEST_FAIL (no EVAL_RESULT)');
    process.exit(1);
  }
  const [start, small, overviewOn, persisted, overlayPref, back, overviewAfter] = m[1].split(',');
  const checks = [
    ['開始サイズは復元された180', Number(start) === 180],
    ['Ctrl+ホイール下でタイルが縮む', Number(small) < Number(start)],
    ['下限は48（それ以下へ落ちない）', Number(small) >= 48],
    ['俯瞰サイズ(<96)で .overview が付く', Number(small) < 96 && overviewOn === 'true'],
    ['停止後に imageTileSize が確定・永続化', Number(persisted) === Number(small)],
    ['タイル情報表示の pref は書き換えない', overlayPref === 'true'],
    ['Ctrl+ホイール上でズームインして戻る', Number(back) > Number(small)],
    ['96px を越えたら .overview が外れる', Number(back) < 96 || overviewAfter === 'false'],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  }
  console.log(`values: start=${start} small=${small} persisted=${persisted} back=${back}`);
  console.log(failed ? 'OVERVIEW_ZOOM_TEST_FAIL' : 'OVERVIEW_ZOOM_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
