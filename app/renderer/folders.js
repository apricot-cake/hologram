// Shared folder store + management modal + toast, used by the post-view
// (viewer.js). The library data lives in collections.json (keyed by captureId) — the
// unified container for folders + the active workspace tray; the workspace API below
// just operates on whichever collection is active. This module owns the data, the
// management modal (#ivFolderModal), membership toggling, and the toast (#ivToast);
// the "which folder is filtered" state stays per-view. Subscribers (onChange) are
// notified after any mutation so each view refreshes its own chips.
//
//   window.corpusFolders.{ load, all, byId, has, toggleIn,
//     inWorkspace, toggleWorkspace, clearWorkspace, workspaceItems, workspaceCount,
//     reconcile, openManager, closeManager, isManagerOpen, toast, onChange, isLoaded }
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // Folder-list store shared by the library collections (below, withActive) and the
  // poster folders (viewer.js, via window.corpusFolderStore, no withActive). Owns the
  // {id,name,items[]} array + id minting + membership toggling. The caller supplies
  // persist() and does its own toast / re-render, since those differ per view. Pure
  // data layer — no DOM.
  // withActive (library only) generalizes folders into "collections": each carries
  // kind/created, and one collection can be the ACTIVE one (the 🔖 one-click tray =
  // the old single workspace). all() hides the active one so the folder UI looks
  // unchanged; allRaw() returns every collection (what we persist). The poster store
  // omits withActive, so its surface/behavior is exactly as before.
  function createFolderStore({ idPrefix, persist, withActive }) {
    let folders = [];
    let activeId = null;
    const genId = () => idPrefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const allRaw = () => folders;
    const all = () => (withActive ? folders.filter((f) => f.id !== activeId) : folders);
    function setAll(list) {
      folders = Array.isArray(list) ? list : [];
      if (withActive) folders = folders.map((f) => ({ ...f, kind: f.kind || 'static', created: (typeof f.created === 'number' ? f.created : null), items: Array.isArray(f.items) ? f.items : [] }));
    }
    const byId = (id) => folders.find((f) => f.id === id) || null;
    const has = (id, key) => { const f = byId(id); return !!(f && f.items.includes(key)); };
    function create(name) {
      const nm = (name || '').trim(); if (!nm) return null;
      const f = { id: genId(), name: nm, items: [] };
      if (withActive) { f.kind = 'static'; f.created = Date.now(); }
      folders.push(f); persist();
      return f;
    }
    function remove(id) { if (id === activeId) activeId = null; folders = folders.filter((f) => f.id !== id); persist(); }
    function rename(id, name) {
      const f = byId(id); const nm = (name || '').trim();
      if (!f || !nm) return false;
      f.name = nm; persist(); return true;
    }
    // Active-collection accessors (withActive only). ensureActive lazily mints the
    // tray collection on the first 🔖 when none exists (empty old workspace migrated
    // to activeId=null). 'c-' prefix marks it as the workspace-origin collection.
    const getActiveId = () => activeId;
    const setActiveId = (id) => { activeId = (typeof id === 'string' && byId(id)) ? id : null; };
    const getActive = () => byId(activeId);
    function ensureActive(name) {
      if (activeId && byId(activeId)) return activeId;
      const f = { id: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), name: (name || '').trim() || 'Workspace', kind: 'static', created: Date.now(), items: [] };
      folders.push(f); activeId = f.id; persist();
      return f.id;
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
    return {
      all, allRaw, setAll, byId, has, create, remove, rename, toggleIn, reconcile, move,
      ...(withActive ? { getActiveId, setActiveId, getActive, ensureActive } : {}),
    };
  }
  window.corpusFolderStore = createFolderStore;

  let posterWorkspace = [];   // [posterKey] — the poster-side tray, kept in a SEPARATE
                              // namespace so the captureId workspace API stays untouched.
  // Library collections [{ id, name, kind, created, items:[captureId] }] — the unified
  // container (folders + the active workspace tray). withActive marks one as the 🔖 target.
  const store = createFolderStore({ idPrefix: 'f', persist: () => persist(), withActive: true });
  // The management modal (#ivFolderModal) is shared: by default it edits the library
  // store, but openManager({store,onChange}) re-points it at the poster folder store
  // (viewer.js pfStore) so both views get the same CRUD + drag-reorder UI. Each store
  // owns its own persist (folders.json vs poster-folders.json); mgrAfter re-renders
  // the view that owns the rows.
  let mgrStore = store;
  let mgrAfter = () => notify('list');
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
    // allRaw() — the active collection MUST be persisted too (all() hides it).
    if (window.corpus && window.corpus.setCollections) window.corpus.setCollections({ collections: store.allRaw(), activeId: store.getActiveId(), posterWorkspace }).catch(() => { /* best-effort */ });
  }
  function notify(kind) { subs.forEach((cb) => { try { cb(kind); } catch { /* ignore */ } }); }

  async function doLoad() {
    try {
      // getCollections migrates a legacy folders.json on first read (main.js).
      const r = (window.corpus && window.corpus.getCollections) ? await window.corpus.getCollections() : null;
      store.setAll((r && r.collections) || []);
      store.setActiveId((r && typeof r.activeId === 'string') ? r.activeId : null);
      posterWorkspace = (r && Array.isArray(r.posterWorkspace)) ? r.posterWorkspace.slice() : [];
    } catch { store.setAll([]); store.setActiveId(null); posterWorkspace = []; }
    loaded = true;
  }
  function load() { if (!loadPromise) loadPromise = doLoad(); return loadPromise; }

  const byId = store.byId;
  const has = store.has;

  // --- Workspace = the ACTIVE collection (the 🔖 one-click tray). The old single
  // ephemeral array is now just whichever collection activeId points at; the API
  // shape is unchanged so the sidebar tray UI keeps working. ---
  function inWorkspace(cid) { return store.has(store.getActiveId(), cid); }
  function workspaceItems() { const a = store.getActive(); return a ? a.items.slice() : []; }
  function workspaceCount(existing) {
    const a = store.getActive(); if (!a) return 0;
    return existing ? a.items.filter((c) => existing.has(c)).length : a.items.length;
  }
  // Toggle captureIds[] (a whole group) in the active collection; anchor decides
  // state. Lazily creates the active collection on the first add.
  function toggleWorkspace(captureIds, anchorCid) {
    const ids = (captureIds || []).filter(Boolean);
    if (!ids.length) return null;
    const id = store.ensureActive(t('workspaceTitle'));
    const res = store.toggleIn(id, ids, anchorCid);   // persists
    if (!res) return null;
    toast(res === 'removed' ? t('wsRemoved') : t('wsAdded'));
    notify('workspace');
    return res;
  }
  function clearWorkspace() {
    const a = store.getActive();
    if (!a || !a.items.length) return 0;
    const n = a.items.length;
    a.items = [];   // empty the tray but keep the collection (and activeId)
    persist();
    toast(t('wsCleared'));
    notify('workspace');
    return n;
  }

  // Poster-side tray — mirrors the captureId workspace above but keyed by posterKey
  // (platform:userId). Separate namespace so the post-side API/reconcile is unchanged.
  function inPosterWorkspace(key) { return posterWorkspace.includes(key); }
  function posterWorkspaceItems() { return posterWorkspace.slice(); }
  function posterWorkspaceCount(existing) { return existing ? posterWorkspace.filter((k) => existing.has(k)).length : posterWorkspace.length; }
  function togglePosterWorkspace(keys, anchorKey) {
    const ids = (keys || []).filter(Boolean);
    if (!ids.length) return null;
    const anchor = anchorKey != null ? anchorKey : ids[0];
    const wasIn = posterWorkspace.includes(anchor);
    if (wasIn) posterWorkspace = posterWorkspace.filter((k) => !ids.includes(k));
    else ids.forEach((k) => { if (!posterWorkspace.includes(k)) posterWorkspace.push(k); });
    persist();
    toast(wasIn ? t('wsRemoved') : t('wsAdded'));
    notify('poster-workspace');
    return wasIn ? 'removed' : 'added';
  }
  function clearPosterWorkspace() {
    if (!posterWorkspace.length) return 0;
    const n = posterWorkspace.length;
    posterWorkspace = [];
    persist();
    toast(t('wsCleared'));
    notify('poster-workspace');
    return n;
  }
  // Drop posterKeys no longer backed by any post (the poster vanished). Persists once.
  function reconcilePoster(existing) {
    const n = posterWorkspace.length;
    posterWorkspace = posterWorkspace.filter((k) => existing.has(k));
    if (posterWorkspace.length !== n) { persist(); notify('poster-workspace'); }
  }

  // Drop captureIds no longer present (deleted items), persisting + notifying once.
  // store.reconcile cleans every collection — including the active one (it lives in
  // the same array now), so no separate workspace pass is needed.
  function reconcile(existing) {
    const changed = store.reconcile(existing);
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
  function openManager(opts) {
    mgrStore = (opts && opts.store) || store;
    mgrAfter = (opts && opts.onChange) || (() => notify('list'));
    renderModal();
    const m = $('ivFolderModal'); if (m) m.hidden = false;
    setTimeout(() => { try { $('ivFolderNewName').focus(); } catch { /* ignore */ } }, 0);
  }
  function closeManager() { const m = $('ivFolderModal'); if (m) m.hidden = true; mgrStore = store; mgrAfter = () => notify('list'); }
  function renderModal() {
    const host = $('ivFolderList'); if (!host) return;
    const list = mgrStore.all();
    host.innerHTML = list.length ? list.map((f) => {
      return `<div class="iv-folder-row" data-fid="${escapeHtml(f.id)}" draggable="true">` +
        `<span class="iv-fold-name">${escapeHtml(f.name)}</span>` +
        `<span class="iv-fold-n">${f.items.length}</span>` +
        `<button class="iv-fold-btn" data-fact="rename" title="${escapeHtml(t('foldRename'))}">✎</button>` +
        `<button class="iv-fold-btn" data-fact="delete" title="${escapeHtml(t('foldDelete'))}">🗑</button>` +
        `</div>`;
    }).join('') : `<div class="iv-folder-empty">${escapeHtml(t('foldEmpty'))}</div>`;
  }
  function create() {
    const inp = $('ivFolderNewName'); if (!inp) return;
    if (!mgrStore.create(inp.value)) return;   // store mints the id + persists
    inp.value = '';
    renderModal(); mgrAfter();
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
      const fid = row.dataset.fid; const f = mgrStore.byId(fid); if (!f) return;
      if (act.dataset.fact === 'rename') { mgrStore.rename(fid, window.prompt(t('foldRenamePrompt'), f.name)); }
      else if (act.dataset.fact === 'delete') {
        if (!window.confirm(t('foldDeleteConfirm', [f.name]))) return;
        mgrStore.remove(fid);
      }
      renderModal(); mgrAfter();   // mgrStore.rename/remove persist on success
    });
    // Drag-and-drop reorder (same idiom as the poster folders): persist via store.move,
    // notify so the sidebar chips re-render in the new order.
    const flist = $('ivFolderList');
    let dragId = null;
    const clearMarks = () => flist.querySelectorAll('.iv-drop-before, .iv-drop-after').forEach((el) => el.classList.remove('iv-drop-before', 'iv-drop-after'));
    const dropBefore = (row, clientY) => { const r = row.getBoundingClientRect(); return clientY < r.top + r.height / 2; };
    flist.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.iv-folder-row'); if (!row) return;
      dragId = row.dataset.fid;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId); } catch { /* some engines disallow */ }
      row.classList.add('iv-dragging');
    });
    flist.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearMarks();
      const row = e.target.closest('.iv-folder-row');
      if (row && row.dataset.fid !== dragId) row.classList.add(dropBefore(row, e.clientY) ? 'iv-drop-before' : 'iv-drop-after');
    });
    flist.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const row = e.target.closest('.iv-folder-row');
      if (row && row.dataset.fid !== dragId && mgrStore.move(dragId, row.dataset.fid, dropBefore(row, e.clientY))) { renderModal(); mgrAfter(); }
      dragId = null;
    });
    flist.addEventListener('dragend', () => { dragId = null; clearMarks(); flist.querySelectorAll('.iv-dragging').forEach((el) => el.classList.remove('iv-dragging')); });
  }

  bind();

  window.corpusFolders = {
    load, all: () => store.all(), byId, has,
    inWorkspace, toggleWorkspace, clearWorkspace, workspaceItems, workspaceCount,
    inPosterWorkspace, togglePosterWorkspace, clearPosterWorkspace, posterWorkspaceItems, posterWorkspaceCount, reconcilePoster,
    reconcile, toggleIn, openManager, closeManager, isManagerOpen,
    toast, onChange: (cb) => subs.push(cb), isLoaded: () => loaded
  };
})();
