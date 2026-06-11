'use strict';
// Throwaway: verify the ring-only selection flow in the post view —
//  - clicking the ○ ring selects (card .selected, selection bar shows)
//  - clicking the card BODY does NOT select (entry path removed)
//  - clicking the ring again deselects (bar hides)
//  - Shift+ring-click selects the range from the anchor
//  - Ctrl+A selects all visible cards (and is ignored while typing in an input)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const appDir = path.join(__dirname, '..', 'app');
const electronPath = require(path.join(appDir, 'node_modules', 'electron'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-sel-'));
const configDir = path.join(tmp, 'Corpus');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
for (let i = 0; i < 5; i++) {
  const id = '170000000000' + i + '-sl' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  fs.writeFileSync(path.join(saveFolder, id + '.json'), JSON.stringify({
    captureId: id, image: id + '.jpg', url: 'https://x.com/u/status/' + (500 + i),
    platform: 'x', text: '本文' + i, displayName: '人' + i, screenName: 'u' + i,
    likes: 10 + i, capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z', media: [], tags: ['base'], hashtags: []
  }, null, 2));
}
const evalJs = `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await wait(40); } return false; };
  const grid = document.getElementById('postGrid');
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 5);
  const bar = document.getElementById('selectionBar');
  const card = (i) => grid.querySelector('.post-card[data-index="' + i + '"]');
  const ring = (i) => card(i).querySelector('.select-check');
  const click = (el, opts) => el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, opts)));
  const selCount = () => grid.querySelectorAll('.post-card.selected').length;

  // card BODY click must NOT select (entry path removed)
  click(card(0).querySelector('.post-meta') || card(0));
  await wait(40);
  const bodyNoSelect = selCount() === 0 && bar.style.display === 'none';

  // ring click selects + bar appears
  click(ring(0));
  await wait(40);
  const ringSelects = selCount() === 1 && card(0).classList.contains('selected') && bar.style.display !== 'none';

  // Shift+ring on index 3 -> range 0..3 selected (4 cards)
  click(ring(3), { shiftKey: true });
  await wait(40);
  const shiftRange = selCount() === 4;

  // ring click on a selected card deselects just it
  click(ring(2));
  await wait(40);
  const ringDeselects = selCount() === 3 && !card(2).classList.contains('selected');

  // Ctrl+A selects all 5
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(40);
  const ctrlA = selCount() === 5;

  // Ctrl+A while typing in the search box must NOT change the selection;
  // clear first via the bar's cancel, then type-target the input.
  console.log('CHK sec-folders');
  document.getElementById('cancelSelectBtn').click();
  await wait(40);
  const cleared = selCount() === 0;
  const sb = document.getElementById('searchBox');
  sb.focus();
  sb.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(40);
  const inputGuard = selCount() === 0;

  // ring computed style: hollow (transparent bg) circle
  const rs = getComputedStyle(ring(0));
  const ringHollow = rs.backgroundColor === 'rgba(0, 0, 0, 0)' && rs.borderRadius === '50%';

  // --- Selection mode: a click ANYWHERE on a card toggles it ---
  click(ring(0));
  await wait(40);
  const modeOn = selCount() === 1 && grid.classList.contains('selecting');
  // body click on another card adds it (instead of doing nothing)
  click(card(1).querySelector('.post-meta') || card(1));
  await wait(40);
  const bodyTogglesInMode = selCount() === 2 && card(1).classList.contains('selected');
  // image click toggles too and does NOT open the lightbox
  click(card(2).querySelector('.card-img'));
  await wait(40);
  const lb = document.getElementById('lightbox');
  const imgTogglesInMode = selCount() === 3 && card(2).classList.contains('selected') && !lb.classList.contains('show');
  // rings are forced visible + hover actions hidden while selecting
  const ringAlwaysOn = getComputedStyle(ring(4)).opacity === '1';
  const btnsHidden = getComputedStyle(card(4).querySelector('.info-btn')).display === 'none';
  // image cursor is a plain pointer (no zoom-in magnifier) while selecting
  const imgCursorPointer = getComputedStyle(card(4).querySelector('.card-img')).cursor === 'pointer';
  // body click on a selected card removes it; clearing the last one exits the mode
  click(card(1).querySelector('.post-meta') || card(1));
  click(card(2).querySelector('.card-img'));
  click(card(0).querySelector('.post-meta') || card(0));
  await wait(60);
  const modeExits = selCount() === 0 && !grid.classList.contains('selecting');

  // --- Selection bar: pinned at the sidebar top, with tag/folder bulk actions ---
  const selBar = document.getElementById('selectionBar');
  const barAtTop = selBar.parentElement.id === 'controls-posts' &&
    selBar.nextElementSibling && selBar.nextElementSibling.classList.contains('sb-scroll');
  click(ring(0)); await wait(40); click(ring(1)); await wait(40);
  const newBtnsVisible = document.getElementById('tagSelectedBtn').offsetParent !== null &&
    document.getElementById('folderSelectedBtn').offsetParent !== null;

  // bulk タグを追加: additive — 'bulk-t' is merged, 'base' survives
  document.getElementById('tagSelectedBtn').click();
  await wait(40);
  const bulkOverlayOpen = document.getElementById('editOverlay').classList.contains('show');
  document.getElementById('editTagInput').value = 'bulk-t';
  document.getElementById('editTagAdd').click();
  document.getElementById('editSave').click();
  await wait(250);
  const lp = await window.corpus.listPosts();
  const tagged = lp.posts.filter((p) => (p.tags || []).includes('bulk-t'));
  const bulkTagAdds = tagged.length === 2 && tagged.every((p) => (p.tags || []).includes('base'));
  const stillSelected = selCount() === 2;

  // bulk フォルダに追加: create folder F, then 一括「フォルダに追加」→ picker → F
  document.getElementById('postFolderManage').click();
  await wait(30);
  document.getElementById('ivFolderNewName').value = 'F';
  document.getElementById('ivFolderCreate').click();
  await wait(50);
  document.getElementById('ivFolderClose').click();
  document.getElementById('folderSelectedBtn').click();   // opens the picker now
  await wait(50);
  document.querySelector('.fold-menu.show .fm-row[data-fid]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(120);
  const chipN = (document.querySelector('#postFolderChips .sb-chip .iv-tagn') || {}).textContent;
  const bulkFolderAdds = chipN === '2';

  // the active-bar folder pill is a styled rounded-rect chip
  document.getElementById('cancelSelectBtn').click();
  await wait(60);
  document.querySelector('#postFolderChips .sb-chip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(80);
  const fp = document.querySelector('#queryChips .sb-active-chip.qc-folder');
  const fpCs = fp ? getComputedStyle(fp) : null;
  const folderPillChip = !!fpCs && fpCs.borderRadius === '6px' && fpCs.backgroundColor !== 'rgba(0, 0, 0, 0)';

  console.log('CHK sec-ctx');
  // --- card context menu → フォルダに追加 → picker (no ★/default) ---
  // create a 2nd folder G, clear the folder filter, then right-click a card
  document.getElementById('postFolderManage').click(); await wait(30);
  document.getElementById('ivFolderNewName').value = 'G';
  document.getElementById('ivFolderCreate').click(); await wait(50);
  document.getElementById('ivFolderClose').click();
  // clear the F filter (チップは単純トグル)
  document.querySelector('#postFolderChips .sb-chip.active').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(80);
  console.log('CHK pre-ctx cards=' + grid.querySelectorAll('.post-card').length);
  grid.querySelector('.post-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }));
  await wait(40);
  const cm = document.querySelector('.card-menu');
  const ctxShown = !!cm && cm.classList.contains('show') &&
    !!cm.querySelector('.fm-row[data-act="open"]') && !!cm.querySelector('.fm-row[data-act="edit"]') &&
    !!cm.querySelector('.fm-row[data-act="ws"]') && !!cm.querySelector('.fm-row[data-act="delete"].fm-danger');
  cm.querySelector('.fm-row[data-act="folder"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(40);
  const menu = document.querySelector('.fold-menu:not(.qf-pop):not(.card-menu):not(.cs-pop)');
  const menuShown = !!menu && menu.classList.contains('show') &&
    menu.querySelectorAll('.fm-row[data-fid]').length === 2 &&
    !menu.querySelector('.fm-star');   // ★ default removed
  // click the G row → that card joins G (chip count 1)
  const gRow = [...menu.querySelectorAll('.fm-row[data-fid]')].find((r) => r.querySelector('.fm-name').textContent === 'G');
  gRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await wait(100);
  const gChip = [...document.querySelectorAll('#postFolderChips .sb-chip')].find((c) => c.textContent.includes('G'));
  const addedToG = !!gChip && gChip.querySelector('.iv-tagn').textContent === '1';
  // folders.json persists { folders, workspace } and NO defaultId
  const rb2 = await window.corpus.getFolders();
  const noDefaultId = !('defaultId' in rb2);
  const menuClosed = !menu.classList.contains('show');

  console.log('CHK sec-mix');
  // --- Folders join the AND/OR expression like tags: F={c0,c1}, G={c0} ---
  const cardCount = () => grid.querySelectorAll('.post-card').length;
  const chipByName = (n) => [...document.querySelectorAll('#postFolderChips .sb-chip')].find((c) => c.textContent.includes(n));
  chipByName('F').dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(60);
  const fOr = cardCount() === 2;                       // F(or) → 2
  chipByName('G').dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(60);
  const fgOr = cardCount() === 2;                      // F∨G → 2
  // G を「かつ」へはピルのドラッグで移す（チップのサイクルは廃止済み）
  {
    const pill = [...document.querySelectorAll('#queryChips .sb-active-chip')].find(c => c.textContent === 'G');
    const zone = document.querySelector('#queryChips .qc-zone[data-zone="and"]');
    const dt = new DataTransfer();
    pill.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }
  await wait(80);
  const gAndF = cardCount() === 1;                     // (G)∧(F) → c0 = 1
  const js = document.getElementById('qcJoinSel');
  js.value = 'or'; js.dispatchEvent(new Event('change', { bubbles: true })); await wait(60);
  const gOrF = cardCount() === 2;                      // (G)∨(F) → 2

  return { bodyNoSelect, ringSelects, shiftRange, ringDeselects, ctrlA, cleared, inputGuard, ringHollow,
    modeOn, bodyTogglesInMode, imgTogglesInMode, ringAlwaysOn, btnsHidden, imgCursorPointer, modeExits,
    barAtTop, newBtnsVisible, bulkOverlayOpen, bulkTagAdds, stillSelected, bulkFolderAdds,
    folderPillChip,
    ctxShown, menuShown, addedToG, noDefaultId, menuClosed,
    fOr, fgOr, gAndF, gOrF };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
child.on('close', () => {
  let r = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) { try { r = JSON.parse(m[1]); } catch { /* ignore */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
  const keys = ['bodyNoSelect', 'ringSelects', 'shiftRange', 'ringDeselects', 'ctrlA', 'cleared', 'inputGuard', 'ringHollow',
    'modeOn', 'bodyTogglesInMode', 'imgTogglesInMode', 'ringAlwaysOn', 'btnsHidden', 'imgCursorPointer', 'modeExits',
    'barAtTop', 'newBtnsVisible', 'bulkOverlayOpen', 'bulkTagAdds', 'stillSelected', 'bulkFolderAdds',
    'folderPillChip',
    'ctxShown', 'menuShown', 'addedToG', 'noDefaultId', 'menuClosed',
    'fOr', 'fgOr', 'gAndF', 'gOrF'];
  const ok = keys.every((k) => r[k] === true);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'SELECT_VERIFY_PASS' : 'SELECT_VERIFY_FAIL');
  process.exit(ok ? 0 : 1);
});
