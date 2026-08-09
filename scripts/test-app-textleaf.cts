'use strict';

// 検索語をクエリツリーの第一級「text」リーフとして検証する（検索ボックスは
// ツリーのリーフを編集する。P2④以降は単一のスマート検索＝exact/fuzzyの切替は無い）:
//   - 「ねこ」と入力するとフィルタチップの行にtextチップが1つでき、スマート
//     マッチャーがカタカナの本文「ネコかわいい」にヒットする → 1件
//   - Enterで確定: ボックスは空になり、語のチップは残る
//   - 2つ目の語「いぬ」を入力すると2つ目のtextチップが増える（両方成立=AND
//     なので0件）
//   - チップの✕でその語だけが消える
// 2つのリーフのOR-dragは実際のアプリで検証する（ドラッグの合成はsmokeハーネス
// では壊れやすい）。
//
//   node scripts/test-app-textleaf.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tl-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-tl' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (900 + i),
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
  // フィルタチップはFilterChipsコンポーネント（[data-slot=filter-chips]）に
  // 住み、各チップは直下のspanの子。このテストではtextの語しか有効にしないので、
  // 全チップを数えることがtextチップを数えることになる。
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipText = () => {
    const row = chipRow();
    return row ? row.textContent || '' : '';
  };
  const textChips = () => {
    const row = chipRow();
    return row ? row.querySelectorAll(':scope > span').length : 0;
  };
  await waitFor('the grid to show all 3 seeded posts', () => cards() >= 3);
  // searchboxコンポーネントのAutocomplete入力（P2④以降 #searchBox のidは無い。
  // 日本語のplaceholderが安定したアクセシブルな手がかり）。
  const sb = document.querySelector<HTMLInputElement>('input[placeholder="テキスト・ユーザー名で検索"]');
  // オプショナルチェーンではなく名前を付ける: 以下の各ステップはこの入力欄を
  // 操作するので、それが無ければ実行を止めてそう言わなければならない。検証に
  // 空のチップ行を報告させるのではなく。
  if (!sb) throw new Error('フィルタバーに検索ボックスの入力欄がありません');
  // Reactが制御する入力欄: prototypeのsetter + 'input'経由で書く
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!nativeSetter) throw new Error('HTMLInputElement.prototypeに、制御された検索ボックスを操作するvalue setterがありません');
  const setVal = (v) => {
    nativeSetter.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const r: Record<string, any> = {};
  // 入力はリーフに届くまで150msデバウンスされる（search-box-builder）ので、
  // 以下の各ステップは語が「着地する」のを待つ＝これから検証しようとしている
  // 件数を待つことは決してしない。それはクリック前の状態でも既に満たされて
  // しまうから。
  // A: 「ねこ」と入力 → textチップ1つ + スマートマッチャーがカタカナの本文に
  // ヒット → 1件
  setVal('ねこ');
  await waitFor('the typed term to show as a chip and narrow the grid to its one match', () => chipText().includes('ねこ') && cards() === 1);
  r.chipTyping = textChips(); // 1（編集中のリーフは既にチップになっている）
  r.cardsKana = cards(); // 1（単一のスマート検索: ひらがな⇔カタカナの正規化）
  // B: Enterで確定 — ボックスは空になり、語のチップは残る
  sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await waitFor('the search box to empty when Enter confirms the term', () => sb.value === '');
  r.boxAfterEnter = sb.value; // ''
  r.chipAfterEnter = textChips(); // 1
  // C: 2つ目の語 → 2つ目のtextチップ（両方成立=ANDなので0件）
  setVal('いぬ');
  await waitFor('the second term to join the chip row and leave the grid empty', () => chipText().includes('いぬ') && cards() === 0);
  r.chips2 = textChips(); // 2
  r.cardsAnd = cards(); // 0（ねこ AND いぬ に一致する投稿は無い）
  // D: 2つ目のチップの✕でその語だけが消える → 1チップ/1件に戻る
  const row = chipRow();
  if (!row) throw new Error('2つ目の語を消すはずの✕より前に、フィルタチップの行が消えています');
  const xBtns = row.querySelectorAll<HTMLElement>(':scope > span > button[aria-label]');
  xBtns[xBtns.length - 1].click();
  await waitFor('the second term to leave the chip row and its match to come back', () => !chipText().includes('いぬ') && cards() === 1);
  r.chipsAfterX = textChips(); // 1
  r.cardsAfterX = cards(); // 1（「ねこ」だけに戻る）
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
  const ok = r.chipTyping === 1 && r.cardsKana === 1 && r.boxAfterEnter === '' && r.chipAfterEnter === 1 && r.chips2 === 2 && r.cardsAnd === 0 && r.chipsAfterX === 1 && r.cardsAfterX === 1;
  console.log(`chipTyping=${r.chipTyping} cardsKana=${r.cardsKana} boxAfterEnter="${r.boxAfterEnter}" chipAfterEnter=${r.chipAfterEnter} chips2=${r.chips2} cardsAnd=${r.cardsAnd} chipsAfterX=${r.chipsAfterX} cardsAfterX=${r.cardsAfterX}`);
  console.log(ok ? 'TEXTLEAF_TEST_PASS' : 'TEXTLEAF_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
