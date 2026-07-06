'use strict';

// Verifies the search term as a first-class 'text' leaf in the query tree (the
// search box now edits a tree leaf instead of a special "付箋" chip):
//   - typing「ねこ」(ぴったり) creates ONE .qb-val.qc-text leaf chip (not the old
//     data-special="search" 付箋) and, exact-mode, does NOT match katakana body → 0 cards
//   - switching to おおまか makes the EDITING leaf follow the mode → matches「ネコかわいい」→ 1
//   - Enter confirms: box clears, the leaf chip stays
//   - typing a second term「いぬ」adds a SECOND text leaf chip (両立)
// OR-drag of two leaves and the frozen-mode of confirmed leaves are checked on the
// real app (drag synthesis is brittle in a smoke harness).
//
//   node scripts/test-app-textleaf.js

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
  // Count only settled text chips, excluding CHIP_OUT_MS (200ms) exit-animation ghosts a
  // removed/reconfirmed value keeps (pointer-events:none, stale data-nid = not active). A
  // ghost is marked .leaving at the .qb-val (item removed from a surviving cluster) OR only
  // at the .qb-cluster (whole attribute removed), so exclude both levels — a second term
  // reads ~40ms after the first is confirmed, inside the ghost window.
  const textChips = () => document.querySelectorAll('#queryChips .qb-cluster:not(.leaving) .qb-val.qc-text:not(.leaving)').length;
  const specialChips = () => document.querySelectorAll('#queryChips [data-special="search"]').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);
  const sb = document.getElementById('searchBox');
  // toolbar island: the fuzzy button is .seg-opt[data-mode] (old #searchModeFuzzy id gone)
  const fuzzyBtn = document.querySelector('#searchModeSeg .seg-opt[data-mode="fuzzy"]');
  // React controlled input (searchbox island): write via the prototype setter + 'input'
  const setVal = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const r = {};
  // A+B: exact「ねこ」→ one real qc-text leaf chip, no legacy 付箋, katakana body 非一致 → 0
  setVal('ねこ');
  await wait(240);
  r.chipExact = textChips();        // 1
  r.special = specialChips();       // 0 (legacy data-special chip gone)
  r.cardsExact = cards();           // 0 (ぴったり: ひらがな ≠ カタカナ)
  // C: switch to おおまか → the EDITING leaf follows the mode → matches ネコかわいい
  fuzzyBtn.click();
  await wait(240);
  r.cardsFuzzy = cards();           // 1
  // D: Enter confirms — box clears, the leaf chip stays
  sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(140);
  r.boxAfterEnter = sb.value;       // ''
  r.chipAfterEnter = textChips();   // 1
  // E: a second term → a second text leaf chip (両立)
  setVal('いぬ');
  await wait(240);
  r.chips2 = textChips();           // 2
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
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.chipExact === 1 && r.special === 0 && r.cardsExact === 0 && r.cardsFuzzy === 1 && r.boxAfterEnter === '' && r.chipAfterEnter === 1 && r.chips2 === 2;
  console.log(`chipExact=${r.chipExact} special=${r.special} cardsExact=${r.cardsExact} cardsFuzzy=${r.cardsFuzzy} boxAfterEnter="${r.boxAfterEnter}" chipAfterEnter=${r.chipAfterEnter} chips2=${r.chips2}`);
  console.log(ok ? 'TEXTLEAF_TEST_PASS' : 'TEXTLEAF_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
