'use strict';

// Verifies the POST-view folder feature (full parity with image-view):
//  - create a folder via the shared management modal (first folder auto-default ★)
//  - one-click add a post card to the default folder via its 📁 button
//  - the sidebar folder chip shows the count and filters the post grid
//  - folders.json is shared/persisted (round-trip via get-folders)
// Post-view is the default mode, so no mode switch is needed.
//
//   node scripts/test-app-post-folders.js

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-pfold-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-p0' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (300 + i),
    platform: 'x', text: '投稿' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 100 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: [], hashtags: []
  }, null, 2));
}

const evalJs = `(async () => {
  await new Promise(r => setTimeout(r, 700));
  const grid = document.getElementById('postGrid');
  const totalBefore = grid.querySelectorAll('.post-card').length;

  // create a folder via the shared management modal
  document.getElementById('postFolderManage').click();
  const modalOpen = !document.getElementById('ivFolderModal').hidden;
  document.getElementById('ivFolderNewName').value = '保存';
  document.getElementById('ivFolderCreate').click();
  await new Promise(r => setTimeout(r, 50));
  const chips = document.querySelectorAll('#postFolderChips .sb-chip').length;
  const hasStar = !!document.querySelector('#postFolderChips .iv-foldstar');   // ★ marks the default folder chip
  document.getElementById('ivFolderClose').click();

  // one-click add the first card to the (now default) folder via its 📁
  const fold0 = grid.querySelector('.post-card .fold-btn');
  fold0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const foldIn = fold0.classList.contains('in');
  const countText = (document.querySelector('#postFolderChips .sb-chip .iv-tagn') || {}).textContent;

  // filter by the folder chip → only the added card remains
  document.querySelector('#postFolderChips .sb-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const filteredCount = grid.querySelectorAll('.post-card').length;

  // persistence round-trip BEFORE further mutations (shared folders.json)
  const rb = await window.corpus.getFolders();
  const f0 = rb.folders[0] || {};
  const persistedFolders = rb.folders.length;
  const persistedItems = Array.isArray(f0.items) ? f0.items.length : -1;
  const persistedDefault = rb.defaultId === f0.id;

  // H1 regression: remove the card from the folder WHILE filtering → renderPosts re-syncs
  // data-index (no stale-index mis-click), card drops out.
  grid.querySelector('.post-card .fold-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const afterUnfilter = grid.querySelectorAll('.post-card').length;

  // H3 regression: delete the folder WHILE it is the active filter → folderFilter clears,
  // grid returns to all posts (not silently empty), chip disappears.
  window.confirm = () => true;
  document.getElementById('postFolderManage').click();
  document.querySelector('#ivFolderList [data-fact="delete"]').click();
  await new Promise(r => setTimeout(r, 50));
  if (!document.getElementById('ivFolderModal').hidden) document.getElementById('ivFolderClose').click();
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
    r.afterUnfilter === 0 && r.afterDelete === 3 && r.chipsGone === 0;
  console.log(`total=${r.totalBefore} modal=${r.modalOpen} chips=${r.chips} star=${r.hasStar} foldIn=${r.foldIn} count=${r.countText} filtered=${r.filteredCount} persisted=${r.persistedFolders}/${r.persistedItems}/${r.persistedDefault} unfilter=${r.afterUnfilter} delete=${r.afterDelete} chipsGone=${r.chipsGone}`);
  console.log(ok ? 'POST_FOLDERS_TEST_PASS' : 'POST_FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
