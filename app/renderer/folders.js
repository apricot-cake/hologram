// Shared folder store + management modal + toast, used by the post-view
// (viewer.js). folders.json is library-level (keyed by captureId). This module
// owns the data, the management modal (#ivFolderModal), membership toggling, and
// the toast (#ivToast); the "which folder is filtered" state stays per-view. Subscribers
// (onChange) are notified after any mutation so each view refreshes its own chips.
//
//   window.corpusFolders.{ load, all, byId, has, toggleIn,
//     inWorkspace, toggleWorkspace, clearWorkspace, workspaceItems, workspaceCount,
//     reconcile, openManager, closeManager, isManagerOpen, toast, onChange, isLoaded }
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // Folder-list store shared by the library folders (below) and the poster folders
  // (viewer.js, via window.corpusFolderStore). Owns the {id,name,items[]} array + id
  // minting + membership toggling. The caller supplies persist() (the library store
  // writes a workspace into the same file) and does its own toast / re-render, since
  // those differ per view. Pure data layer — no DOM.
  function createFolderStore({ idPrefix, persist }) {
    let folders = [];
    const genId = () => idPrefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const all = () => folders;
    const setAll = (list) => { folders = Array.isArray(list) ? list : []; };
    const byId = (id) => folders.find((f) => f.id === id) || null;
    const has = (id, key) => { const f = byId(id); return !!(f && f.items.includes(key)); };
    function create(name) {
      const nm = (name || '').trim(); if (!nm) return null;
      const f = { id: genId(), name: nm, items: [] };
      folders.push(f); persist();
      return f;
    }
    function remove(id) { folders = folders.filter((f) => f.id !== id); persist(); }
    function rename(id, name) {
      const f = byId(id); const nm = (name || '').trim();
      if (!f || !nm) return false;
      f.name = nm; persist(); return true;
    }
    // Toggle one key or a whole group of keys in folder id; anchorKey decides the
    // resulting state (a tile's representative id). Returns 'added' | 'removed' | null.
    function toggleIn(id, keys, anchorKey) {
      const f = byId(id); if (!f) return null;
      const ids = (Array.isArray(keys) ? keys : [keys]).filter((k) => k != null);
      if (!ids.length) return null;
      const anchor = anchorKey != null ? anchorKey : ids[0];
      const wasIn = f.items.includes(anchor);
      if (wasIn) f.items = f.items.filter((c) => !ids.includes(c));
      else ids.forEach((c) => { if (!f.items.includes(c)) f.items.push(c); });
      persist();
      return wasIn ? 'removed' : 'added';
    }
    // Drop keys no longer present (deleted items). Returns true if anything changed.
    function reconcile(existing) {
      let changed = false;
      folders.forEach((f) => { const n = f.items.length; f.items = f.items.filter((c) => existing.has(c)); if (f.items.length !== n) changed = true; });
      return changed;
    }
    // Reorder: place draggedId before/after targetId (drag-and-drop). Returns true
    // if the order changed.
    function move(draggedId, targetId, before) {
      if (draggedId === targetId) return false;
      const from = folders.findIndex((f) => f.id === draggedId);
      if (from < 0) return false;
      const [item] = folders.splice(from, 1);
      const to = folders.findIndex((f) => f.id === targetId);
      if (to < 0) folders.push(item);
      else folders.splice(before ? to : to + 1, 0, item);
      persist();
      return true;
    }
    return { all, setAll, byId, has, create, remove, rename, toggleIn, reconcile, move };
  }
  window.corpusFolderStore = createFolderStore;

  let workspace = [];         // [captureId] — the single ephemeral tray (one-click)
  // Library folders [{ id, name, items:[captureId] }] — permanent shelves.
  const store = createFolderStore({ idPrefix: 'f', persist: () => persist() });
  let loaded = false;
  let loadPromise = null;
  const subs = [];

  // i18n: this module owns the folder modal + its toasts. window.corpusI18n is a
  // promise set by i18n.js (loaded before this script). Resolve once and cache
  // getMessage as t(); until then t() echoes the key. Static modal labels are
  // applied on resolve (and re-applied if the modal is open). Dynamic strings
  // (toasts, row buttons, prompts, confirms) call t() at use time.
  let t = (key, subs2) => key;
  if (window.corpusI18n && typeof window.corpusI18n.then === 'function') {
    window.corpusI18n.then((api) => {
      if (api && api.getMessage) { t = api.getMessage; applyStaticI18n(); }
    });
  }
  function applyStaticI18n() {
    const modal = $('ivFolderModal'); if (!modal) return;
    const title = modal.querySelector('.iv-insp-title'); if (title) title.textContent = t('foldManageTitle');
    const inp = $('ivFolderNewName'); if (inp) inp.placeholder = t('foldNewPlaceholder');
    const createBtn = $('ivFolderCreate'); if (createBtn) createBtn.textContent = t('foldCreate');
    if (isManagerOpen()) renderModal();   // refresh empty-state / row labels if already shown
  }

  function escapeHtml(s) { return window.corpusUI.escapeHtml(s); }
  function persist() {
    loadPromise = null;   // invalidate the load cache so a later load() re-reads disk (defensive; in-memory state stays authoritative this session)
    if (window.corpus && window.corpus.setFolders) window.corpus.setFolders({ folders: store.all(), workspace }).catch(() => { /* best-effort */ });
  }
  function notify(kind) { subs.forEach((cb) => { try { cb(kind); } catch { /* ignore */ } }); }

  async function doLoad() {
    try {
      const r = (window.corpus && window.corpus.getFolders) ? await window.corpus.getFolders() : null;
      store.setAll((r && r.folders) || []);
      workspace = (r && Array.isArray(r.workspace)) ? r.workspace.slice() : [];
    } catch { store.setAll([]); workspace = []; }
    loaded = true;
  }
  function load() { if (!loadPromise) loadPromise = doLoad(); return loadPromise; }

  const byId = store.byId;
  const has = store.has;

  // --- Workspace: a single ephemeral tray. One-click add/remove (no picking),
  // easy to clear. Folders stay the permanent, named, multi-shelf system. ---
  function inWorkspace(cid) { return workspace.includes(cid); }
  function workspaceItems() { return workspace.slice(); }
  function workspaceCount(existing) { return existing ? workspace.filter((c) => existing.has(c)).length : workspace.length; }
  // Toggle captureIds[] (a whole group) in the workspace; anchor decides state.
  function toggleWorkspace(captureIds, anchorCid) {
    const ids = (captureIds || []).filter(Boolean);
    if (!ids.length) return null;
    const anchor = anchorCid != null ? anchorCid : ids[0];
    const wasIn = workspace.includes(anchor);
    if (wasIn) workspace = workspace.filter((c) => !ids.includes(c));
    else ids.forEach((c) => { if (!workspace.includes(c)) workspace.push(c); });
    persist();
    toast(wasIn ? t('wsRemoved') : t('wsAdded'));
    notify('workspace');
    return wasIn ? 'removed' : 'added';
  }
  function clearWorkspace() {
    if (!workspace.length) return 0;
    const n = workspace.length;
    workspace = [];
    persist();
    toast(t('wsCleared'));
    notify('workspace');
    return n;
  }

  // Drop captureIds no longer present (deleted items), persisting + notifying once.
  // store.reconcile handles the folder lists; workspace is library-only so stays here.
  function reconcile(existing) {
    let changed = store.reconcile(existing);
    const wn = workspace.length;
    workspace = workspace.filter((c) => existing.has(c));
    if (workspace.length !== wn) changed = true;
    if (changed) { persist(); notify('list'); }
  }

  // Toggle membership of captureIds[] in folder fid. anchorCid decides the
  // current state (the tile's representative id). Returns 'added' | 'removed' | null.
  function toggleIn(fid, captureIds, anchorCid) {
    const f = byId(fid); if (!f) return null;   // capture the name before toggling for the toast
    const res = store.toggleIn(fid, captureIds, anchorCid);
    if (!res) return null;
    toast(res === 'removed' ? t('foldRemoved', [f.name]) : t('foldAdded', [f.name]));
    notify('membership');
    return res;
  }

  // --- toast (shared, top-level #ivToast) ---
  function toast(msg) { return window.corpusUI.notify(msg); }

  // --- management modal ---
  function isManagerOpen() { const m = $('ivFolderModal'); return !!(m && !m.hidden); }
  function openManager() { renderModal(); const m = $('ivFolderModal'); if (m) m.hidden = false; setTimeout(() => { try { $('ivFolderNewName').focus(); } catch { /* ignore */ } }, 0); }
  function closeManager() { const m = $('ivFolderModal'); if (m) m.hidden = true; }
  function renderModal() {
    const host = $('ivFolderList'); if (!host) return;
    const list = store.all();
    host.innerHTML = list.length ? list.map((f) => {
      return `<div class="iv-folder-row" data-fid="${escapeHtml(f.id)}">` +
        `<span class="iv-fold-name">${escapeHtml(f.name)}</span>` +
        `<span class="iv-fold-n">${f.items.length}</span>` +
        `<button class="iv-fold-btn" data-fact="rename" title="${escapeHtml(t('foldRename'))}">✎</button>` +
        `<button class="iv-fold-btn" data-fact="delete" title="${escapeHtml(t('foldDelete'))}">🗑</button>` +
        `</div>`;
    }).join('') : `<div class="iv-folder-empty">${escapeHtml(t('foldEmpty'))}</div>`;
  }
  function create() {
    const inp = $('ivFolderNewName'); if (!inp) return;
    if (!store.create(inp.value)) return;   // store mints the id + persists
    inp.value = '';
    renderModal(); notify('list');
  }

  function bind() {
    const modal = $('ivFolderModal'); if (!modal) return;
    $('ivFolderClose').addEventListener('click', closeManager);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeManager(); });
    $('ivFolderCreate').addEventListener('click', create);
    $('ivFolderNewName').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    $('ivFolderList').addEventListener('click', (e) => {
      const row = e.target.closest('.iv-folder-row'); if (!row) return;
      const act = e.target.closest('[data-fact]'); if (!act) return;
      const fid = row.dataset.fid; const f = byId(fid); if (!f) return;
      if (act.dataset.fact === 'rename') { store.rename(fid, window.prompt(t('foldRenamePrompt'), f.name)); }
      else if (act.dataset.fact === 'delete') {
        if (!window.confirm(t('foldDeleteConfirm', [f.name]))) return;
        store.remove(fid);
      }
      renderModal(); notify('list');   // store.rename/remove persist on success
    });
  }

  bind();

  window.corpusFolders = {
    load, all: () => store.all(), byId, has,
    inWorkspace, toggleWorkspace, clearWorkspace, workspaceItems, workspaceCount,
    reconcile, toggleIn, openManager, closeManager, isManagerOpen,
    toast, onChange: (cb) => subs.push(cb), isLoaded: () => loaded
  };
})();
