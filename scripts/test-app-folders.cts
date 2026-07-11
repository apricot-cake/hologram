'use strict';

// Verifies the post-view folder + clip features against the CURRENT UI (2026-07 flyout
// era — the old collections-view / 第3ブラウズモード this test used was removed):
//  - create a folder via the shared management modal (#ivFolderModal, no auto-default ★)
//  - add a card to the folder via the real 📁 picker (card context menu → 「フォルダに追加…」
//    → folder row) — the data + filter + persistence path is what this smoke pins;
//    folder ids/membership counts are read back through window.corpus.getCollections()
//  - filter by the folder via the SIDEBAR folder flyout (#filterRows [data-qfrow="collection"]
//    → .qf-pop row), the same entry every other facet uses — only the member card remains
//  - collections.json persists { collections/folders, clip }, no defaultId
//  - 📎 clip one-click flags the card (library-wide ephemeral set), sidebar count + filter,
//    空にする clears all flags; clip is NOT a folder (the manager lists only real folders)
// Seeds 3 standalone illustration records → 3 cards.
//
//   node scripts/test-app-folders.cts

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

// Known captureIds so the test can drive membership by id without scraping the DOM.
const CIDS: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-f0' + i;
  CIDS.push(id);
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
  const rclick = (el) => el && el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  // React-controlled input (FolderManagerModal, same idiom as SearchBox in test-app-search) —
  // setting .value directly bypasses React's change tracking, so use the native setter + a
  // real 'input' event.
  const setVal = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const cards = () => grid.querySelectorAll('.post-card').length;
  // A flyout value row, found by its .fm-name label (same shape the platform flyout uses in
  // test-app-postfilter). The qf-pop island renders rows without data-* value hooks.
  const qfRow = (name) => [...document.querySelectorAll('.qf-pop .fm-row')].find((r) => { const n = r.querySelector('.fm-name'); return n && n.textContent === name; });
  // A card-menu / folder-picker row (menu.ts renders both as .fold-menu.show .fm-row,
  // the same shape qf-pop uses) — matched by its .fm-name label.
  const menuRow = (txt) => [...document.querySelectorAll('.fold-menu.show .fm-row')].find((r) => ((r.querySelector('.fm-name') || {}).textContent || '').includes(txt));
  // Active chips minus the CHIP_OUT_MS exit-animation ghosts (see test-app-textleaf-*).
  const activeChips = (sel) => document.querySelectorAll('#queryChips ' + sel + ':not(.leaving)').length;
  const getCollections = () => window.corpus.getCollections();

  await waitFor(() => cards() >= 3);
  const totalBefore = cards();                              // 3

  // --- create a folder via the shared management modal, opened through the sidebar
  //     folder flyout's 「フォルダを管理…」 footer link (no auto-default ★ anymore) ---
  click(document.querySelector('#filterRows [data-qfrow="collection"]'));
  await waitFor(() => !!document.querySelector('.qf-footer-link'));
  click(document.querySelector('.qf-footer-link')); await sleep(40);
  const modalOpen = !$('ivFolderModal').hidden;
  setVal($('ivFolderNewName'), '一次資料');
  click($('ivFolderCreate')); await sleep(60);
  const c1 = await getCollections();
  const folderCount = c1.collections.length;                // 1 folder exists
  const noStar = !document.querySelector('.iv-foldstar');  // no default folder → no ★
  click($('ivFolderClose')); await sleep(20);

  // --- membership: add card[0] to the folder via the real 📁 picker (card context
  //     menu → 「フォルダに追加…」 → the folder row toggles + closes) ---
  const fid = c1.collections[0].id;
  const card0Img = document.querySelector('img[data-cap="' + ${JSON.stringify(CIDS[0])} + '"]');
  rclick(card0Img); await sleep(40);
  click(menuRow('フォルダに追加…'));
  await waitFor(() => !!menuRow('一次資料'));
  click(menuRow('一次資料')); await sleep(80);
  const c2 = await getCollections();
  const memberCount = ((c2.collections.find((c) => c.id === fid) || {}).items || []).length; // 1 (the card joined)

  // --- filter by the folder via the sidebar folder flyout (data-qfrow="collection") ---
  click(document.querySelector('#filterRows [data-qfrow="collection"]'));
  const flyoutHasFolder = await waitFor(() => !!qfRow('一次資料'));
  click(qfRow('一次資料')); await sleep(180);
  const filteredCount = cards();                            // 1 (only the member card)
  const folderChip = activeChips('.sb-active-chip') >= 1;   // a folder chip is shown

  // --- persistence: get-collections { collections/folders, clip }, no defaultId ---
  const rb = await getCollections();
  const list = rb.collections || rb.folders || [];
  const persistedFolders = list.length;                    // 1
  const persistedItems = Array.isArray((list[0] || {}).items) ? list[0].items.length : -1;  // 1
  const noDefaultId = !('defaultId' in rb);
  $('postResetBtn').click(); await sleep(80);

  // === Clip (library-wide ephemeral flag set — the 📎 tray) ===
  const clipBtn1 = grid.querySelector('.post-card[data-index="1"] .clip-btn');
  click(clipBtn1); await sleep(60);
  const clipIn = clipBtn1.classList.contains('in');
  const clipCount = (await getCollections()).clip.length; // 1
  // filter to clipped → only that card
  click($('clipRow')); await sleep(80);
  const clipFiltered = cards();                            // 1
  const clipPill = activeChips('.sb-active-chip.qc-clip') === 1;
  // persisted to collections.json as the clip array (1 id), NOT a folder
  const rb2 = await getCollections();
  const clipPersist = Array.isArray(rb2.clip) && rb2.clip.length === 1;
  // clip is NOT a folder: the manager still lists only the real folder
  click(document.querySelector('#filterRows [data-qfrow="collection"]'));
  await waitFor(() => !!document.querySelector('.qf-footer-link'));
  click(document.querySelector('.qf-footer-link')); await sleep(50);
  const mgrRows = document.querySelectorAll('#ivFolderList .iv-folder-row').length;
  const rb2b = await getCollections();
  const clipNotFolder = mgrRows === rb2b.collections.length && rb2b.collections.length === 1;
  click($('ivFolderClose')); await sleep(20);
  // 空にする clears all flags (the posts themselves are kept; stub the dialog here)
  $('postResetBtn').click(); await sleep(40);
  window.confirm = () => true;
  click($('clipClear')); await sleep(80);
  const rb3 = await getCollections();
  const clipCleared = (rb3.clip || []).length === 0;

  return { totalBefore, modalOpen, folderCount, noStar, memberCount, flyoutHasFolder, filteredCount, folderChip,
    persistedFolders, persistedItems, noDefaultId, clipIn, clipCount, clipFiltered, clipPill, clipPersist, clipNotFolder, clipCleared };
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
  const expect = {
    totalBefore: 3,
    modalOpen: true,
    folderCount: 1,
    noStar: true,
    memberCount: 1,
    flyoutHasFolder: true,
    filteredCount: 1,
    folderChip: true,
    persistedFolders: 1,
    persistedItems: 1,
    noDefaultId: true,
    clipIn: true,
    clipCount: 1,
    clipFiltered: 1,
    clipPill: true,
    clipPersist: true,
    clipNotFolder: true,
    clipCleared: true,
  };
  const keys = Object.keys(expect);
  const ok = keys.every((k) => r[k] === expect[k]);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
