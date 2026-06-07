'use strict';

// Verifies the image-view folder feature end-to-end:
//  - create a folder via the management modal (first folder auto-becomes default ★)
//  - one-click add a tile to the default folder via its 📁 overlay button
//  - the sidebar folder chip shows the right count and filters the grid
//  - folders.json is persisted (round-trip via get-folders)
// Seeds 3 standalone illustration records (eagle-migration shape) → 3 tiles.
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
  document.getElementById('modeImageBtn').click();
  await new Promise(r => setTimeout(r, 700));
  const grid = document.getElementById('ivGrid');
  const totalBefore = grid.querySelectorAll('.iv-card').length;

  // create a folder through the management modal UI
  document.getElementById('ivFolderManage').click();
  const modalOpen = !document.getElementById('ivFolderModal').hidden;
  document.getElementById('ivFolderNewName').value = '一次資料';
  document.getElementById('ivFolderCreate').click();
  await new Promise(r => setTimeout(r, 50));
  const chips = document.querySelectorAll('#ivFolderChips .sb-chip').length;
  const hasStar = !!document.querySelector('#ivFolderChips .iv-foldstar');
  document.getElementById('ivFolderClose').click();

  // one-click add tile 0 to the (now default) folder via its 📁 overlay
  const fold0 = grid.querySelector('.iv-card[data-idx="0"] .iv-act.fold');
  fold0.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const foldIn = fold0.classList.contains('in');
  const countText = (document.querySelector('#ivFolderChips .sb-chip .iv-tagn') || {}).textContent;

  // filter by the folder chip → only the added tile remains
  document.querySelector('#ivFolderChips .sb-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  const filteredCount = grid.querySelectorAll('.iv-card').length;

  // persistence round-trip (awaited → folders.json is flushed by main)
  const rb = await window.corpus.getFolders();
  const f0 = rb.folders[0] || {};
  return { totalBefore, modalOpen, chips, hasStar, foldIn, countText, filteredCount,
    persistedFolders: rb.folders.length, persistedItems: Array.isArray(f0.items) ? f0.items.length : -1,
    persistedDefault: rb.defaultId === f0.id };
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
    r.persistedFolders === 1 && r.persistedItems === 1 && r.persistedDefault === true;
  console.log(`total=${r.totalBefore} modal=${r.modalOpen} chips=${r.chips} star=${r.hasStar} foldIn=${r.foldIn} count=${r.countText} filtered=${r.filteredCount} persisted=${r.persistedFolders}/${r.persistedItems}/${r.persistedDefault}`);
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
