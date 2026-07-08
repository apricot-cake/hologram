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
  // Make getComputedStyle reliable in the offscreen SMOKE window: render every card
  // eagerly (the app's smoke-capture hook disables content-visibility:auto) and kill
  // transitions/animations — the offscreen window never ticks them, so a transitioned
  // property (e.g. .select-check opacity .1s) would stay stuck at its start value.
  document.documentElement.classList.add('smoke-capture');
  const noAnim = document.createElement('style');
  noAnim.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
  document.head.appendChild(noAnim);
  await waitFor(() => grid.querySelectorAll('.post-card').length >= 5);
  const bar = document.getElementById('selectionBar');
  const card = (i) => grid.querySelector('.post-card[data-index="' + i + '"]');
  const ring = (i) => card(i).querySelector('.select-check');
  const click = (el, opts, tag) => { if (!el) { console.log('DBG NULL-DISPATCH ' + tag); return; } el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, opts))); };
  const safeClick = (id) => { const el = document.getElementById(id); if (!el) { console.log('DBG NULL-CLICK ' + id); return false; } el.click(); return true; };
  const selCount = () => grid.querySelectorAll('.post-card.selected').length;
  // Folders moved from inline #postFolderChips to the sidebar flyout (data-qfrow="folder"
  // → .qf-pop values). Counts come from the CF() API now (no inline count chips).
  const folderCount = (name) => (window.corpusFolders.all().find((f) => f.name === name) || { items: [] }).items.length;
  // The row's data-qfrow is still the internal legacy value 'collection' (the UI
  // label reads "フォルダ" but the collection→folder identifier rename is a tracked,
  // not-yet-done backlog item — [[feedback-migration-full-consistency]]).
  const openFolderFlyout = async () => { document.querySelector('#filterRows [data-qfrow="collection"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); await wait(70); };
  // qf-pop rows carry no data-qfval anymore (island genericized — same drift as the
  // ContextMenu rows below); match by the rendered .fm-name text instead.
  const flyoutFolderRow = (name) => [...document.querySelectorAll('.qf-pop.show .fm-row')].find((r) => (r.querySelector('.fm-name') || {}).textContent === name);
  const escKey = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // ContextMenu.tsx (the generic glass-menu component, slice g/g-2) renders NO
  // data-act/data-fid on rows and no per-menu-type class (old .card-menu etc. are
  // gone) — every menu (card/fold/qb/tab/...) is just ".fold-menu.show > .fm-row".
  // Identify + click a row via the bridge's live item model instead of the DOM
  // (same fix as qf-pop's .fm-name-based lookup, [[corpus-typescript-stage1]] notes
  // this exact class of drift for qf-pop; ContextMenu never got the same pass).
  const menuItems = () => (window.corpusContextMenu.get() || { items: [] }).items.filter((it) => !it.sep);
  const menuHasAct = (act) => menuItems().some((it) => it.act === act);
  const pickMenuItem = (predicate) => {
    const items = menuItems();
    const idx = items.findIndex(predicate);
    if (idx < 0) { console.log('DBG menu-item-not-found ' + JSON.stringify(items.map((it) => it.act || it.label))); return false; }
    const rows = [...document.querySelectorAll('.fold-menu.show .fm-row')];
    if (!rows[idx]) { console.log('DBG menu-row-missing idx=' + idx + ' rows=' + rows.length); return false; }
    rows[idx].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  };
  // #queryChips redesign (改訂④/⑤, docs/design-query-builder.md): values cluster by
  // attribute (.qb-cluster > .qb-val[data-nid] > .qb-val-label + .qb-del-btn) — the
  // OLD single-condition ".qb-pill" concept is gone, and so is any root-level AND/OR
  // toggle (attributes are always AND; the only user-facing op toggle is the per-
  // cluster すべて/どれか .qb-opt-btn[data-op], shown once a cluster has 2+ values).
  // Folder conditions still use the internal type 'collection' (rename tracked,
  // not done — [[feedback-migration-full-consistency]]), so typeCls is 'qc-collection'.
  const chipValueByLabel = (label) => [...document.querySelectorAll('#queryChips .qb-val')].find((v) => (v.querySelector('.qb-val-label') || {}).textContent === label);
  const removeChipValue = (label) => {
    const v = chipValueByLabel(label);
    const btn = v && v.querySelector('.qb-del-btn');
    if (!btn) { console.log('DBG chip-del-not-found ' + label); return false; }
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  };
  const setFolderClusterOp = (op) => {
    const v = chipValueByLabel('F') || chipValueByLabel('G');
    const cluster = v && v.closest('.qb-cluster');
    const btn = cluster && cluster.querySelector('.qb-opt-btn[data-op="' + op + '"]');
    if (!btn) { console.log('DBG opt-btn-not-found ' + op); return false; }
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  };

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
  safeClick('cancelSelectBtn');
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
  // rings are forced visible + hover actions hidden while selecting (card(4) is
  // unselected → proves the .selecting rule, not just .selected).
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
  safeClick('tagSelectedBtn');
  await wait(40);
  const bulkOverlayOpen = document.getElementById('editOverlay').classList.contains('show');
  // editTagInput is a React-controlled input (TagEditor's submit() reads its OWN
  // query state, not the DOM value) — plain "el.value = x" hits React's own
  // tracked-value setter (which updates the tracker to 'x' too), so a subsequent
  // 'input' event would look like "no change" and never fire onChange. Go through
  // the native prototype setter so the tracker still holds the old value.
  const editTagInputEl = document.getElementById('editTagInput');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(editTagInputEl, 'bulk-t');
  editTagInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  safeClick('editTagAdd');
  // EditOverlay.tsx's confirm-actions buttons (cancel/save) lost their old
  // #editCancel/#editSave ids when the modal went React (slice l, 2026-07-01) —
  // they're plain buttons now, distinguished only by position (cancel first, save second).
  const editSaveBtn = document.querySelector('#editOverlay .confirm-actions button:nth-child(2)');
  if (editSaveBtn) editSaveBtn.click(); else console.log('DBG NULL-CLICK editSave(structural)');
  await wait(250);
  const lp = await window.corpus.listPosts();
  const tagged = lp.posts.filter((p) => (p.tags || []).includes('bulk-t'));
  const bulkTagAdds = tagged.length === 2 && tagged.every((p) => (p.tags || []).includes('base'));
  const stillSelected = selCount() === 2;

  // bulk フォルダに追加: create folder F, then 一括「フォルダに追加」→ picker → F
  // フォルダ作成モーダルは現行の起動口 CF().openManager() で開く（旧 postFolderManage は撤去済み）
  window.corpusFolders.openManager();
  await wait(30);
  document.getElementById('ivFolderNewName').value = 'F';
  safeClick('ivFolderCreate');
  await wait(50);
  safeClick('ivFolderClose');
  safeClick('folderSelectedBtn');   // opens the picker now
  await wait(50);
  pickMenuItem((it) => it.label === 'F');
  await wait(120);
  const bulkFolderAdds = folderCount('F') === 2;          // 2 selected cards joined folder F

  // the active-bar folder pill is a styled rounded-rect chip (改訂③: フォルダはフライアウトから追加)
  safeClick('cancelSelectBtn');
  await wait(60);
  await openFolderFlyout();
  { const r = flyoutFolderRow('F'); if (!r) console.log('DBG NULL-DISPATCH flyoutFolderRow-F'); else r.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  await wait(80);
  escKey(); await wait(40);                               // close the flyout
  const fp = document.querySelector('#queryChips .sb-active-chip.qc-collection');
  const fpCs = fp ? getComputedStyle(fp) : null;
  // Chips are fully-rounded glass pills now (改訂④/⑤), not the old 6px rounded-rect —
  // 999px is the actual current shape (real capsule ends), not a magic tolerance.
  const folderPillChip = !!fpCs && fpCs.borderRadius === '999px' && fpCs.backgroundColor !== 'rgba(0, 0, 0, 0)';

  console.log('CHK sec-ctx');
  // --- card context menu → フォルダに追加 → picker (no ★/default) ---
  // create a 2nd folder G, clear the folder filter, then right-click a card
  window.corpusFolders.openManager(); await wait(30);
  document.getElementById('ivFolderNewName').value = 'G';
  safeClick('ivFolderCreate'); await wait(50);
  safeClick('ivFolderClose');
  // clear the F condition: remove that VALUE specifically (✕ on the .qb-val, not a
  // whole-pill click — clusters/removal redesigned in 改訂④, docs/design-query-builder.md).
  removeChipValue('F');
  await wait(80);
  console.log('CHK pre-ctx cards=' + grid.querySelectorAll('.post-card').length);
  grid.querySelector('.post-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }));
  await wait(40);
  // cardMenuItems() (viewer.ts) dropped 'edit'/'ws' long ago — ℹ opens the inspector
  // inline now, act 'info' — so check the CURRENT action set instead of the retired one.
  const cm = document.querySelector('.fold-menu.show');
  const ctxShown = !!cm && cm.classList.contains('show') &&
    menuHasAct('open') && menuHasAct('folder') && menuHasAct('info') &&
    menuItems().some((it) => it.act === 'delete' && it.danger);
  pickMenuItem((it) => it.act === 'folder');
  await wait(40);
  // the transition guard (menu.js) keeps the SAME bridge instance open across this
  // pick, just with new items (fold-menu picker replaces the card menu in place).
  const menu = document.querySelector('.fold-menu.show');
  // foldMenuItems() (viewer.ts) always appends a trailing "管理…" row after a sep —
  // menuItems() strips seps but not that row, so count only the actual folder rows.
  const menuShown = !!menu && menu.classList.contains('show') &&
    menuItems().filter((it) => it.act === 'fold').length === 2;   // F, G — no ★ default (removed feature, nothing to assert)
  // click the G row → that card joins G (chip count 1)
  pickMenuItem((it) => it.label === 'G');
  await wait(100);
  const addedToG = folderCount('G') === 1;               // the right-clicked card joined G
  // folders.json persists { folders, workspace } and NO defaultId
  const rb2 = await window.corpus.getFolders();
  const noDefaultId = !('defaultId' in rb2);
  // ContextMenuHost unmounts (returns null) when the bridge closes — a captured DOM
  // ref's classList never updates after that, so check the bridge model, not the node.
  const menuClosed = !window.corpusContextMenu.get();

  console.log('CHK sec-mix');
  // --- Folders join the query as a single 'collection'-type cluster. There is NO
  //     root-level AND/OR anymore (改訂④ made attribute-vs-attribute always AND,
  //     non-negotiable) — F and G land in the SAME cluster (same attribute), and
  //     the cluster's own すべて/どれか (.qb-opt-btn[data-op]) toggle is what used
  //     to be tested via a since-removed ".qb-op-root". Expected AND/OR counts are
  //     derived from ACTUAL folder membership rather than a hardcoded "c0 is in
  //     both" assumption — which card ends up in G depends on sort order after all
  //     the preceding mutations (tag add, filter clear, etc.), so a fixed overlap
  //     guess would be as fragile as the DOM selectors this pass just fixed. ---
  const cardCount = () => grid.querySelectorAll('.post-card').length;
  const fItems = new Set((window.corpusFolders.all().find((f) => f.name === 'F') || { items: [] }).items);
  const gItems = new Set((window.corpusFolders.all().find((f) => f.name === 'G') || { items: [] }).items);
  const fgOverlap = [...fItems].filter((x) => gItems.has(x)).length;
  const fgUnion = new Set([...fItems, ...gItems]).size;
  await openFolderFlyout();
  { const r = flyoutFolderRow('F'); if (!r) console.log('DBG NULL-DISPATCH flyoutFolderRow-F'); else r.dispatchEvent(new MouseEvent('click', { bubbles: true })); } await wait(60);
  const fOr = cardCount() === fItems.size;             // F alone → |F|
  { const r = flyoutFolderRow('G'); if (!r) console.log('DBG NULL-DISPATCH flyoutFolderRow-G'); else r.dispatchEvent(new MouseEvent('click', { bubbles: true })); } await wait(60);
  escKey(); await wait(40);                            // close the flyout
  const gAndF = cardCount() === fgOverlap;             // cluster default op = すべて(AND) → F∩G
  setFolderClusterOp('or');
  await wait(80);
  const gOrF = cardCount() === fgUnion;                // どれか(OR) → F∪G
  setFolderClusterOp('and');
  await wait(60);
  const fgOr = cardCount() === fgOverlap;              // back to すべて(AND) → F∩G

  return { bodyNoSelect, ringSelects, shiftRange, ringDeselects, ctrlA, cleared, inputGuard, ringHollow,
    modeOn, bodyTogglesInMode, imgTogglesInMode, ringAlwaysOn, btnsHidden, imgCursorPointer, modeExits,
    barAtTop, newBtnsVisible, bulkOverlayOpen, bulkTagAdds, stillSelected, bulkFolderAdds,
    folderPillChip,
    ctxShown, menuShown, addedToG, noDefaultId, menuClosed,
    fOr, fgOr, gAndF, gOrF };
})()`;
const env = Object.assign({}, process.env, { APPDATA: tmp, CORPUS_CONFIG_DIR: path.join(tmp, 'Corpus'), CORPUS_SMOKE: '1', CORPUS_SMOKE_EVAL: evalJs });
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
