'use strict';

// Verifies the post-view folder + workspace features (default folder removed):
//  - create a folder via the shared management modal (no auto-default / no ★)
//  - 📁 button opens a picker; clicking a folder row adds the card; chip counts + filters
//  - folders.json persists { folders, workspace } (no defaultId)
//  - ⚡ workspace button one-click adds to the single tray (filled), sidebar
//    chip counts + filters, クリア empties it
// Seeds 3 standalone illustration records → 3 cards.
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
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  await waitFor(() => grid.querySelectorAll('.post-card').length >= 3);
  const totalBefore = grid.querySelectorAll('.post-card').length;

  // create a folder (no auto-default ★ anymore)
  click($('postFolderManage')); await sleep(30);
  const modalOpen = !$('ivFolderModal').hidden;
  $('ivFolderNewName').value = '一次資料';
  click($('ivFolderCreate')); await sleep(50);
  const chips = document.querySelectorAll('#postFolderChips .sb-chip').length;
  const noStar = !document.querySelector('#postFolderChips .iv-foldstar');   // default removed → no ★
  click($('ivFolderClose')); await sleep(20);

  // hover keeps only the ⚡/ℹ pair — folder/edit/delete/open moved off the card
  const hoverPair = !!grid.querySelector('.post-card .ws-btn') && !!grid.querySelector('.post-card .info-btn') &&
    !grid.querySelector('.post-card .fold-btn, .post-card .edit-btn, .post-card .delete-btn, .post-card .open-btn');

  // folders are reached via the card context menu: right-click → フォルダに追加 → picker row
  grid.querySelector('.post-card[data-index="0"]').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })); await sleep(40);
  const ctxOpen = !!document.querySelector('.card-menu.show .fm-row[data-act="folder"]');
  click(document.querySelector('.card-menu .fm-row[data-act="folder"]')); await sleep(40);
  const menuOpen = !!document.querySelector('.fold-menu.show:not(.card-menu)');
  click(document.querySelector('.fold-menu.show:not(.card-menu) .fm-row[data-fid]')); await sleep(50);
  const countText = (document.querySelector('#postFolderChips .sb-chip .iv-tagn') || {}).textContent;

  // filter by the folder chip → only the added card
  click(document.querySelector('#postFolderChips .sb-chip')); await sleep(50);
  const filteredCount = grid.querySelectorAll('.post-card').length;

  // persistence: { folders, workspace }, no defaultId
  const rb = await window.corpus.getFolders();
  const f0 = rb.folders[0] || {};
  const persistedFolders = rb.folders.length;
  const persistedItems = Array.isArray(f0.items) ? f0.items.length : -1;
  const noDefaultId = !('defaultId' in rb);
  $('postResetBtn').click(); await sleep(50);

  // === Workspace ===
  // ⚡ one-click add card 1 → filled, sidebar count 1
  const ws1 = grid.querySelector('.post-card[data-index="1"] .ws-btn');
  click(ws1); await sleep(50);
  const wsIn = ws1.classList.contains('in');
  const wsCount = ($('wsChip').querySelector('.iv-tagn') || {}).textContent;
  // filter to the workspace → only that card
  click($('wsChip')); await sleep(60);
  const wsFiltered = grid.querySelectorAll('.post-card').length;
  const wsPill = [...document.querySelectorAll('#queryChips .sb-active-chip.qc-workspace')].length === 1;
  // persisted to folders.json workspace[]
  const rb2 = await window.corpus.getFolders();
  const wsPersist = Array.isArray(rb2.workspace) && rb2.workspace.length === 1;
  // 空にする empties the tray (confirmed; stub the dialog here)
  $('postResetBtn').click(); await sleep(40);
  window.confirm = () => true;
  click($('wsClear')); await sleep(60);
  const rb3 = await window.corpus.getFolders();
  const wsCleared = (rb3.workspace || []).length === 0 &&
    ($('wsChip').querySelector('.iv-tagn') || {}).textContent === '0';

  return { totalBefore, modalOpen, chips, noStar, hoverPair, ctxOpen, menuOpen, countText, filteredCount,
    persistedFolders, persistedItems, noDefaultId, wsIn, wsCount, wsFiltered, wsPill, wsPersist, wsCleared };
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
  const keys = ['totalBefore', 'modalOpen', 'chips', 'noStar', 'hoverPair', 'ctxOpen', 'menuOpen', 'countText', 'filteredCount',
    'persistedFolders', 'persistedItems', 'noDefaultId', 'wsIn', 'wsCount', 'wsFiltered', 'wsPill', 'wsPersist', 'wsCleared'];
  const expect = { totalBefore: 3, modalOpen: true, chips: 1, noStar: true, hoverPair: true, ctxOpen: true, menuOpen: true, countText: '1',
    filteredCount: 1, persistedFolders: 1, persistedItems: 1, noDefaultId: true, wsIn: true, wsCount: '1',
    wsFiltered: 1, wsPill: true, wsPersist: true, wsCleared: true };
  const ok = keys.every((k) => r[k] === expect[k]);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
