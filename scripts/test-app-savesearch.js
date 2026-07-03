'use strict';

// Verifies the saved-search tree-unification (Stage 3): the search term lives as a
// 'text' leaf INSIDE the tree, not in a separate coll.q field — on BOTH save and open.
//   save:    type「投稿1」→ 1 card → click 保存 (prompt overridden) → the dynamic
//            collection carries the term as a text leaf, NO coll.q, box auto-confirms empty
//   restore: new tab (reset) → collections view → open the saved card → the tree (text
//            leaf included) is restored, box stays empty, 1 card, back in post mode
//   legacy:  a pre-text-leaf collection that stored only coll.q folds into a text leaf
//            on open (treeWithLegacyQ) → 1 leaf, 1 card
//
//   node scripts/test-app-savesearch.js

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ss-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-ss' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: 'https://x.com/u/status/' + (700 + i),
        platform: 'x',
        text: '投稿' + i,
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
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  await waitFor(() => cards() >= 3);
  const sb = document.getElementById('searchBox');
  // React controlled input (searchbox island): a bare .value write is invisible to
  // React's value tracker — go through the prototype setter, then fire 'input'.
  const setVal = (v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(sb, v);
    sb.dispatchEvent(new Event('input', { bubbles: true }));
  };
  setVal('投稿1');
  await wait(240);
  const r = {};
  r.leafCards = cards();   // 1 (投稿1 だけ一致)
  // Save the search (prompt overridden so it doesn't block the smoke run).
  const op = window.prompt; window.prompt = () => 'テスト保存';
  document.getElementById('saveSearchBtn').click();
  window.prompt = op;
  await wait(300);
  // allWithActive was retired with the collections view — allCollections() is the raw list
  const dyn = (window.corpusFolders.allCollections() || []).filter((c) => c.kind === 'dynamic');
  const c = dyn.find((x) => x.name === 'テスト保存');
  r.saved = !!c;
  r.hasQ = c ? ('q' in c) : null;                                              // false: q は保存しない
  r.leaves = c ? (c.tree.children || []).map((n) => n.type + ':' + n.value).join(',') : '';  // text:投稿1
  r.boxAfterSave = sb.value;                                                   // '' (auto-confirm)

  // --- restore: open the saved search and confirm the tree comes back ---
  const textChips = () => document.querySelectorAll('#queryChips .qb-val.qc-text').length;
  const goColl = () => document.querySelector('#browseToggle [data-mode="collections"]').click();
  const cardByName = (nm) => [...document.querySelectorAll('#collectionGrid .collection-card[data-cid]')]
    .find((el) => ((el.querySelector('.collection-name') || {}).textContent || '').includes(nm));
  document.querySelector('.tab-new').click();   // fresh tab = reset the active filters
  await wait(220);
  r.tabResetCards = cards();        // 3 (no filter)
  goColl(); await wait(240);
  const savedCard = cardByName('テスト保存');
  r.foundSaved = !!savedCard;
  if (savedCard) savedCard.click();
  await wait(280);
  r.openMode = document.body.classList.contains('browse-collections');   // false (openCollection → posts)
  r.openChips = textChips();        // 1 (the saved text leaf is restored)
  r.openCards = cards();            // 1 (投稿1)
  r.openBox = sb.value;             // '' (restored leaves are confirmed; box empty)

  // --- legacy: a collection holding only coll.q folds into a text leaf on open ---
  window.corpusFolders.createCollection('レガシ検索', { kind: 'dynamic', q: '投稿2' });
  goColl(); await wait(240);
  const legacyCard = cardByName('レガシ検索');
  r.foundLegacy = !!legacyCard;
  if (legacyCard) legacyCard.click();
  await wait(280);
  r.legacyChips = textChips();      // 1 (q folded into a text leaf)
  r.legacyCards = cards();          // 1 (投稿2)
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
  const saveOk = r.leafCards === 1 && r.saved === true && r.hasQ === false && r.leaves === 'text:投稿1' && r.boxAfterSave === '';
  const restoreOk = r.tabResetCards === 3 && r.foundSaved === true && r.openMode === false && r.openChips === 1 && r.openCards === 1 && r.openBox === '';
  const legacyOk = r.foundLegacy === true && r.legacyChips === 1 && r.legacyCards === 1;
  const ok = saveOk && restoreOk && legacyOk;
  console.log(`save: leafCards=${r.leafCards} saved=${r.saved} hasQ=${r.hasQ} leaves="${r.leaves}" boxAfterSave="${r.boxAfterSave}"`);
  console.log(`restore: tabReset=${r.tabResetCards} foundSaved=${r.foundSaved} openMode=${r.openMode} openChips=${r.openChips} openCards=${r.openCards} openBox="${r.openBox}"`);
  console.log(`legacy: foundLegacy=${r.foundLegacy} legacyChips=${r.legacyChips} legacyCards=${r.legacyCards}`);
  console.log(ok ? 'SAVESEARCH_TEST_PASS' : 'SAVESEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
