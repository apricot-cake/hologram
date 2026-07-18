'use strict';

// Verifies the search term as a first-class 'text' leaf in the query tree (the
// search box edits a tree leaf; single smart search since P2④ — no exact/fuzzy
// toggle):
//   - typing「ねこ」creates ONE text chip in the filter-chip row and the smart
//     matcher hits the katakana body「ネコかわいい」→ 1 card
//   - Enter confirms: box clears, the term chip stays
//   - typing a second term「いぬ」adds a SECOND text chip (両立・AND なので 0 cards)
//   - the chip's ✕ removes just that term
// OR-drag of two leaves is checked on the real app (drag synthesis is brittle in
// a smoke harness).
//
//   node scripts/test-app-textleaf.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-tl-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-tl' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  // Filter chips live in the FilterChips island ([data-slot=filter-chips]); each chip
  // is a direct span child. Only text terms are active in this test, so counting all
  // chips counts the text chips.
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const textChips = () => (chipRow() ? chipRow().querySelectorAll(':scope > span').length : 0);
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);
  // The searchbox island's Autocomplete input (no #searchBox id since P2④; the ja
  // placeholder is the stable accessible handle).
  const sb = document.querySelector('input[placeholder="テキスト・ユーザー名で検索"]');
  // React controlled input: write via the prototype setter + 'input'
  const setVal = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const r = {};
  // A: typing「ねこ」→ one text chip + the smart matcher hits カタカナ本文 → 1
  setVal('ねこ');
  await wait(240);
  r.chipTyping = textChips();       // 1 (the editing leaf is already a chip)
  r.cardsKana = cards();            // 1 (単一スマート検索: ひらがな↔カタカナ正規化)
  // B: Enter confirms — box clears, the term chip stays
  sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(140);
  r.boxAfterEnter = sb.value;       // ''
  r.chipAfterEnter = textChips();   // 1
  // C: a second term → a second text chip (両立・AND なので 0 cards)
  setVal('いぬ');
  await wait(240);
  r.chips2 = textChips();           // 2
  r.cardsAnd = cards();             // 0 (ねこ AND いぬ に合う投稿はない)
  // D: the second chip's ✕ removes just that term → back to 1 chip / 1 card
  const xBtns = chipRow().querySelectorAll(':scope > span > button[aria-label]');
  xBtns[xBtns.length - 1].click();
  await wait(240);
  r.chipsAfterX = textChips();      // 1
  r.cardsAfterX = cards();          // 1 (ねこ だけに戻る)
  return r;
})()`;

const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
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
  const ok = r.chipTyping === 1 && r.cardsKana === 1 && r.boxAfterEnter === '' && r.chipAfterEnter === 1 && r.chips2 === 2 && r.cardsAnd === 0 && r.chipsAfterX === 1 && r.cardsAfterX === 1;
  console.log(`chipTyping=${r.chipTyping} cardsKana=${r.cardsKana} boxAfterEnter="${r.boxAfterEnter}" chipAfterEnter=${r.chipAfterEnter} chips2=${r.chips2} cardsAnd=${r.cardsAnd} chipsAfterX=${r.chipsAfterX} cardsAfterX=${r.cardsAfterX}`);
  console.log(ok ? 'TEXTLEAF_TEST_PASS' : 'TEXTLEAF_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
