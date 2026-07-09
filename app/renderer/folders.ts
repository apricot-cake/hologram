// Shared folder store + management modal + toast, used by the post-view
// (viewer.js). The library data lives in collections.json (keyed by captureId) — the
// unified container for folders (collections). Clip is a separate library-wide
// ephemeral flag set (a captureId Set), persisted alongside the collections. This
// module owns the data, the management modal (#ivFolderModal), membership toggling,
// and the toast (#ivToast); the "which folder is filtered" state stays per-view.
// Subscribers (onChange) are notified after any mutation so each view refreshes its
// own chips.
//
//   window.corpusFolders.{ load, all, byId, has, toggleIn,
//     isClipped, toggleClip, clearClips, clippedItems, clipCount,
//     reconcile, openManager, closeManager, isManagerOpen, toast, onChange, isLoaded }
import { escapeHtml as uiEscapeHtml, notify as uiNotify } from './ui.ts';

(function () {
  'use strict';
  const $ = (id: string) => document.getElementById(id);
  // event.target → nearest matching ancestor as an HTMLElement (null when the
  // target is not an Element or no match) — keeps the DOM casts in one place.
  const closestOf = (e: Event, sel: string): HTMLElement | null => {
    const t = e.target;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };

  // Folder-list store shared by the library collections (below, isCollections) and the
  // poster folders (viewer.js, via window.corpusFolderStore, no isCollections). Owns the
  // {id,name,items[]} array + id minting + membership toggling. The caller supplies
  // persist() and does its own toast / re-render, since those differ per view. Pure
  // data layer — no DOM.
  // isCollections (library only) generalizes folders into "collections": each carries
  // kind/created, and dynamic collections carry a saved-search payload (tree + q). The
  // poster store omits isCollections, so its surface/behavior is exactly as before.
  function createFolderStore({ idPrefix, persist, isCollections }: { idPrefix: string; persist: () => void; isCollections?: boolean }): CorpusFolderStore {
    let folders: CorpusFolder[] = [];
    const genId = () => idPrefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    const allRaw = () => folders;
    const all = () => folders;
    function setAll(list: unknown) {
      folders = Array.isArray(list) ? (list as CorpusFolder[]) : [];
      if (isCollections) folders = folders.map((f) => ({ ...f, kind: f.kind || 'static', created: typeof f.created === 'number' ? f.created : null, items: Array.isArray(f.items) ? f.items : [] }));
    }
    const byId = (id: string | null | undefined) => folders.find((f) => f.id === id) || null;
    const has = (id: string | null | undefined, key: string) => {
      const f = byId(id);
      return !!(f && f.items.includes(key));
    };
    function create(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string } | null) {
      const nm = (name || '').trim();
      if (!nm) return null;
      const f: CorpusFolder = { id: genId(), name: nm, items: [] };
      if (isCollections) {
        f.kind = opts && opts.kind === 'dynamic' ? 'dynamic' : 'static';
        f.created = Date.now();
        if (f.kind === 'dynamic') setQuery(f, opts); // saved-search payload (tree + free-text)
      }
      folders.push(f);
      persist();
      return f;
    }
    // Copy a saved-search condition (boolean tree + free-text q) onto a dynamic
    // collection; clears either when absent. Static collections never carry these.
    function setQuery(f: CorpusFolder, src?: { tree?: unknown; q?: string } | null) {
      if (src && src.tree && typeof src.tree === 'object') f.tree = JSON.parse(JSON.stringify(src.tree));
      else delete f.tree;
      if (src && typeof src.q === 'string' && src.q) f.q = src.q;
      else delete f.q;
    }
    // Update a dynamic collection's saved condition in place (= re-save the search).
    function update(id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined) {
      const f = byId(id);
      if (!f || f.kind !== 'dynamic') return false;
      setQuery(f, patch);
      persist();
      return true;
    }
    function remove(id: string | null | undefined) {
      folders = folders.filter((f) => f.id !== id);
      persist();
    }
    function rename(id: string | null | undefined, name: string | null | undefined) {
      const f = byId(id);
      const nm = (name || '').trim();
      if (!f || !nm) return false;
      f.name = nm;
      persist();
      return true;
    }
    // Toggle one key or a whole group of keys in folder id; anchorKey decides the
    // resulting state (a tile's representative id). Returns 'added' | 'removed' | null.
    function toggleIn(id: string | null | undefined, keys: string | string[] | null | undefined, anchorKey?: string | null) {
      const f = byId(id);
      if (!f) return null;
      const ids = (Array.isArray(keys) ? keys : [keys]).filter((k): k is string => k != null);
      if (!ids.length) return null;
      const anchor = anchorKey != null ? anchorKey : ids[0];
      const wasIn = f.items.includes(anchor);
      if (wasIn) f.items = f.items.filter((c) => !ids.includes(c));
      else
        ids.forEach((c) => {
          if (!f.items.includes(c)) f.items.push(c);
        });
      persist();
      return wasIn ? 'removed' : 'added';
    }
    // Drop keys no longer present (deleted items). Returns true if anything changed.
    function reconcile(existing: Set<string>) {
      let changed = false;
      folders.forEach((f) => {
        const n = f.items.length;
        f.items = f.items.filter((c) => existing.has(c));
        if (f.items.length !== n) changed = true;
      });
      return changed;
    }
    // Reorder: place draggedId before/after targetId (drag-and-drop). Returns true
    // if the order changed.
    function move(draggedId: string | null | undefined, targetId: string | null | undefined, before: boolean) {
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
      all,
      allRaw,
      setAll,
      byId,
      has,
      create,
      remove,
      rename,
      toggleIn,
      reconcile,
      move,
      ...(isCollections ? { update } : {}),
    };
  }

  // Persist/load-wired variant of createFolderStore, for callers that just want a ready
  // store backed by a get/set IPC pair (the same load-caching idiom as the collections
  // store's own load()/persist() below, generalized). Currently used for the poster
  // folder store (viewer.js pfStore used to hand-assemble this: its own persist()
  // closure + a manual getPosterFolders/setAll block in boot — both now live here,
  // the one place besides ipc.ts that still touches window.corpusIpc for folders).
  function createPersistedFolderStore({
    idPrefix,
    get,
    set,
  }: {
    idPrefix: string;
    get: () => Promise<{ folders?: unknown[] } | null>;
    set: (data: { folders: CorpusFolder[] }) => Promise<unknown>;
  }): CorpusFolderStore & { load: () => Promise<void> } {
    let loadPromise: Promise<void> | null = null;
    function doPersist() {
      loadPromise = null; // invalidate the load cache so a later load() re-reads disk
      set({ folders: store.allRaw() }).catch(() => {
        /* best-effort */
      });
    }
    const store = createFolderStore({ idPrefix, persist: doPersist });
    async function doLoad() {
      try {
        const r = await get();
        store.setAll((r && r.folders) || []);
      } catch {
        store.setAll([]);
      }
    }
    function load() {
      if (!loadPromise) loadPromise = doLoad();
      return loadPromise;
    }
    return { ...store, load };
  }
  window.corpusPosterFolderStore = () =>
    createPersistedFolderStore({
      idPrefix: 'pf',
      get: () => window.corpusIpc.getPosterFolders(),
      set: (data) => window.corpusIpc.setPosterFolders(data),
    });

  // Library collections [{ id, name, kind, created, items:[captureId] }] — the unified
  // folders container. isCollections enables kind/created + dynamic saved-search.
  const store = createFolderStore({ idPrefix: 'f', persist: () => persist(), isCollections: true });
  // Clip = a library-wide ephemeral flag set (captureId Set), separate from collections.
  // Persisted alongside the collections in collections.json (the `clip` array).
  let clipSet = new Set<string>();
  // The management modal (#ivFolderModal) is shared: by default it edits the library
  // store, but openManager({store,onChange}) re-points it at the poster folder store
  // (viewer.js pfStore) so both views get the same CRUD + drag-reorder UI. Each store
  // owns its own persist (folders.json vs poster-folders.json); mgrAfter re-renders
  // the view that owns the rows.
  let mgrStore = store;
  let mgrAfter = () => notify('list');
  let loaded = false;
  let loadPromise: Promise<void> | null = null;
  const subs: Array<(kind?: string) => void> = [];

  // i18n: this module owns the folder modal + its toasts. window.corpusI18n is a
  // promise set by i18n.js (loaded before this script). Resolve once and cache
  // getMessage as t(); until then t() echoes the key. Static modal labels are
  // applied on resolve (and re-applied if the modal is open). Dynamic strings
  // (toasts, row buttons, prompts, confirms) call t() at use time.
  let t: (key: string, subs2?: ReadonlyArray<string | number | null | undefined>) => string = (key) => key;
  if (window.corpusI18n && typeof window.corpusI18n.then === 'function') {
    window.corpusI18n.then((api) => {
      if (api && api.getMessage) {
        t = api.getMessage;
        applyStaticI18n();
      }
    });
  }
  function applyStaticI18n() {
    const modal = $('ivFolderModal');
    if (!modal) return;
    const title = modal.querySelector('.iv-insp-title');
    if (title) title.textContent = t('foldManageTitle');
    const inp = $('ivFolderNewName') as HTMLInputElement | null;
    if (inp) inp.placeholder = t('foldNewPlaceholder');
    const createBtn = $('ivFolderCreate');
    if (createBtn) createBtn.textContent = t('foldCreate');
    if (isManagerOpen()) renderModal(); // refresh empty-state / row labels if already shown
  }

  function escapeHtml(s: unknown) {
    return uiEscapeHtml(s);
  }
  function persist() {
    loadPromise = null; // invalidate the load cache so a later load() re-reads disk (defensive; in-memory state stays authoritative this session)
    if (window.corpusIpc && window.corpusIpc.setCollections)
      window.corpusIpc.setCollections({ collections: store.allRaw(), clip: [...clipSet] }).catch(() => {
        /* best-effort */
      });
  }
  function notify(kind?: string) {
    subs.forEach((cb) => {
      try {
        cb(kind);
      } catch {
        /* ignore */
      }
    });
  }

  async function doLoad() {
    try {
      // getCollections migrates a legacy folders.json on first read (main.js).
      const r = window.corpusIpc && window.corpusIpc.getCollections ? await window.corpusIpc.getCollections() : null;
      store.setAll((r && r.collections) || []);
      // activeId is legacy (the old 🔖 target) — ignore it; the old active collection
      // just stays as a normal collection. Clip loads from the persisted `clip` array.
      clipSet = new Set(r && Array.isArray(r.clip) ? r.clip.map(String) : []);
    } catch {
      store.setAll([]);
      clipSet = new Set<string>();
    }
    loaded = true;
  }
  function load() {
    if (!loadPromise) loadPromise = doLoad();
    return loadPromise;
  }

  const byId = store.byId;
  const has = store.has;

  // --- Clip = a library-wide ephemeral flag set (a captureId Set), separate from
  // collections. One-click 📎 on a card flags it; the sidebar clip row filters by it;
  // flags persist until explicitly cleared. ---
  function isClipped(cid: string) {
    return clipSet.has(cid);
  }
  function clippedItems() {
    return [...clipSet];
  }
  function clipCount(existing?: Set<string> | null) {
    if (!existing) return clipSet.size;
    let n = 0;
    for (const c of clipSet) if (existing.has(c)) n++;
    return n;
  }
  // Toggle captureIds[] (a whole group) in the clip set; anchor decides the resulting
  // state (a tile's representative id). Returns 'added' | 'removed' | null.
  function toggleClip(captureIds: string[] | null | undefined, anchorCid?: string | null) {
    const ids = (captureIds || []).filter(Boolean);
    if (!ids.length) return null;
    const anchor = anchorCid != null ? anchorCid : ids[0];
    const wasIn = clipSet.has(anchor);
    if (wasIn) ids.forEach((c) => clipSet.delete(c));
    else ids.forEach((c) => clipSet.add(c));
    persist();
    toast(wasIn ? t('clipRemoved') : t('clipAdded'));
    notify('clip');
    return wasIn ? 'removed' : 'added';
  }
  function clearClips() {
    if (!clipSet.size) return 0;
    const n = clipSet.size;
    clipSet.clear();
    persist();
    toast(t('clipCleared'));
    notify('clip');
    return n;
  }

  // Drop captureIds no longer present (deleted items), persisting + notifying once.
  // store.reconcile cleans every collection; the clip set is swept separately.
  function reconcile(existing: Set<string>) {
    let changed = store.reconcile(existing);
    for (const c of clipSet)
      if (!existing.has(c)) {
        clipSet.delete(c);
        changed = true;
      }
    if (changed) {
      persist();
      notify('list');
    }
  }

  // Toggle membership of captureIds[] in folder fid. anchorCid decides the
  // current state (the tile's representative id). Returns 'added' | 'removed' | null.
  function toggleIn(fid: string | null | undefined, captureIds: string[] | null | undefined, anchorCid?: string | null) {
    const f = byId(fid);
    if (!f) return null; // capture the name before toggling for the toast
    const res = store.toggleIn(fid, captureIds, anchorCid);
    if (!res) return null;
    toast(res === 'removed' ? t('foldRemoved', [f.name]) : t('foldAdded', [f.name]));
    notify('membership');
    return res;
  }

  // --- toast (shared, top-level #ivToast) ---
  function toast(msg: unknown) {
    return uiNotify(msg);
  }

  // --- management modal ---
  function isManagerOpen() {
    const m = $('ivFolderModal');
    return !!(m && !m.hidden);
  }
  function openManager(opts?: { store?: CorpusFolderStore; onChange?: () => void } | null) {
    mgrStore = (opts && opts.store) || store;
    mgrAfter = (opts && opts.onChange) || (() => notify('list'));
    renderModal();
    const m = $('ivFolderModal');
    if (m) m.hidden = false;
    setTimeout(() => {
      try {
        $('ivFolderNewName')?.focus();
      } catch {
        /* ignore */
      }
    }, 0);
  }
  function closeManager() {
    const m = $('ivFolderModal');
    if (m) m.hidden = true;
    mgrStore = store;
    mgrAfter = () => notify('list');
  }
  function renderModal() {
    const host = $('ivFolderList');
    if (!host) return;
    const list = mgrStore.all();
    host.innerHTML = list.length
      ? list
          .map((f) => {
            return (
              `<div class="iv-folder-row" data-fid="${escapeHtml(f.id)}" draggable="true">` +
              `<span class="iv-fold-name">${escapeHtml(f.name)}</span>` +
              `<span class="iv-fold-n">${f.items.length}</span>` +
              `<button class="iv-fold-btn" data-fact="rename" title="${escapeHtml(t('foldRename'))}">✎</button>` +
              `<button class="iv-fold-btn" data-fact="delete" title="${escapeHtml(t('foldDelete'))}">🗑</button>` +
              '</div>'
            );
          })
          .join('')
      : `<div class="iv-folder-empty">${escapeHtml(t('foldEmpty'))}</div>`;
  }
  function create() {
    const inp = $('ivFolderNewName') as HTMLInputElement | null;
    if (!inp) return;
    if (!mgrStore.create(inp.value)) return; // store mints the id + persists
    inp.value = '';
    renderModal();
    mgrAfter();
  }

  function bind() {
    const modal = $('ivFolderModal');
    if (!modal) return;
    const flist = $('ivFolderList');
    if (!flist) return;
    $('ivFolderClose')?.addEventListener('click', closeManager);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeManager();
    });
    $('ivFolderCreate')?.addEventListener('click', create);
    $('ivFolderNewName')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
    });
    flist.addEventListener('click', (e) => {
      const row = closestOf(e, '.iv-folder-row');
      if (!row) return;
      const act = closestOf(e, '[data-fact]');
      if (!act) return;
      const fid = row.dataset.fid;
      const f = mgrStore.byId(fid);
      if (!f) return;
      if (act.dataset.fact === 'rename') {
        mgrStore.rename(fid, window.prompt(t('foldRenamePrompt'), f.name));
      } else if (act.dataset.fact === 'delete') {
        if (!window.confirm(t('foldDeleteConfirm', [f.name]))) return;
        mgrStore.remove(fid);
      }
      renderModal();
      mgrAfter(); // mgrStore.rename/remove persist on success
    });
    // Drag-and-drop reorder (same idiom as the poster folders): persist via store.move,
    // notify so the sidebar chips re-render in the new order.
    let dragId: string | null | undefined = null;
    const clearMarks = () => flist.querySelectorAll('.iv-drop-before, .iv-drop-after').forEach((el) => el.classList.remove('iv-drop-before', 'iv-drop-after'));
    const dropBefore = (row: HTMLElement, clientY: number) => {
      const r = row.getBoundingClientRect();
      return clientY < r.top + r.height / 2;
    };
    flist.addEventListener('dragstart', (e) => {
      const row = closestOf(e, '.iv-folder-row');
      if (!row) return;
      dragId = row.dataset.fid;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', dragId || '');
        } catch {
          /* some engines disallow */
        }
      }
      row.classList.add('iv-dragging');
    });
    flist.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clearMarks();
      const row = closestOf(e, '.iv-folder-row');
      if (row && row.dataset.fid !== dragId) row.classList.add(dropBefore(row, e.clientY) ? 'iv-drop-before' : 'iv-drop-after');
    });
    flist.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const row = closestOf(e, '.iv-folder-row');
      if (row && row.dataset.fid !== dragId && mgrStore.move(dragId, row.dataset.fid, dropBefore(row, e.clientY))) {
        renderModal();
        mgrAfter();
      }
      dragId = null;
    });
    flist.addEventListener('dragend', () => {
      dragId = null;
      clearMarks();
      flist.querySelectorAll('.iv-dragging').forEach((el) => el.classList.remove('iv-dragging'));
    });
  }

  bind();

  window.corpusFolders = {
    load,
    all: () => store.all(),
    byId,
    has,
    isClipped,
    toggleClip,
    clearClips,
    clippedItems,
    clipCount,
    reconcile,
    toggleIn,
    openManager,
    closeManager,
    isManagerOpen,
    // Collection view (第3モード): expose the store's CRUD so the grid can list every
    // collection and create/rename/delete from cards. Thin wrappers persist + notify so
    // all views refresh (store.create/remove/rename persist).
    allCollections: () => store.allRaw(),
    createCollection: (name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string } | null) => {
      const f = store.create(name, opts);
      if (f) notify('list');
      return f;
    },
    updateCollection: (id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined) => {
      const ok = store.update ? store.update(id, patch) : false; // update exists only on the collections store (isCollections)
      if (ok) notify('list');
      return ok;
    },
    renameCollection: (id: string | null | undefined, name: string | null | undefined) => {
      const ok = store.rename(id, name);
      if (ok) notify('list');
      return ok;
    },
    removeCollection: (id: string | null | undefined) => {
      store.remove(id);
      notify('list');
    },
    toast,
    onChange: (cb: (kind?: string) => void) => subs.push(cb),
    isLoaded: () => loaded,
  };
})();
