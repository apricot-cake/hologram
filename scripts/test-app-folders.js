'use strict';

// Verifies the (unified post-view) folder feature end-to-end:
//  - create a folder via the shared management modal (first folder auto-becomes default ★)
//  - one-click add a post card to the default folder via its 📁 button
//  - the sidebar folder chip shows the right count and filters the grid
//  - folders.json is persisted (round-trip via get-folders)
// Seeds 3 standalone illustration records (eagle-migration shape) → 3 cards.
//
//   node scripts/test-app-folders.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-fold-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-f0' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://www.pixiv.net/artworks/' + (200 + i),
    platform: 'pixiv', title: '作品' + i, displayName: '絵師' + i, screenName: '80000' + i,
    likes: 1000 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: [], source: 'eagle-migration'
  }, null, 2));
}

const evalJs = `(async () => {
  const grid = document.getElementById('postGrid');
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };

  // wait for the 3 seeded posts to render as cards (post view loads async)
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 3);
  const totalBefore = grid.querySelectorAll('.post-card').length;

  // create a folder through the shared management modal UI
  $('postFolderManage').click();
  await sleep(30);
  const modalOpen = !$('ivFolderModal').hidden;
  $('ivFolderNewName').value = '一次資料';
  $('ivFolderCreate').click();
  await sleep(50);
  const chips = document.querySelectorAll('#postFolderChips .sb-chip').length;
  const hasStar = !!document.querySelector('#postFolderChips .iv-foldstar');   // ★ marks the default folder chip
  $('ivFolderClose').click();

  // one-click add card 0 to the (now default) folder via its 📁 button
  const fold0 = grid.querySelector('.post-card[data-index="0"] .fold-btn');
  fold0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(40);
  const foldIn = fold0.classList.contains('in');
  const countText = (document.querySelector('#postFolderChips .sb-chip .iv-tagn') || {}).textContent;

  // filter by the folder chip → only the added card remains
  document.querySelector('#postFolderChips .sb-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(40);
  const filteredCount = grid.querySelectorAll('.post-card').length;

  // persistence round-trip BEFORE further mutations (awaited → folders.json flushed)
  const rb = await window.corpus.getFolders();
  const f0 = rb.folders[0] || {};
  const persistedFolders = rb.folders.length;
  const persistedItems = Array.isArray(f0.items) ? f0.items.length : -1;
  const persistedDefault = rb.defaultId === f0.id;

  // H2 (updated for sticky-visible): removing the card from the folder WHILE
  // filtering by it no longer makes it vanish — it stays until the next filter
  // change (mutation-survivor behavior).
  const foldInBtn = grid.querySelector('.post-card .fold-btn.in');
  foldInBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await sleep(40);
  const afterUnfilter = grid.querySelectorAll('.post-card').length;   // sticky → still 1

  // H4 regression: delete the folder WHILE it is the active filter → filter auto-clears,
  // grid returns to all cards (not a silent empty grid), chip disappears.
  window.confirm = () => true;
  $('postFolderManage').click();
  await sleep(20);
  document.querySelector('#ivFolderList [data-fact="delete"]').click();
  await sleep(50);
  if (!$('ivFolderModal').hidden) $('ivFolderClose').click();
  const afterDelete = grid.querySelectorAll('.post-card').length;
  const chipsGone = document.querySelectorAll('#postFolderChips .sb-chip').length;

  return { totalBefore, modalOpen, chips, hasStar, foldIn, countText, filteredCount,
    persistedFolders, persistedItems, persistedDefault, afterUnfilter, afterDelete, chipsGone };
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });

child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.totalBefore === 3 && r.modalOpen === true && r.chips === 1 && r.hasStar === true &&
    r.foldIn === true && r.countText === '1' && r.filteredCount === 1 &&
    r.persistedFolders === 1 && r.persistedItems === 1 && r.persistedDefault === true &&
    r.afterUnfilter === 1 && r.afterDelete === 3 && r.chipsGone === 0;
  console.log(`total=${r.totalBefore} modal=${r.modalOpen} chips=${r.chips} star=${r.hasStar} foldIn=${r.foldIn} count=${r.countText} filtered=${r.filteredCount} persisted=${r.persistedFolders}/${r.persistedItems}/${r.persistedDefault} unfilter=${r.afterUnfilter} delete=${r.afterDelete} chipsGone=${r.chipsGone}`);
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
