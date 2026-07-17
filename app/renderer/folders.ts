// Shared folder store + management-modal state + toast, used by the post-view
// (orchestrator.ts). The library data lives in folders.json (keyed by captureId) —
// the unified container for folders (collections). Clip is a separate library-wide
// ephemeral flag set (a captureId Set), persisted alongside the collections. This
// module owns the data, the management-modal state (rendering is the FolderManagerModal
// island, #ivFolderModal), membership toggling, and the toast (sonner via ui.ts); the "which
// folder is filtered" state stays per-view. Subscribers (onChange) are notified after
// any mutation so each view refreshes its own chips.
//
// A real ES module (named exports) now: load, all, byId, has, toggleIn, isClipped,
// toggleClip, clearClips, clippedItems, clipCount, reconcile, openManager,
// closeManager, isManagerOpen, getManager, subscribeManager, managerCreate,
// managerRename, managerRemove, managerMove, toast, onChange, isLoaded, allCollections,
// createCollection, updateCollection, renameCollection, removeCollection — plus the
// corpusPosterFolderStore() factory (orchestrator.ts's poster-folder store).
import { notify as uiNotify } from './ui.ts';
import { corpusI18n } from './i18n.ts';
import { corpusIpc } from './ipc.ts';

// Folder-list store shared by the library collections (below, isCollections) and the
// poster folders (viewer.js, via the corpusPosterFolderStore() factory below, no isCollections). Owns the
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
// closure + a manual getPosterFolders/setAll block in boot — both now live here).
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
export function corpusPosterFolderStore(): CorpusPersistedFolderStore {
  return createPersistedFolderStore({
    idPrefix: 'pf',
    get: () => corpusIpc.getPosterFolders(),
    set: (data) => corpusIpc.setPosterFolders(data),
  });
}

// Library collections [{ id, name, kind, created, items:[captureId] }] — the unified
// folders container. isCollections enables kind/created + dynamic saved-search.
const store = createFolderStore({ idPrefix: 'f', persist: () => persist(), isCollections: true });
// Clip = a library-wide ephemeral flag set (captureId Set), separate from collections.
// Persisted alongside the folders in folders.json (the `clip` array).
let clipSet = new Set<string>();
// The management modal (FolderManagerModal island, #ivFolderModal) is shared: by
// default it edits the library store, but openManager({store,onChange}) re-points it at
// the poster folder store (orchestrator.ts pfStore) so both views get the same CRUD +
// drag-reorder UI. Each store owns its own persist (folders.json vs poster-folders.json);
// mgrAfter re-renders the view that owns the rows. mgrModel/mgrSubs are the modal's own
// open/closed + list state (separate from `subs`/notify below, which is the folder-DATA
// change channel every view's chips subscribe to) — FolderManagerModal.tsx subscribes
// via getManager()/subscribeManager().
let mgrStore = store;
let mgrAfter = () => notify('list');
let mgrModel: CorpusFolderManagerModel | null = null;
let mgrSeq = 0;
const mgrSubs = new Set<() => void>();
function notifyMgr() {
  for (const cb of [...mgrSubs]) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}
let loaded = false;
let loadPromise: Promise<void> | null = null;
const subs: Array<(kind?: string) => void> = [];

// i18n: this module's own toasts (foldAdded/foldRemoved/clipAdded/clipRemoved/
// clipCleared, fired from business logic below, outside any component render) reuse the
// renderer's i18n — corpusI18n is a promise from i18n.ts; resolve once and cache
// getMessage as t(), until then t() echoes the key. The modal's own labels (title,
// placeholder, rename/delete prompts) are the island's concern — FolderManagerModal.tsx
// uses the shared islands/_shared/i18n.ts t() directly in JSX.
let t: (key: string, subs2?: ReadonlyArray<string | number | null | undefined>) => string = (key) => key;
corpusI18n.then((api) => {
  if (api && api.getMessage) t = api.getMessage;
});

