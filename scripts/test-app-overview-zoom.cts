'use strict';

// 俯瞰ズーム (#141) の挙動を隔離インスタンスで検証する。Ctrl+ホイールがサイズ軸を
// 1ノッチ動かし、下限側で情報オーバーレイが自動的に消え（.overview）、停止後に
// 確定して imageTileSize が永続化されるか。あわせて、ズームがカーソル下の投稿を
// 画面の同じ高さに留めるか (#282) も測る。実機ではなく HOLOGRAM_SMOKE の別
// プロセス・別 config なので、ユーザーが本体アプリを操作していても混ざらない
// （docs/build.md）。test-app-tagtypes.cts と同じハーネス。
//
//   node scripts/test-app-overview-zoom.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overview-zoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
// tile ビューで起動し、下限(48)まで数ノッチ分の余地がある位置から始める。
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', viewMode: 'tile', imageTileSize: 180, tileOverlay: true }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

// 列数トラックは1ノッチ=1列なので、サイズ軸そのものは何枚あっても効く。枚数が要るのは
// アンカー維持 (#282) の方＝1画面に収まってしまうとスクロール位置が動かず、留まったのか
// そもそも動きようが無かったのかを区別できない。180px タイルで数十行になる枚数を置く。
const records: any[] = [];
for (let i = 0; i < 200; i++) {
  const captureId = `171750000000${i}-abcd`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
  records.push({
    captureId,
    image: `${captureId}.jpg`,
    url: `https://x.com/testuser/status/${i}`,
    platform: 'x',
    text: `俯瞰ズーム検証用のダミー投稿 ${i}`,
    displayName: 'てすと太郎',
    screenName: 'testuser',
    date: '2026-04-04T10:30:00Z',
    capturedAt: '2026-04-04T12:00:00Z',
  });
}
seedLibrary(configDir, records);

