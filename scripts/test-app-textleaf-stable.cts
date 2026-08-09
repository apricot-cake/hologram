'use strict';

// 残っていたテキストリーフの安定性不変条件を検証する（以前はレビューでのみ主張されて
// いた――BACKLOG「leftover」）:
//   タブ復元時の重複リーフ: 編集中のテキストリーフは、タブの往復を経ても重複せずに
//   生き残る。「いぬ」と入力（Enterなし）→新しいタブを開く→戻る→ボックスの値が
//   復元され、かつ同じリーフに再結合される。だからもう1文字入力するとそのリーフを
//   EDIT（チップは1のまま）し、2つ目を生まない。
//   シード: p0テキスト「ネコかわいい」/ p1「こんにちは世界」/ p2「いぬのおさんぽ」
// （旧パートB――確定したリーフの完全一致/あいまい一致モードを凍結する――は、検索モード
// トグル自体の廃止とともに引退した＝P2④の単一スマート検索にはリーフごとのモードが無い。）
//
//   node scripts/test-app-textleaf-stable.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-stb-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-stb' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (300 + i),
    platform: 'x',
    text: texts[i],
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  // フィルタチップ＝FilterChipsコンポーネント（[data-slot=filter-chips]、チップ1件に
  // つきspan1個）。このテストではテキスト条件しか有効ではないので、すべてのチップを
  // 数えることがテキストチップを数えることになる。
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipText = () => {
    const row = chipRow();
    return row ? row.textContent || '' : '';
  };
  const textChips = () => {
    const row = chipRow();
    return row ? row.querySelectorAll(':scope > span').length : 0;
  };
  const activeTab = () => {
    const el = document.querySelector<HTMLElement>('[data-slot="tab"][data-active]');
    return el ? el.dataset.tabId : null;
  };
  // オプショナルチェイニングではなく名前を付ける＝これらはそれぞれがそのステップ
  // 自体であり、無ければ実行を止めて、どのコントロールが無かったのかを言わなければ
  // ならない。後のアサーションに別のことを報告させたままにはしない。
  const mustEl = (sel, what) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) throw new Error(what + ' が見つからない (' + sel + ')');
    return el;
  };
  await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => cards() >= 3);
  // searchboxコンポーネントのAutocomplete入力（P2④以降#searchBoxというidは無い）。
  const sb = document.querySelector<HTMLInputElement>('input[placeholder="テキスト・ユーザー名で検索"]');
  if (!sb) throw new Error('the search box input is missing from the filter bar');
  // Reactの制御された入力: prototypeのsetter経由で書き込み、+ 'input'イベント
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!nativeSetter) throw new Error('HTMLInputElement.prototype に、制御された検索ボックスを駆動するための value セッターが無い');
  const setVal = (v) => {
    nativeSetter.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const r: Record<string, any> = {};

  // --- 編集中のテキストリーフはタブの往復を経ても重複せずに生き残る ---
  // ここで言う「安定」とは、タブを往復してもリーフの同一性が保たれることであり、
  // 画面の動きが止まることではない――だから以下のどのチェックにも固定の遅延は要らない。
  // 必要なのは「何を待つか」への注意だ＝各ステップのチップ件数はアサートされ、
  // それぞれのステップは既に期待どおりの件数（編集では1→1）の状態から始まる。だから
  // その件数を待ってしまうと、編集PRE状態のまま返ってきて、重複したリーフを通して
  // しまう。だから各待機はチップのTEXT（あるいはボックス、あるいはアクティブタブ）を
  // 見ていて、件数はアサーションに任せている。
  setVal('いぬ');
  await waitFor('入力した語がチップとして現れ、グリッドがその1件に絞られること', () => chipText().includes('いぬ') && cards() === 1);
  r.aChips = textChips(); // 1（編集中のリーフ）
  r.aCards = cards(); // 1 (いぬのおさんぽ)
  const firstTab = activeTab();
  mustEl('[data-slot="tab-new"]', 'new-tab button').click(); // addTab→新規の空タブ
  await waitFor('新規タブがフィルタ無しのライブラリを引き継ぐこと', () => activeTab() !== firstTab && !chipRow() && cards() === 3);
  r.newChips = textChips(); // 0（新規タブは空）
  r.newCards = cards(); // 3（全件）
  mustEl('[data-slot="tab"][data-tab-id="' + firstTab + '"]', 'first tab').click(); // 戻る
  // '=== 1'ではなく'>= 1': 重複したリーフでも下のアサーションまで確実に到達させるため。
  await waitFor('最初のタブが検索語をボックスに保ったまま戻ること', () => activeTab() === firstTab && sb.value === 'いぬ' && textChips() >= 1 && cards() === 1);
  r.backChips = textChips(); // 1（復元されたリーフ）
  r.backCards = cards(); // 1
  r.backBox = sb.value; // 'いぬ'
  setVal('いぬの'); // もう1文字追加する――再結合されたリーフをEDITしなければならない
  await waitFor('チップが追加した文字に追従すること', () => chipText().includes('いぬの'));
  r.editChips = textChips(); // 1（2ではない――これが本題のアンチリグレッション）
  r.editCards = cards(); // 1 (いぬのおさんぽ)

  setVal('');
  await waitFor('空にしたボックスでチップ行が消えグリッドのフィルタが外れること', () => !chipRow() && cards() === 3);
  r.resetChips = textChips(); // 0
  r.resetCards = cards(); // 3
  return r;
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
      /* 無視 */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.aChips === 1 && r.aCards === 1 && r.newChips === 0 && r.newCards === 3 && r.backChips === 1 && r.backCards === 1 && r.backBox === 'いぬ' && r.editChips === 1 && r.editCards === 1 && r.resetChips === 0 && r.resetCards === 3;
  console.log(`aChips=${r.aChips} aCards=${r.aCards} newChips=${r.newChips} newCards=${r.newCards} backChips=${r.backChips} backCards=${r.backCards} backBox="${r.backBox}" editChips=${r.editChips} editCards=${r.editCards} resetChips=${r.resetChips} resetCards=${r.resetCards}`);
  console.log(ok ? 'TEXTLEAF_STABLE_TEST_PASS' : 'TEXTLEAF_STABLE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
