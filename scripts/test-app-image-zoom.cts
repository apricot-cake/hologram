'use strict';

// Verifies the image view's toolbar (#150) in the real renderer.
//
// The pure unit test (scripts/image-zoom.test.ts) only covers the zoom-factor arithmetic
// and the controller-registration bookkeeping. Whether "the toolbar actually shows up in
// the top band", "the buttons actually drive the viewer", and "it goes disabled on a video
// slide" only get decided once the React tree and the store are all wired together — that's
// what this covers.
//
//   - the toolbar doesn't exist on the grid tab / appears once the image view is opened
//   - the search field (the grid's predicate) retracts while in the image view
//   - + / - move the displayed % one step at a time, and - is disabled at fit
//   - the fit<->actual-size toggle and Ctrl+1 / Ctrl+0 land at the same place
//   - the zoom controls go disabled on a video slide (not the whole cluster hidden)
//     -> come back once you step to the next image slide
//
// The look itself (how readable the % is, what the icons mean) belongs to eyeballing the
// real Electron app. This boots its own sandboxed Electron instance (HOLOGRAM_SMOKE).
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

// z1: a post with a single image. It's a 1x1 JPEG, so it's "an image smaller than the
// frame" — fit is already at actual size (100% shown), which hits the branch where jumping
// to actual size uses the fixed 2.5x (=250%) multiplier. Full coverage of the zoom-factor
// arithmetic itself belongs to the pure unit test.
// z2: a gallery that starts with a video (ordered actual-size mp4 -> screenshot jpg) —
// material for checking that the zoom controls are disabled on slide 1 and come back to
// life once you step to slide 2.
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
  // Addressed by what the card says (no key attribute on the cells — #618).
  const postCards = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (text) => postCards().find(c => (c.textContent || '').includes(text));
  const dblclick = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const zoomLevel = () => { const el = q('[data-slot="viewer-zoom-level"]'); return el ? el.textContent.trim() : null; };
  const btn = (slot) => q('[data-slot="' + slot + '"]');
  const press = (slot) => { const b = btn(slot); if (b) b.click(); };
  const disabled = (slot) => { const b = btn(slot); return !!(b && b.disabled); };
  // Zoom eases in over 180-200ms, so wait for the value to settle before reading it.
  const settled = async (want) => { await waitFor(() => zoomLevel() === want, 3000); return zoomLevel(); };
  const chord = (key, mods) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: key, bubbles: true, cancelable: true }, mods)));
  const searchShown = () => { const el = q('[data-slot="toolbar-search"]'); return !!(el && el.getClientRects().length); };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out = {};

  await waitFor(() => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 2);

  // A. Grid tab: the toolbar doesn't exist (the search field is shown)
  out.toolbarInGrid = !!q('[data-slot="viewer-toolbar"]');
  out.searchInGrid = searchShown();

  // B. Open the image view -> the toolbar appears in the band, the search field retracts
  dblclick(cardOf('ズーム対象'));
  out.imageViewActive = await waitFor(() => !!q('[data-slot="image-tab-view"]'));
  out.toolbarInImageView = await waitFor(() => !!q('[data-slot="viewer-toolbar"]'));
  out.searchInImageView = searchShown();

  // C. The displayed % while at fit, and - being disabled (can't shrink further)
  // The toolbar shows the placeholder until the picture has decoded, and settled()'s
  // budget is the zoom easing (~200ms), not a picture load. On the nightly Windows
  // runner the decode outlived it and this read "—" while every later step passed
  // (#818) — the wait for the picture is its own step now, and its own check below,
  // so "the picture never arrived" cannot arrive disguised as "fit is not 100%".
  out.pictureReady = await waitFor(() => {
    const z = zoomLevel();
    return !!z && z !== '—';
  }, 15000);
  out.percentAtFit = await settled('100%');
  out.zoomOutDisabledAtFit = disabled('viewer-zoom-out');
  out.zoomInEnabledAtFit = !disabled('viewer-zoom-in');

  // D. + moves one step (1.25x), - moves back
  press('viewer-zoom-in');
  out.percentAfterZoomIn = await settled('125%');
  out.zoomOutEnabledAfterIn = !disabled('viewer-zoom-out');
  press('viewer-zoom-out');
  out.percentAfterZoomOut = await settled('100%');

  // E. Fit<->actual-size toggle (a 1x1 image, so actual-size uses the fixed 2.5x = 250% multiplier)
  press('viewer-fit-toggle');
  out.percentAfterToggleOut = await settled('250%');
  press('viewer-fit-toggle');
  out.percentAfterToggleBack = await settled('100%');

  // F. Ctrl+1 = actual size / Ctrl+0 = fit (calls the same function as the toggle)
  chord('1', { ctrlKey: true });
  out.percentAfterCtrl1 = await settled('250%');
  chord('0', { ctrlKey: true });
  out.percentAfterCtrl0 = await settled('100%');

  // G. Back to the grid (Alt+<-) -> the toolbar disappears, the search field returns
  chord('ArrowLeft', { altKey: true });
  out.leftImageView = await waitFor(() => !q('[data-slot="image-tab-view"]'));
  out.toolbarAfterBack = !!q('[data-slot="viewer-toolbar"]');
  out.searchAfterBack = searchShown();

  // H. A post that starts with a video -> the zoom controls stay "present but disabled"
  dblclick(cardOf('動画つき'));
  out.videoViewActive = await waitFor(() => !!q('[data-slot="image-tab-view"]'));
  await waitFor(() => !!q('[data-slot="viewer-toolbar"]'));
  out.videoSlideIsVideo = !!q('[data-slot="image-tab-stage"] video');
  out.videoToolbarPresent = !!q('[data-slot="viewer-toolbar"]');
  out.videoZoomInDisabled = disabled('viewer-zoom-in');
  out.videoZoomOutDisabled = disabled('viewer-zoom-out');
  out.videoFitDisabled = disabled('viewer-fit-toggle');
  out.videoPercent = zoomLevel();

  // I. Comes back to life once you step to the next slide (the screenshot image)
  const next = q('[data-slot="image-tab-next"]');
  if (next) next.click();
  out.zoomBackAfterStep = await waitFor(() => !disabled('viewer-zoom-in'), 5000);
  out.percentAfterStep = await settled('100%');

  // J. Regression: double-click fit switching (it shares the same function as the toggle
  //    button, so check the gesture side wasn't broken as collateral damage)
  const media = q('[data-slot="viewer-image"]');
  if (media) media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.percentAfterDblclick = await settled('250%');
  if (media) media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.percentAfterDblclickBack = await settled('100%');

  // K. Regression (#134): spinning the wheel fast through 4 notches applies 1.25^4 = 2.44x
  //    worth of zoom. If the cumulative target fails to be shared and gets recomputed from
  //    the live scale instead, using an in-tween value as the basis eats part of the amount
  //    turned, and this number comes out smaller.
  const wrap = q('[data-slot="viewer-zoom-wrapper"]');
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
    ['画像が読み込まれ、表示%がプレースホルダを抜けている', r.pictureReady === true],
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
