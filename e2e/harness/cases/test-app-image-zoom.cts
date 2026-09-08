'use strict';

// 画像ビューのツールバー（#150）を実際のレンダラーで検証する。
//
// 純粋な単体テスト（app/src/renderer/src/services/image-zoom.test.ts）はズーム倍率の算術とコントローラー
// 登録の帳簿だけをカバーする。「ツールバーが実際に上部の帯に出るか」「ボタンが
// 実際にビューアを操作するか」「動画スライドでdisabledになるか」は、Reactの
// treeとストアが全部配線されて初めて決まる＝それがこれのカバー範囲。
//
//   - ツールバーはグリッドタブには存在せず、画像ビューを開くと現れる
//   - 検索欄（グリッドの述語）は画像ビュー中は引っ込む
//   - +/-は表示%を1段ずつ動かし、フィット時は-がdisabledになる
//   - フィット<->原寸のトグルとCtrl+1/Ctrl+0は同じ場所に着地する
//   - ズームのコントロールは動画スライドでdisabledになる（クラスタごと隠すの
//     ではない）→次の画像スライドへ進むと生き返る
//
// 見た目そのもの（%の読みやすさ、アイコンの意味）は実際のElectronアプリを
// 目視する領分。これは自前のサンドボックス化したElectronインスタンスを起動
// する（HOLOGRAM_SMOKE）。
//
//   node e2e/harness/cases/test-app-image-zoom.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { readEvalResult } = require('../../../scripts/lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-imagezoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// z1: 単一画像の投稿。1x1のJPEGなので「フレームより小さい画像」＝フィットは
// 既に原寸（100%表示）にあり、原寸への切り替えが固定の2.5倍（=250%）の倍率を
// 使う分岐に当たる。ズーム倍率の算術そのものの網羅は純粋な単体テストの領分。
// z2: 動画から始まるギャラリー（順序は原寸mp4→原本jpg）＝
// スライド1でズームコントロールがdisabledになり、スライド2へ進むと生き返る
// ことを確かめるための材料。
fs.writeFileSync(path.join(saveFolder, 'dummy-z1.jpg'), jpeg);
fs.writeFileSync(path.join(saveFolder, 'dummy-z2.jpg'), jpeg);
fs.writeFileSync(path.join(saveFolder, 'dummy-z2-orig.mp4'), Buffer.from('not a real clip'));

