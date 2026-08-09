'use strict';

// カードフッターのノイズゲート（カードモデルの showEngagement/showCaptured）を
// 検証する:
//  - 静止時（日付ソート、フィルタ無し）は、エンゲージメントの統計行も 📷
//    キャプチャ日時も「描画されない」— 投稿日だけが描画される
//  - エンゲージメントソート（いいね降順）はカードに統計行を出す
//  - キャプチャソート（キャプチャ降順）はキャプチャ日時を出し、統計は再び消える
//
// #618 はこれを CSS（グリッドコンテナ上の2つのクラスが、常にそこにあった
// マークアップを隠す方式）からカードモデルの側へ移した。だから主張は
// `display` についてではなく、カードがその部品を「持っているか」についてに
// なる。ソートは表示ポップオーバー経由で駆動する — かつて突いていた隠れた
// <select> はもう無いので、これが人が使うのと同じ画面。
//
//   node scripts/test-app-cardfoot.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-cf-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// capturedAt は date とは「違う」日に着地させ、📷 のキャプチャ日時が描画
// されるようにする（同日のキャプチャは cardModel で重複除去されて消える）。
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-cf' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (800 + i),
    platform: 'x',
    text: '投稿' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-05-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const has = (slot) => !!document.querySelector('[data-slot="post-grid"] [data-slot="' + slot + '"]');
  const byText = (sel, text) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  // フッター自身のマークアップこそが以下のすべての主張が読むものなので、
  // これらの待ちのどれもそれに言及してはならない: どれもフッターより「前」の
  // ステップ（メニュー、トリガー自身のラベル、ポップオーバーが閉じること）で
  // 止まり、最後だけが再描画が静まるのを待つ（#986）。
  const gridChurn = () => cards() + ':' + document.querySelector('[data-slot="post-grid"]')?.textContent;
  const sortTrigger = () => document.querySelector<HTMLElement>('[data-slot="select-trigger"]');
  // 人がやるのと同じやり方でソートを選ぶ: 表示 ポップオーバー → ソートの
  // Select → その選択肢。
  const setSort = async (label) => {
    // 各コントロールは名前を付けてあり、オプショナルチェインではなく例外を
    // 投げる: それがそのままステップなので、無い場合は実行を止めてどの
    // コントロールが無かったかを言うべき。`?.` だとクリックを飛ばして
    // しまい、後の主張が無関係な何かを報告することになる。
    const openDisplay = byText('button', '表示');
    if (!openDisplay) throw new Error('ツールバーに 表示 ボタンが見つからない');
    openDisplay.click();
    await waitFor('表示 ポップオーバーがソートコントロールを示すこと', () => !!sortTrigger());
    const trigger = sortTrigger();
    if (!trigger) throw new Error('表示 ポップオーバーにソートコントロールが見つからない');
    trigger.click();
    await waitFor('ソートメニューが ' + label + ' を一覧すること', () => !!byText('[data-slot="select-item"]', label));
    const option = byText('[data-slot="select-item"]', label);
    if (!option) throw new Error('ソートメニューにソートの選択肢 ' + label + ' が見つからない');
    option.click();
    // SelectValue は選んだ選択肢を描画するので、トリガーがそれを読み返す
    // ことが選択の観測可能な事後条件 — そしてそれはこのテストが主張して
    // いることではない。
    await waitFor('ソートコントロールが ' + label + ' を読み返すこと', () => (sortTrigger()?.textContent || '').includes(label));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor('表示 ポップオーバーが閉じること', () => !document.querySelector('[data-slot="popover-content"]:not([data-closed])'));
    await waitFor('再ソート後もグリッドが3件すべてを保つこと', () => cards() >= 3);
    await waitStable('再ソートされたグリッドが再描画を止めること', gridChurn);
  };
  await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => cards() >= 3);
  // 静止時: フッターにあるのは投稿日だけ
  const defStats = has('post-card-stats');
  const defCdate = has('post-card-capdate');
  const defPdate = has('post-card-date');
  // エンゲージメントソート → 件数そのものが焦点になるので描画される
  await setSort('いいね順');
  const engStats = has('post-card-stats');
  // キャプチャソート → キャプチャ日時が描画され、件数は再び消える
  await setSort('キャプチャ日時順');
  const capCdate = has('post-card-capdate');
  const capStats = has('post-card-stats');
  return { defStats, defCdate, defPdate, engStats, capCdate, capStats };
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.defStats === false && r.defCdate === false && r.defPdate === true && r.engStats === true && r.capCdate === true && r.capStats === false;
  console.log(`defStats=${r.defStats} defCdate=${r.defCdate} defPdate=${r.defPdate} engStats=${r.engStats} capCdate=${r.capCdate} capStats=${r.capStats}`);
  console.log(ok ? 'CARDFOOT_TEST_PASS' : 'CARDFOOT_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
