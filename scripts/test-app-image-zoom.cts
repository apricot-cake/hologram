'use strict';

// 画像ビューのツールバー（#150）を実レンダラで検証する。
//
// 純ユニット（scripts/image-zoom.test.ts）が持つのは倍率の算術とコントローラ登録の
// 帳簿だけで、「ツールバーがトップの帯に出ているか」「ボタンが本当にビューアを動かすか」
// 「動画スライドで disabled になるか」は React のツリーとストアが全部つながって初めて
// 決まる＝そこがここの受け持ち。
//
//   - グリッドタブではツールバーが存在しない／画像ビューを開くと出る
//   - 画像ビュー中は検索欄（グリッドの述語）が引っ込む
//   - ＋ / − が表示%を1段ずつ動かし、フィットでは − が disabled
//   - フィット⇄原寸トグルと Ctrl+1 / Ctrl+0 が同じ場所へ飛ぶ
//   - 動画スライドではズーム系が disabled（クラスタごと消えるのではない）
//     → 次の画像スライドへ送ると戻る
//
// 見た目そのもの（％の読みやすさ・アイコンの意味）は実 Electron の目視の領分。
// 自前のサンドボックス Electron を起動する（HOLOGRAM_SMOKE）。
//
//   node scripts/test-app-image-zoom.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-imagezoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// z1: 画像1枚だけの投稿。1x1 の JPEG なので「枠より小さい画像」＝フィットが既に原寸
// （表示 100%）で、原寸ジャンプは固定倍率 2.5x（=250%）になる分岐を踏む。倍率の
// 算術そのものの網羅は純ユニット側。
// z2: 先頭が動画のギャラリー（原寸 mp4 → スクショ jpg の順に並ぶ）＝1枚目で
// ズーム系が disabled、2枚目へ送ると生き返ることを見るための材料。
fs.writeFileSync(path.join(saveFolder, 'dummy-z1.jpg'), jpeg);
fs.writeFileSync(path.join(saveFolder, 'dummy-z2.jpg'), jpeg);
fs.writeFileSync(path.join(saveFolder, 'dummy-z2-orig.mp4'), Buffer.from('not a real clip'));