const records = [
  {
    captureId: 'dummy-z1',
    image: null,
    url: 'https://x.com/u1/status/901',
    platform: 'x',
    text: 'ズーム対象',
    displayName: '人1',
    screenName: 'u1',
    capturedAt: '2026-05-01T12:00:00Z',
    date: '2026-04-01T10:00:00Z',
    media: [{ file: 'dummy-z1.jpg', url: 'https://x.com/i/1.jpg' }],
    tags: [],
    hashtags: [],
  },
  {
    captureId: 'dummy-z2',
    image: null,
    url: 'https://x.com/u2/status/902',
    platform: 'x',
    text: '動画つき',
    displayName: '人2',
    screenName: 'u2',
    capturedAt: '2026-05-02T12:00:00Z',
    date: '2026-04-02T10:00:00Z',
    media: [
      { file: 'dummy-z2-orig.mp4', url: 'https://x.com/i/2.mp4' },
      { file: 'dummy-z2.jpg', url: 'https://x.com/i/2.jpg' },
    ],
    tags: [],
    hashtags: [],
  },
];
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const q = (sel) => document.querySelector<HTMLElement>(sel);
  // カードが言うテキストで特定する（セルにkey属性は無い＝#618）。
  const postCards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (text) => postCards().find((c) => (c.textContent || '').includes(text));
  const dblclick = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const zoomLevel = () => {
    const el = q('[data-slot="viewer-zoom-level"]');
    return el ? (el.textContent || '').trim() : null;
  };
  const btn = (slot) => document.querySelector<HTMLButtonElement>('[data-slot="' + slot + '"]');
  const press = (slot) => {
    const b = btn(slot);
    if (b) b.click();
  };
  const disabled = (slot) => {
    const b = btn(slot);
    return !!(b && b.disabled);
  };
  // ズームは180〜200msかけてイーズインするので、読む前に値が落ち着くのを待つ。
  // この待機は欲しい%を名指しするが検証の代わりにはならない: それは実際に
  // ツールバーが読んでいる値をそのまま返すので、別の場所に着地したズームも
  // ちゃんと失敗し、それがどのステップだったかを言う。
  const settled = async (want) => {
    await waitFor('the zoom level to settle at ' + want, () => zoomLevel() === want, 3000);
    return zoomLevel();
  };
  const chord = (key, mods) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: key, bubbles: true, cancelable: true }, mods)));
  const searchShown = () => {
    const el = q('[data-slot="toolbar-search"]');
    return !!(el && el.getClientRects().length);
  };
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  await waitFor('the grid to show both seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 2);

  // A. グリッドタブ: ツールバーは存在しない（検索欄が表示されている）
  out.toolbarInGrid = !!q('[data-slot="viewer-toolbar"]');
  out.searchInGrid = searchShown();

  // B. 画像ビューを開く → ツールバーが帯に現れ、検索欄が引っ込む
  dblclick(cardOf('ズーム対象'));
  out.imageViewActive = await waitFor('the image view to open on the double-clicked post', () => !!q('[data-slot="image-tab-view"]'));
  out.toolbarInImageView = await waitFor('the viewer toolbar to appear in the top band', () => !!q('[data-slot="viewer-toolbar"]'));
  out.searchInImageView = searchShown();

  // C. フィット時の表示%、そして-がdisabledであること（これ以上縮められない）
  // ツールバーは画像がデコードされるまでプレースホルダを表示し、settled()の
  // 予算はズームのイーズング（約200ms）であって画像の読み込みではない。夜間の
  // Windowsランナーではデコードがそれより長引き、後の全てのステップが通る中で
  // これだけが"—"を読んでいた（#818）＝画像を待つことは今では独立したステップで
  // あり下に独立した検査があるので、「画像がまだ来ていない」が「フィットが
  // 100%ではない」に化けて紛れ込むことはない。
  out.pictureReady = await waitFor(
    'the picture to decode and the toolbar % to leave its placeholder',
    () => {
      const z = zoomLevel();
      return !!z && z !== '—';
    },
    15000,
  );
  out.percentAtFit = await settled('100%');
  out.zoomOutDisabledAtFit = disabled('viewer-zoom-out');
  out.zoomInEnabledAtFit = !disabled('viewer-zoom-in');

  // D. +は1段動く（1.25倍）、-は戻す
  press('viewer-zoom-in');
  out.percentAfterZoomIn = await settled('125%');
  out.zoomOutEnabledAfterIn = !disabled('viewer-zoom-out');
  press('viewer-zoom-out');
  out.percentAfterZoomOut = await settled('100%');

  // E. フィット<->原寸のトグル（1x1画像なので原寸は固定2.5倍=250%の倍率を使う）
  press('viewer-fit-toggle');
  out.percentAfterToggleOut = await settled('250%');
  press('viewer-fit-toggle');
  out.percentAfterToggleBack = await settled('100%');

  // F. Ctrl+1 = 原寸 / Ctrl+0 = フィット（トグルと同じ関数を呼ぶ）
  chord('1', { ctrlKey: true });
  out.percentAfterCtrl1 = await settled('250%');
  chord('0', { ctrlKey: true });
  out.percentAfterCtrl0 = await settled('100%');

  // G. グリッドへ戻る（Alt+←）→ ツールバーが消え、検索欄が戻る
  chord('ArrowLeft', { altKey: true });
  out.leftImageView = await waitFor('the image view to close on Alt+←', () => !q('[data-slot="image-tab-view"]'));
  out.toolbarAfterBack = !!q('[data-slot="viewer-toolbar"]');
  out.searchAfterBack = searchShown();

  // H. 動画から始まる投稿 → ズームコントロールは「存在するがdisabled」のまま
  dblclick(cardOf('動画つき'));
  out.videoViewActive = await waitFor('the image view to open on the post that starts with a video', () => !!q('[data-slot="image-tab-view"]'));
  await waitFor('the viewer toolbar to appear on the video slide', () => !!q('[data-slot="viewer-toolbar"]'));
  out.videoSlideIsVideo = !!q('[data-slot="image-tab-stage"] video');
  out.videoToolbarPresent = !!q('[data-slot="viewer-toolbar"]');
  out.videoZoomInDisabled = disabled('viewer-zoom-in');
  out.videoZoomOutDisabled = disabled('viewer-zoom-out');
  out.videoFitDisabled = disabled('viewer-fit-toggle');
  out.videoPercent = zoomLevel();

  // I. 次のスライド（原本画像）へ進むと生き返る
  const next = q('[data-slot="image-tab-next"]');
  if (next) next.click();
  out.zoomBackAfterStep = await waitFor('the zoom controls to come back to life on the next (image) slide', () => !disabled('viewer-zoom-in'), 5000);
  out.percentAfterStep = await settled('100%');

  // J. 回帰: ダブルクリックによるフィット切り替え（トグルボタンと同じ関数を
  //    共有するので、ジェスチャ側が巻き添えで壊れていないか確認する）
  const media = q('[data-slot="viewer-image"]');
  if (media) media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.percentAfterDblclick = await settled('250%');
  if (media) media.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  out.percentAfterDblclickBack = await settled('100%');

  // K. 回帰（#134）: ホイールを4ノッチ速く回すと1.25^4 = 2.44倍ぶんのズームが
  //    適用される。累積の目標値が共有されず、代わりに現在のスケールから再計算
  //    されてしまうと、トゥイーン中の値を基準にすることで回した量の一部が
  //    食われ、この数値はより小さく出てしまう。
  const wrap = q('[data-slot="viewer-zoom-wrapper"]');
  if (wrap) {
    const wr = wrap.getBoundingClientRect();
    for (let i = 0; i < 4; i++) wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: wr.left + wr.width / 2, clientY: wr.top + wr.height / 2, bubbles: true, cancelable: true }));
  }
  out.percentAfterFastWheel = await settled('244%');

  out.errors = errors;
  return JSON.stringify(out);
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
  const r = readEvalResult(out);
  if (!r) {
    console.log('IMAGE_ZOOM_TEST_FAIL（eval結果なし）');
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
    ['ハンドラが例外を投げなかった', Array.isArray(r.errors) && r.errors.length === 0],
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