function persist() {
  loadPromise = null; // invalidate the load cache so a later load() re-reads disk (defensive; in-memory state stays authoritative this session)
  if (corpusIpc && corpusIpc.setFolders)
    corpusIpc.setFolders({ folders: store.allRaw(), clip: [...clipSet] }).catch(() => {
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
    const r = corpusIpc && corpusIpc.getFolders ? await corpusIpc.getFolders() : null;
    store.setAll((r && r.folders) || []);
    // activeId is legacy (the old 🔖 target) — ignore it; the old active collection
    // just stays as a normal collection. Clip loads from the persisted `clip` array.
    clipSet = new Set(r && Array.isArray(r.clip) ? r.clip.map(String) : []);
  } catch {
    store.setAll([]);
    clipSet = new Set<string>();
  }
  loaded = true;
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

export const byId = store.byId;
export const has = store.has;

// --- Clip = a library-wide ephemeral flag set (a captureId Set), separate from
// collections. One-click 📎 on a card flags it; the sidebar clip row filters by it;
// flags persist until explicitly cleared. ---
export function isClipped(cid: string) {
  return clipSet.has(cid);
}
export function clippedItems() {
  return [...clipSet];
}
export function clipCount(existing?: Set<string> | null) {
  if (!existing) return clipSet.size;
  let n = 0;
  for (const c of clipSet) if (existing.has(c)) n++;
  return n;
}
// Toggle captureIds[] (a whole group) in the clip set; anchor decides the resulting
// state (a tile's representative id). Returns 'added' | 'removed' | null.
export function toggleClip(captureIds: string[] | null | undefined, anchorCid?: string | null) {
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
export function clearClips() {
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
export function reconcile(existing: Set<string>) {
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
export function toggleIn(fid: string | null | undefined, captureIds: string[] | null | undefined, anchorCid?: string | null) {
  const f = byId(fid);
  if (!f) return null; // capture the name before toggling for the toast
  const res = store.toggleIn(fid, captureIds, anchorCid);
  if (!res) return null;
  toast(res === 'removed' ? t('foldRemoved', [f.name]) : t('foldAdded', [f.name]));
  notify('membership');
  return res;
}

// --- toast (shared — sonner via ui.ts notify()) ---
export function toast(msg: unknown) {
  return uiNotify(msg);
}

// --- management modal (state only — rendering is FolderManagerModal.tsx) ---
export function isManagerOpen() {
  return !!mgrModel;
}
export function openManager(opts?: { store?: CorpusFolderStore; onChange?: () => void } | null) {
  mgrStore = (opts && opts.store) || store;
  mgrAfter = (opts && opts.onChange) || (() => notify('list'));
  mgrModel = { openId: ++mgrSeq, list: mgrStore.all() };
  notifyMgr();
}
export function closeManager() {
  mgrModel = null;
  mgrStore = store;
  mgrAfter = () => notify('list');
  notifyMgr();
}
function refreshManager() {
  if (!mgrModel) return;
  mgrModel = { ...mgrModel, list: mgrStore.all() };
  notifyMgr();
}
export function getManager() {
  return mgrModel;
}
export function subscribeManager(cb: () => void) {
  mgrSubs.add(cb);
  return () => mgrSubs.delete(cb);
}
export function managerCreate(name: string | null | undefined) {
  if (!mgrStore.create(name)) return false; // store mints the id + persists
  refreshManager();
  mgrAfter();
  return true;
}
export function managerRename(id: string | null | undefined, name: string | null | undefined) {
  if (!mgrStore.rename(id, name)) return false;
  refreshManager();
  mgrAfter(); // mgrStore.rename persists on success
  return true;
}
export function managerRemove(id: string | null | undefined) {
  mgrStore.remove(id);
  refreshManager();
  mgrAfter();
}
// Drag-and-drop reorder (same idiom as the poster folders): persist via store.move,
// notify so the sidebar chips re-render in the new order.
export function managerMove(draggedId: string | null | undefined, targetId: string | null | undefined, before: boolean) {
  if (!mgrStore.move(draggedId, targetId, before)) return false;
  refreshManager();
  mgrAfter();
  return true;
}

export function all() {
  return store.all();
}

// Collection view (第3モード): expose the store's CRUD so the grid can list every
// collection and create/rename/delete from cards. Thin wrappers persist + notify so
// all views refresh (store.create/remove/rename persist).
export function allCollections() {
  return store.allRaw();
}
export function createCollection(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string } | null) {
  const f = store.create(name, opts);
  if (f) notify('list');
  return f;
}
export function updateCollection(id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined) {
  const ok = store.update ? store.update(id, patch) : false; // update exists only on the collections store (isCollections)
  if (ok) notify('list');
  return ok;
}
export function renameCollection(id: string | null | undefined, name: string | null | undefined) {
  const ok = store.rename(id, name);
  if (ok) notify('list');
  return ok;
}
export function removeCollection(id: string | null | undefined) {
  store.remove(id);
  notify('list');
}
export function onChange(cb: (kind?: string) => void) {
  subs.push(cb);
}
export function isLoaded() {
  return loaded;
}
