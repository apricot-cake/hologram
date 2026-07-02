'use strict';

// Verifies the post-view folder + clip features (collections data model):
//  - create a folder via the shared management modal (no auto-default / no ★)
//  - 📁 button opens a picker; clicking a folder row adds the card; chip counts + filters
//  - collections.json persists { collections, activeId, clip, posterWorkspace }
//  - 📎 clip button one-click flags the card (library-wide ephemeral set), sidebar
//    chip counts + filters, 空にする clears all flags
//  - clip is NOT a collection: the folder manager still lists only the real folders
// Seeds 3 standalone illustration records → 3 cards.
//
//   node scripts/test-app-folders.js

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  fs.writeFileSync(
    path.join(saveFolder, id + '.json'),
    JSON.stringify(
      {
        captureId: id,
        image: id + '.jpg',
        url: 'https://www.pixiv.net/artworks/' + (200 + i),
        platform: 'pixiv',
        title: '作品' + i,
        displayName: '絵師' + i,
        screenName: '80000' + i,
        likes: 1000 + i,
        capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
        date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
        media: [],
        tags: [],
        hashtags: [],
        source: 'eagle-migration',
      },
      null,
      2,
    ),
  );
}

const evalJs = `(async () => {
  const grid = document.getElementById('postGrid');
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); } return false; };
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  // Collections (= folders) live in the dedicated collection view (第3モード); the post
  // sidebar no longer carries a folder flyout. Membership/counts come from the CF() API,
  // management opens from the modal, and filtering is reached by drilling into a card.
  const folders = () => window.corpusFolders.all();
  const waitForEl = async (sel, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const el = document.querySelector(sel); if (el) return el; await sleep(40); } return null; };

  await waitFor(() => grid.querySelectorAll('.post-card').length >= 3);
  const totalBefore = grid.querySelectorAll('.post-card').length;

  // create a folder via the management modal (no auto-default ★ anymore)
  window.corpusFolders.openManager(); await sleep(30);
  const modalOpen = !$('ivFolderModal').hidden;
  $('ivFolderNewName').value = '一次資料';
  click($('ivFolderCreate')); await sleep(50);
  const chips = folders().length;                          // one folder now exists
  const noStar = !document.querySelector('.iv-foldstar');  // default folder removed → no ★ anywhere
  click($('ivFolderClose')); await sleep(20);

  // hover keeps the 📎/ℹ/🏷 buttons — folder/delete/open/poster moved off the card
  const hoverPair = !!grid.querySelector('.post-card .clip-btn') && !!grid.querySelector('.post-card .info-btn') &&
    !grid.querySelector('.post-card .fold-btn, .post-card .edit-btn, .post-card .delete-btn, .post-card .open-btn');

  // folders are reached via the card context menu: right-click → コレクションに追加… →
  // picker row. Both menus are the ONE React ContextMenu island (.fold-menu.show, no
  // .card-menu class / data-act / data-fid) — rows are found by their .fm-name label,
  // and picking 'folder' transitions the SAME host to the folder picker (the bridge's
  // transition guard keeps it open).
  const menuRow = (name) => [...document.querySelectorAll('.fold-menu.show .fm-row')]
    .find((r) => { const n = r.querySelector('.fm-name'); return n && n.textContent === name; });
  grid.querySelector('.post-card[data-index="0"]').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  await waitFor(() => !!menuRow('コレクションに追加…'));
  const ctxOpen = !!menuRow('コレクションに追加…');
  click(menuRow('コレクションに追加…'));
  await waitFor(() => !!menuRow('一次資料'));
  const menuOpen = !!menuRow('一次資料');   // the picker lists the created folder
  click(menuRow('一次資料')); await sleep(50);
  const countText = String((folders()[0] || { items: [] }).items.length);   // the card joined the folder

  // filter by the folder: collections moved to the dedicated collection view (第3モード).
  // Switch there, open the folder card → drills back into the post view with a folder
  // filter showing only the added card.
  click(document.querySelector('#browseToggle [data-mode="collections"]')); await sleep(150);
  await waitFor(() => document.body.classList.contains('browse-collections'));
  const collCard = await waitForEl('#collectionGrid .collection-card:not(.new)');
  click(collCard); await sleep(160);
  const filteredCount = grid.querySelectorAll('.post-card').length;   // only the added card

  // persistence: collections.json { collections, activeId, clip, posterWorkspace }, no defaultId
  const rb = await window.corpus.getCollections();
  const f0 = rb.collections[0] || {};
  const persistedFolders = rb.collections.length;          // only the folder yet
  const persistedItems = Array.isArray(f0.items) ? f0.items.length : -1;
  const noDefaultId = !('defaultId' in rb);
  $('postResetBtn').click(); await sleep(50);

  // === Clip (library-wide ephemeral flag set — the 📎 tray) ===
  // 📎 one-click flag card 1 → filled, sidebar count 1
  const clip1 = grid.querySelector('.post-card[data-index="1"] .clip-btn');
  click(clip1); await sleep(50);
  const clipIn = clip1.classList.contains('in');
  const clipCount = $('clipBadge').textContent;   // clip count badge on the sidebar row
  // filter to clipped → only that card
  click($('clipRow')); await sleep(60);
  const clipFiltered = grid.querySelectorAll('.post-card').length;
  const clipPill = [...document.querySelectorAll('#queryChips .sb-active-chip.qc-clip')].length === 1;
  // persisted to collections.json as the clip array (1 id), NOT a collection
  const rb2 = await window.corpus.getCollections();
  const clipPersist = Array.isArray(rb2.clip) && rb2.clip.length === 1;
  // clip is NOT a collection: the folder manager still lists only the real folder
  window.corpusFolders.openManager(); await sleep(40);
  const mgrRows = document.querySelectorAll('#ivFolderList .iv-folder-row').length;
  const clipNotCollection = mgrRows === window.corpusFolders.all().length && window.corpusFolders.all().length === 1;
  click($('ivFolderClose')); await sleep(20);
  // 空にする clears all flags (the posts themselves are kept; stub the dialog here)
  $('postResetBtn').click(); await sleep(40);
  window.confirm = () => true;
  click($('clipClear')); await sleep(60);
  // Cleared end-to-end: empty on disk, empty in the live clip set, and the sidebar badge
  // no longer shows a positive count (its 'on' class is dropped at zero). The badge's raw
  // text is not asserted — renderPosts() rebuilds the row to its blank template after the
  // clear, so it settles to '' rather than '0'; both read as "no count" to the user.
  const rb3 = await window.corpus.getCollections();
  const clipCleared = (rb3.clip || []).length === 0 && window.corpusFolders.clipCount() === 0 &&
    !$('clipBadge').classList.contains('on');

  return { totalBefore, modalOpen, chips, noStar, hoverPair, ctxOpen, menuOpen, countText, filteredCount,
    persistedFolders, persistedItems, noDefaultId, clipIn, clipCount, clipFiltered, clipPill, clipPersist, clipNotCollection, clipCleared };
})()`;

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'),
  CORPUS_SMOKE: '1',
  CORPUS_SMOKE_EVAL: evalJs,
});

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
  const keys = ['totalBefore', 'modalOpen', 'chips', 'noStar', 'hoverPair', 'ctxOpen', 'menuOpen', 'countText', 'filteredCount', 'persistedFolders', 'persistedItems', 'noDefaultId', 'clipIn', 'clipCount', 'clipFiltered', 'clipPill', 'clipPersist', 'clipNotCollection', 'clipCleared'];
  const expect = {
    totalBefore: 3,
    modalOpen: true,
    chips: 1,
    noStar: true,
    hoverPair: true,
    ctxOpen: true,
    menuOpen: true,
    countText: '1',
    filteredCount: 1,
    persistedFolders: 1,
    persistedItems: 1,
    noDefaultId: true,
    clipIn: true,
    clipCount: '1',
    clipFiltered: 1,
    clipPill: true,
    clipPersist: true,
    clipNotCollection: true,
    clipCleared: true,
  };
  const ok = keys.every((k) => r[k] === expect[k]);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