const records = [
  {
    captureId: 'dummy-z1',
    image: 'dummy-z1.jpg',
    url: 'https://x.com/u1/status/901',
    platform: 'x',
    text: 'ズーム対象',
    displayName: '人1',
    screenName: 'u1',
    capturedAt: '2026-05-01T12:00:00Z',
    date: '2026-04-01T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  },
  {
    captureId: 'dummy-z2',
    image: 'dummy-z2.jpg',
    url: 'https://x.com/u2/status/902',
    platform: 'x',
    text: '動画つき',
    displayName: '人2',
    screenName: 'u2',
    capturedAt: '2026-05-02T12:00:00Z',
    date: '2026-04-02T10:00:00Z',
    media: [{ file: 'dummy-z2-orig.mp4', url: 'https://x.com/i/2.mp4' }],
    tags: [],
    hashtags: [],
  },
];
seedLibrary(configDir, records);

const evalJs = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const q = (sel) => document.querySelector(sel);
  const cardOf = (key) => document.querySelector('#postGrid .post-card[data-key="' + key + '"]');
  const dblclick = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const zoomLevel = () => { const el = q('[data-slot="viewer-zoom-level"]'); return el ? el.textContent.trim() : null; };
  const btn = (slot) => q('[data-slot="' + slot + '"]');
  const press = (slot) => { const b = btn(slot); if (b) b.click(); };
  const disabled = (slot) => { const b = btn(slot); return !!(b && b.disabled); };
  // ズームは 180-200ms の easeOut で寄るので、値が落ち着くまで待ってから読む。
  const settled = async (want) => { await waitFor(() => zoomLevel() === want, 3000); return zoomLevel(); };
  const chord = (key, mods) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: key, bubbles: true, cancelable: true }, mods)));
  const searchShown = () => { const el = q('[data-slot="toolbar-search"]'); return !!(el && el.getClientRects().length); };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  await waitFor(() => document.querySelectorAll('#postGrid .post-card').length >= 2);

  // A. グリッドタブ: ツールバーは存在しない（検索欄は出ている）
  out.toolbarInGrid = !!q('[data-slot="viewer-toolbar"]');
  out.searchInGrid = searchShown();

  // B. 画像ビューを開く → ツールバーが帯に出て、検索欄は引っ込む
  dblclick(cardOf('dummy-z1'));
  out.imageViewActive = await waitFor(() => document.body.classList.contains('image-tab-active'));
  out.toolbarInImageView = await waitFor(() => !!q('[data-slot="viewer-toolbar"]'));
  out.searchInImageView = searchShown();

  // C. フィット中の表示%と − の disabled（これ以上縮まない）
  out.percentAtFit = await settled('100%');
  out.zoomOutDisabledAtFit = disabled('viewer-zoom-out');
  out.zoomInEnabledAtFit = !disabled('viewer-zoom-in');

  // D. ＋ で1段（1.25倍）、− で戻る
  press('viewer-zoom-in');
  out.percentAfterZoomIn = await settled('125%');
  out.zoomOutEnabledAfterIn = !disabled('viewer-zoom-out');
  press('viewer-zoom-out');
  out.percentAfterZoomOut = await settled('100%');

  // E. フィット⇄原寸トグル（1x1 画像なので原寸側は固定倍率 2.5x = 250%）
  press('viewer-fit-toggle');
  out.percentAfterToggleOut = await settled('250%');
  press('viewer-fit-toggle');
  out.percentAfterToggleBack = await settled('100%');

  // F. Ctrl+1 = 原寸 / Ctrl+0 = フィット（トグルと同じ関数を叩く）
  chord('1', { ctrlKey: true });
  out.percentAfterCtrl1 = await settled('250%');
  chord('0', { ctrlKey: true });
  out.percentAfterCtrl0 = await settled('100%');

  // G. グリッドへ戻る（Alt+←）→ ツールバーは消え、検索欄が戻る
  chord('ArrowLeft', { altKey: true });
  out.leftImageView = await waitFor(() => !document.body.classList.contains('image-tab-active'));
  out.toolbarAfterBack = !!q('[data-slot="viewer-toolbar"]');
  out.searchAfterBack = searchShown();

  // H. 先頭が動画の投稿 → ズーム系は disabled のまま「そこに在る」
  dblclick(cardOf('dummy-z2'));
  out.videoViewActive = await waitFor(() => document.body.classList.contains('image-tab-active'));
  await waitFor(() => !!q('[data-slot="viewer-toolbar"]'));
  out.videoSlideIsVideo = !!q('.itv-stage video');
  out.videoToolbarPresent = !!q('[data-slot="viewer-toolbar"]');
  out.videoZoomInDisabled = disabled('viewer-zoom-in');
  out.videoZoomOutDisabled = disabled('viewer-zoom-out');
  out.videoFitDisabled = disabled('viewer-fit-toggle');
  out.videoPercent = zoomLevel();

  // I. 次のスライド（スクショ画像）へ送ると生き返る
  const next = q('.itv-next');
  if (next) next.click();
  out.zoomBackAfterStep = await waitFor(() => !disabled('viewer-zoom-in'), 5000);
  out.percentAfterStep = await settled('100%');

  // J. 回帰: ダブルクリックのフィット切替（トグルボタンと同じ関数を共用させたので、
  //    ジェスチャ側が巻き添えで壊れていないことを見る）
  const media = q('.itv-tc img.itv-media');
  if (media) media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.percentAfterDblclick = await settled('250%');
  if (media) media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.percentAfterDblclickBack = await settled('100%');

  // K. 回帰（#134）: ホイールを速く4ノッチ回すと 1.25^4 = 2.44… ぶん効く。
  //    累積ターゲットを共有し損ねて live scale から計算し直すと、tween 途中の値を
  //    基準にする分だけ回した量が飲まれてここが小さくなる。
  const wrap = q('.itv-tw');
  if (wrap) {
    const wr = wrap.getBoundingClientRect();
    for (let i = 0; i < 4; i++) wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: wr.left + wr.width / 2, clientY: wr.top + wr.height / 2, bubbles: true, cancelable: true }));
  }
  out.percentAfterFastWheel = await settled('244%');

  out.errors = errors;
  return JSON.stringify(out);
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
  const r = readEvalResult(out);
  if (!r) {
    console.log('IMAGE_ZOOM_TEST_FAIL (no eval result)');
    process.exit(1);
  }
  const checks = [
    ['グリッドタブにビューアツールバーは無い', r.toolbarInGrid === false],
    ['グリッドタブでは検索欄が出ている', r.searchInGrid === true],
    ['ダブルクリックで画像ビューが開く', r.imageViewActive === true],
    ['画像ビューでツールバーが帯に出る', r.toolbarInImageView === true],
    ['画像ビュー中は検索欄が引っ込む', r.searchInImageView === false],
    ['フィット時の表示は 100%（原寸=100% に正規化されている）', r.percentAtFit === '100%'],
    ['フィットではズームアウトが disabled', r.zoomOutDisabledAtFit === true],
    ['フィットでもズームインは押せる', r.zoomInEnabledAtFit === true],
    ['＋ が1段（1.25倍）ズームする', r.percentAfterZoomIn === '125%'],
    ['拡大するとズームアウトが押せるようになる', r.zoomOutEnabledAfterIn === true],
    ['− が1段戻す', r.percentAfterZoomOut === '100%'],
    ['フィット→原寸トグルが効く', r.percentAfterToggleOut === '250%'],
    ['原寸→フィットトグルが効く', r.percentAfterToggleBack === '100%'],
    ['Ctrl+1 が原寸へ飛ぶ', r.percentAfterCtrl1 === '250%'],
    ['Ctrl+0 がフィットへ戻す', r.percentAfterCtrl0 === '100%'],
    ['Alt+← でグリッドへ戻る', r.leftImageView === true],
    ['グリッドへ戻るとツールバーは消える', r.toolbarAfterBack === false],
    ['グリッドへ戻ると検索欄が戻る', r.searchAfterBack === true],
    ['動画スライドが開く', r.videoViewActive === true && r.videoSlideIsVideo === true],
    ['動画スライドでもツールバーは残る（クラスタごと消さない）', r.videoToolbarPresent === true],
    ['動画スライドではズーム系が disabled', r.videoZoomInDisabled === true && r.videoZoomOutDisabled === true && r.videoFitDisabled === true],
    ['動画スライドの表示%はプレースホルダ', r.videoPercent === '—'],
    ['次の画像スライドへ送るとズームが生き返る', r.zoomBackAfterStep === true],
    ['生き返ったスライドの表示は 100%', r.percentAfterStep === '100%'],
    ['回帰: ダブルクリックが原寸へ切り替える', r.percentAfterDblclick === '250%'],
    ['回帰: もう一度のダブルクリックでフィットへ戻る', r.percentAfterDblclickBack === '100%'],
    ['回帰(#134): 速いホイール4ノッチが 1.25^4 ぶん効く', r.percentAfterFastWheel === '244%'],
    ['no handler threw', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'IMAGE_ZOOM_TEST_FAIL' : 'IMAGE_ZOOM_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