// ホイールは #postGrid 上で発火させる（ハンドラは #mode-post の内側だけを見る）。
// window 直撃だと target が window になり、スクロール外として無視される。
const evalJs = `(async () => {
  const grid = document.getElementById('postGrid');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const size = () => Number.parseInt(grid.style.getPropertyValue('--tile-size'), 10);
  const fire = (deltaY, x, y) => {
    const r = grid.getBoundingClientRect();
    grid.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x == null ? r.left + 20 : x, clientY: y == null ? r.top + 20 : y, bubbles: true, cancelable: true }));
  };
  const start = size();

  // --- アンカー維持 (#282) ---
  // 見ていた投稿が、ズームの前後で画面の同じ高さに残るか。位置合わせはグリッド島が
  // 自分のレイアウトを読んで行うので、ここで測るのは結果＝カードの画面上の top だけ。
  //
  // 待ち方に注意: 固定の sleep では初回レイアウトが終わる前に測ってしまい、まだ低い
  // コンテンツの上でスクロールした（＝そもそも動きようが無かった）状態を「ずれなかった」
  // と読んでしまう。実際 sleep 固定版は3回中2回それで壊れた。だから状態を待つ。
  const waitFor = async (fn, ms) => {
    for (let i = 0; i * 50 < ms; i++) { if (fn()) return true; await sleep(50); }
    return false;
  };
  // スクロール位置が動かなくなるまで待つ（適用は rAF、確定は 150ms 後、その後さらに
  // 再レイアウトと実測ぶんの確定合わせが入る）。
  const settle = async () => {
    let last = Number.NaN, stable = 0;
    for (let i = 0; i < 60 && stable < 3; i++) {
      await sleep(50);
      const s = Math.round(scroller.scrollTop);
      if (s === last) stable++;
      else { stable = 0; last = s; }
    }
  };
  const scroller = document.getElementById('mode-post');
  // 全件ぶんの高さが立つまで＝仮想グリッドが最初のレイアウトを終えるまで待つ。
  const laidOut = await waitFor(() => scroller.scrollHeight > scroller.clientHeight * 4, 8000);
  scroller.scrollTop = 2000;
  const scrolled = await waitFor(() => Math.abs(scroller.scrollTop - 2000) < 2, 3000);
  const sr = scroller.getBoundingClientRect();
  const seen = () => [...grid.querySelectorAll('.post-card')].map((c) => [c, c.getBoundingClientRect()]).filter(([, r]) => r.bottom > sr.top && r.top < sr.bottom);
  // scrollTop への直代入は「大ジャンプ」＝仮想グリッドは描画窓を作り直すまで、まだ前の
  // 場所のセルを持っている。scrollTop が落ち着いた**だけ**で読むと画面が空に見える
  // （#282 本文の罠。実測で3回中2回それを踏んだ）ので、セルが実際に見えるまで待つ。
  const windowed = await waitFor(() => seen().length > 0, 8000);
  await settle();
  const scrolledTo = Math.round(scroller.scrollTop);
  const midY = sr.top + sr.height / 2;
  // 画面に見えているカードのうち、ビューポート中央にいちばん近いものを狙う。
  const visible = seen();
  visible.sort((a, b) => Math.abs(a[1].top + a[1].height / 2 - midY) - Math.abs(b[1].top + b[1].height / 2 - midY));
  const target = visible.length ? visible[0][0] : null;
  const r0 = visible.length ? visible[0][1] : null;
  const anchorKey = target ? target.dataset.key : null;
  if (target) fire(-120, r0.left + r0.width / 2, r0.top + r0.height / 2); // 1ノッチ拡大
  await settle();
  const moved = Math.round(scroller.scrollTop) !== scrolledTo; // 位置合わせが実際に働いたか
  const held = anchorKey ? grid.querySelector('.post-card[data-key="' + CSS.escape(anchorKey) + '"]') : null;
  const drift = held && r0 ? Math.round(held.getBoundingClientRect().top - r0.top) : 9999;
  const anchorReady = laidOut && scrolled && windowed && !!anchorKey;
  // 元の大きさへ戻してから下の系列に入る（start は上で読み終えている）。
  fire(120);
  await settle();

  // 下限まで引き切る（トラックの端で止まる＝それ以上は no-op）。ノッチは1フレームに
  // まとめて適用されるので、同期読みでは反映前を読む＝確定(150ms)まで待ってから読む。
  for (let i = 0; i < 40; i++) fire(120);
  await sleep(300);
  const small = size();
  const overviewOn = grid.classList.contains('overview');
  const prefs = await window.hologram.getPrefs();
  // 端に張り付いた状態でさらに回してもサイズは動かない。**確定を走らせないこと**は
  // ここでは検証できない＝この規模（200件）だと確定がほぼ無コストで、DOM ノードの
  // 張り替えもサムネの再要求も起きないため、通っても意味のない assertion になる
  // （両方の実装で緑になることを確認済み）。実ライブラリ規模での目視・計測が正。
  for (let i = 0; i < 10; i++) fire(120);
  await sleep(400);
  const stableAtLimit = size() === small;
  // 戻す（ズームインは deltaY<0）
  for (let i = 0; i < 3; i++) fire(-120);
  await sleep(300);
  const back = size();
  return [start, small, overviewOn, prefs.imageTileSize, prefs.tileOverlay, back, grid.classList.contains('overview'), stableAtLimit, anchorReady ? 1 : 0, drift, moved ? 1 : 0].join(',');
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
  const [start, small, overviewOn, persisted, overlayPref, back, overviewAfter, stableAtLimit, anchored, drift, moved] = m[1].split(',');
  const checks = [
    ['開始サイズは復元された180', Number(start) === 180],
    ['Ctrl+ホイール下でタイルが縮む', Number(small) < Number(start)],
    ['下限は48（それ以下へ落ちない）', Number(small) >= 48],
    ['俯瞰サイズ(<96)で .overview が付く', Number(small) < 96 && overviewOn === 'true'],
    ['停止後に imageTileSize が確定・永続化', Number(persisted) === Number(small)],
    ['タイル情報表示の pref は書き換えない', overlayPref === 'true'],
    ['端で回し続けてもサイズが動かない', stableAtLimit === 'true'],
    ['Ctrl+ホイール上でズームインして戻る', Number(back) > Number(small)],
    ['96px を越えたら .overview が外れる', Number(back) < 96 || overviewAfter === 'false'],
    // #282: 掴んだ投稿が生き残り、画面上のほぼ同じ高さに残る。8px はタイルの溝1つぶん＝
    // 「1行ぶんずれた」なら必ず落ちる幅で、丸めの1〜2pxは通す。
    ['アンカー計測の前提が整っている（レイアウト完了・スクロール成立・掴めた）', anchored === '1'],
    ['掴んだ投稿がズーム後も同じ高さに残る', Math.abs(Number(drift)) <= 8],
    ['位置合わせが実際にスクロールを動かしている', moved === '1'],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  }
  console.log(`values: start=${start} small=${small} persisted=${persisted} back=${back} drift=${drift} moved=${moved}`);
  console.log(failed ? 'OVERVIEW_ZOOM_TEST_FAIL' : 'OVERVIEW_ZOOM_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
