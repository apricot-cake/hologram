'use strict';

// Verifies the two remaining text-leaf stability invariants that were previously
// only argued by review (BACKLOG「残」):
//   Part A — タブ復元の二重葉: an EDITING text leaf survives a tab round-trip without
//     duplicating. Type「いぬ」(no Enter) → open a new tab → switch back → the box value
//     is restored AND rebound to the same leaf, so typing one more char EDITS that leaf
//     (chips stay 1) instead of spawning a second one.
//   Part B — 確定済みモード不変: a CONFIRMED leaf freezes its mode. Confirm「ねこ」in
//     ぴったり (exact ⇒ ひらがな ≠ カタカナ body ⇒ 0). Flip the toggle to おおまか and the
//     confirmed leaf must NOT follow (stays 0), and a re-save shows the leaf's mode is
//     still 'exact'. (The editing leaf DOES follow the toggle — covered by test-app-textleaf.js.)
//   seeds: p0 本文「ネコかわいい」/ p1「こんにちは世界」/ p2「いぬのおさんぽ」
//
//   node scripts/test-app-textleaf-stable.js

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-stb-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-stb' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const cards = () => document.querySelectorAll('#postGrid .post-card').length;
  // Count only settled text chips, excluding CHIP_OUT_MS (200ms) exit-animation ghosts.
  // A ghost is marked .leaving at EITHER level: an item-level ghost (a value removed from a
  // surviving cluster) sets .leaving on the .qb-val; a cluster-level ghost (a whole
  // attribute removed — e.g. switching tabs drops the entire text cluster) sets .leaving on
  // the .qb-cluster only, NOT its child .qb-val. So exclude both: values that aren't leaving
  // AND live inside a cluster that isn't leaving (pointer-events:none ghosts aren't active).
  const textChips = () => document.querySelectorAll('#queryChips .qb-cluster:not(.leaving) .qb-val.qc-text:not(.leaving)').length;
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);
  const sb = document.getElementById('searchBox');
  // React controlled input (searchbox island): write via the prototype setter + 'input'
  const setVal = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const enter = () => sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const r = {};

  // --- Part A: editing text leaf survives a tab round-trip without duplicating ---
  setVal('いぬ'); await wait(240);
  r.aChips = textChips();          // 1 (editing leaf)
  r.aCards = cards();              // 1 (いぬのおさんぽ)
  const firstTab = (document.querySelector('.tab-item.active') || {}).dataset.tab;
  document.querySelector('.tab-new').click(); await wait(200);   // addTab → fresh empty tab
  r.newChips = textChips();        // 0 (new tab is empty)
  r.newCards = cards();            // 3 (all)
  document.querySelector('.tab-item[data-tab="' + firstTab + '"]').click(); await wait(240);  // back
  r.backChips = textChips();       // 1 (restored leaf)
  r.backCards = cards();           // 1
  r.backBox = sb.value;            // 'いぬ'
  setVal('いぬの'); await wait(240);   // append one more char — must EDIT the rebound leaf
  r.editChips = textChips();       // 1 (NOT 2 — the headline anti-regression)
  r.editCards = cards();           // 1 (いぬのおさんぽ)

  // reset back to the empty state before Part B
  setVal(''); await wait(240);
  r.resetChips = textChips();      // 0
  r.resetCards = cards();          // 3

  // --- Part B: a confirmed leaf freezes its mode (does NOT follow the toggle) ---
  setVal('ねこ'); await wait(240);
  enter(); await wait(160);        // confirm 「ねこ」in ぴったり (exact)
  r.confChips = textChips();       // 1
  r.confExactCards = cards();      // 0 (ひらがな ≠ カタカナ body)
  document.querySelector('#searchModeSeg .seg-opt[data-mode="fuzzy"]').click(); await wait(260);   // flip to おおまか
  r.afterFuzzyCards = cards();     // 0 — confirmed leaf stays exact, does NOT match ネコかわいい
  // afterFuzzyCards staying 0 across the flip IS the mode-freeze proof: had the confirmed
  // leaf followed the toggle to fuzzy it would now match ネコかわいい and cards would be 1.
  // The old tail also re-saved via the 保存検索 button and read the leaf mode back off a
  // kind:'dynamic' collection to double-check — but both retired with the collections view
  // (saveSearchBtn / dynamic collections gone), so that half tested removed UI. Dropped:
  // the behavioral assertion above already covers "the mode is frozen".
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
  const partA = r.aChips === 1 && r.aCards === 1 && r.newChips === 0 && r.newCards === 3 && r.backChips === 1 && r.backCards === 1 && r.backBox === 'いぬ' && r.editChips === 1 && r.editCards === 1 && r.resetChips === 0 && r.resetCards === 3;
  const partB = r.confChips === 1 && r.confExactCards === 0 && r.afterFuzzyCards === 0;
  const ok = partA && partB;
  console.log(`A: aChips=${r.aChips} aCards=${r.aCards} newChips=${r.newChips} newCards=${r.newCards} backChips=${r.backChips} backCards=${r.backCards} backBox="${r.backBox}" editChips=${r.editChips} editCards=${r.editCards} resetChips=${r.resetChips} resetCards=${r.resetCards}`);
  console.log(`B: confChips=${r.confChips} confExactCards=${r.confExactCards} afterFuzzyCards=${r.afterFuzzyCards}`);
  console.log(ok ? 'TEXTLEAF_STABLE_TEST_PASS' : 'TEXTLEAF_STABLE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
