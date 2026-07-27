// Shared folder store + management-modal state + toast, used by the post-view
// (orchestrator.ts). The library data lives in folders.json (keyed by captureId) —
// the unified container for folders (folders). This
// module owns the data, the management-modal state (rendering is the FolderManagerModal
// component, #ivFolderModal), membership toggling, and the toast (sonner via ui.ts); the "which
// folder is filtered" state stays per-view. Subscribers (onChange) are notified after
// any mutation so each view refreshes its own chips.
//
// A real ES module (named exports) now: load, all, byId, has, toggleIn,
// reconcile, openManager,
// closeManager, isManagerOpen, getManager, subscribeManager, managerCreate,
// managerRename, managerRemove, managerMove, toast, onChange, isLoaded, allFolders,
// createFolder, updateFolder, renameFolder, removeFolder — plus the
// hologramPosterFolderStore() factory (orchestrator.ts's poster-folder store).
import { notify as uiNotify } from './ui.ts';
import { hologramI18n } from './i18n.ts';
import { hologramIpc } from './ipc.ts';
import { cloneTree, removeCondsMatching } from './query.ts';

// Folder-list store shared by the library folders (below, isLibrary) and the
// poster folders (viewer.js, via the hologramPosterFolderStore() factory below, no isLibrary). Owns the
// {id,name,items[]} array + id minting + membership toggling. The caller supplies
// persist() and does its own toast / re-render, since those differ per view. Pure
// data layer — no DOM.
// isLibrary (library only) generalizes folders into "folders": each carries
// kind/created, and dynamic folders carry a saved-search payload (tree + q). The
// poster store omits isLibrary, so its surface/behavior is exactly as before.
function createFolderStore({ idPrefix, persist, isLibrary }: { idPrefix: string; persist: () => void; isLibrary?: boolean }): HologramFolderStore {
  let folders: HologramFolder[] = [];
  const genId = () => idPrefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const allRaw = () => folders;
  const all = () => folders;
  // Nesting (#41): the store stays a FLAT array and `parentId` is the only edge —
  // the tree is derived on demand below. parentId has to be listed here as well as
  // in the main-side normalizer, or a field that survives the file is dropped on
  // its way into the store and the next save writes the folder back to the root.
  function setAll(list: unknown) {
    folders = Array.isArray(list) ? (list as HologramFolder[]) : [];
    if (isLibrary)
      folders = folders.map((f) => ({
        ...f,
        kind: f.kind || 'static',
        created: typeof f.created === 'number' ? f.created : null,
        parentId: f.kind !== 'dynamic' && typeof f.parentId === 'string' ? f.parentId : null,
        items: Array.isArray(f.items) ? f.items : [],
      }));
    invalidateTree();
  }
  // Parent → children index, rebuilt lazily and thrown away on any structural
  // change. Sibling order is array order (no `order` field), so the index just
  // preserves the order it walks in and the existing reorder machinery keeps
  // working untouched.
  let kids: Map<string | null, HologramFolder[]> | null = null;
  function invalidateTree() {
    kids = null;
  }
  function childIndex() {
    if (!kids) {
      kids = new Map();
      for (const f of folders) {
        const p = f.parentId || null;
        const arr = kids.get(p);
        if (arr) arr.push(f);
        else kids.set(p, [f]);
      }
    }
    return kids;
  }
  const childrenOf = (id: string | null) => childIndex().get(id || null) || [];
  // The folder itself plus everything under it. Callers use it for the two places
  // where a parent stands for its subtree: matching posts (aggregation is the
  // default — a parent shows what its children hold) and cascade delete.
  function subtreeIds(id: string | null | undefined) {
    const out = new Set<string>();
    if (!id) return out;
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (out.has(cur)) continue; // a repaired file cannot contain a cycle, but never spin on one either
      out.add(cur);
      for (const c of childrenOf(cur)) stack.push(c.id);
    }
    return out;
  }
  // Membership including descendants (`only` asks for the folder's own items).
  // Nesting without aggregation would leave a flat list plus tags doing the same
  // job, so aggregation is what the default query means; 「このフォルダのみ」 opts out.
  function hasDeep(id: string | null | undefined, key: string, only?: boolean) {
    if (only) return has(id, key);
    for (const fid of subtreeIds(id)) {
      const f = byId(fid);
      if (f && f.items.includes(key)) return true;
    }
    return false;
  }
  // "親 / 子 / 孫" — for the surfaces that show a folder OUT of the tree, where the
  // name alone stopped being an identifier the moment folders could nest (two
  // 「資料」 under different parents are a normal thing to have).
  function pathOf(id: string | null | undefined) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur = byId(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = byId(cur.parentId);
    }
    return parts.join(' / ');
  }
  // Reparenting refuses to move a folder into itself or into its own subtree —
  // the one write that could turn the array into something that is not a tree.
  // The sidebar disables those drop targets while dragging; this is the guard
  // behind that, so the two can never disagree about what is legal.
  function reparent(id: string | null | undefined, parentId: string | null) {
    const f = byId(id);
    if (!f || !id) return false;
    if (parentId && subtreeIds(id).has(parentId)) return false;
    if ((f.parentId || null) === (parentId || null)) return false;
    f.parentId = parentId || null;
    invalidateTree();
    persist();
    return true;
  }
  // One drop = one write. A tree drag can change BOTH the parent and the position
  // among siblings ("put it under 資料, third from the top"), and doing that as a
  // reparent followed by a reorder would persist twice and let subscribers see the
  // folder in a place the user never dropped it.
  //   into   — make it a child of targetId (null = the root)
  //   before / after — put it beside targetId, adopting that row's parent
  function place(draggedId: string | null | undefined, targetId: string | null, mode: 'into' | 'before' | 'after') {
    const f = byId(draggedId);
    if (!f || !draggedId || draggedId === targetId) return false;
    const target = byId(targetId);
    if (mode !== 'into' && !target) return false; // "beside" needs a row to be beside
    const newParent = mode === 'into' ? (target ? target.id : null) : (target as HologramFolder).parentId || null;
    // Same refusal as reparent: a folder cannot land inside its own subtree.
    if (newParent && subtreeIds(draggedId).has(newParent)) return false;
    const parentChanged = (f.parentId || null) !== newParent;
    if (mode === 'into' && !parentChanged) return false; // already there
    f.parentId = newParent;
    if (target && mode !== 'into') {
      folders.splice(folders.indexOf(f), 1);
      const to = folders.indexOf(target);
      folders.splice(mode === 'before' ? to : to + 1, 0, f);
    }
    invalidateTree();
    persist();
    return true;
  }
  const byId = (id: string | null | undefined) => folders.find((f) => f.id === id) || null;
  const has = (id: string | null | undefined, key: string) => {
    const f = byId(id);
    return !!(f && f.items.includes(key));
  };
  function create(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; parentId?: string | null } | null) {
    const nm = (name || '').trim();
    if (!nm) return null;
    const f: HologramFolder = { id: genId(), name: nm, items: [] };
    if (isLibrary) {
      f.kind = opts && opts.kind === 'dynamic' ? 'dynamic' : 'static';
      f.created = Date.now();
      // A subfolder is created from its parent's context menu, so the parent comes
      // in with the name. An id nobody owns would be repaired away on the next read
      // anyway; refusing it here keeps that from looking like a lost folder.
      f.parentId = f.kind === 'dynamic' || !opts || !opts.parentId || !byId(opts.parentId) ? null : opts.parentId;
      if (f.kind === 'dynamic') setQuery(f, opts); // saved-search payload (the condition tree)
    }
    folders.push(f);
    invalidateTree();
    persist();
    return f;
  }
  // Copy a saved search (the condition tree — the free-text term is a 'text' leaf
  // inside it) onto a dynamic folder; clears it when absent. Static folders never
  // carry one. cloneTree drops the _-prefixed compile memos, so what lands on disk
  // is plain data.
  function setQuery(f: HologramFolder, src?: { tree?: unknown } | null) {
    if (src && src.tree && typeof src.tree === 'object') f.tree = cloneTree(src.tree as HologramQueryNode);
    else delete f.tree;
  }
  // Update a dynamic folder's saved condition in place (= re-save the search).
  function update(id: string | null | undefined, patch: { tree?: unknown } | null | undefined) {
    const f = byId(id);
    if (!f || f.kind !== 'dynamic') return false;
    setQuery(f, patch);
    persist();
    return true;
  }
  // Deleting a folder also has to sweep it out of every saved search: a live query
  // tree gets its folder leaf cleaned up on delete, but the trees sitting inside
  // dynamic folders do not — a dangling leaf evaluates false forever, so the saved
  // search silently goes to zero results. #41's cascade delete passes the whole set
  // of removed ids for the same reason.
  function pruneFolderLeaves(ids: Set<string>) {
    let changed = false;
    for (const f of folders) {
      if (f.kind !== 'dynamic' || !f.tree) continue;
      if (removeCondsMatching(f.tree, (c) => c.type === 'folder' && ids.has(String(c.value)))) changed = true;
    }
    return changed;
  }
  // Deleting a folder takes its subtree with it (Explorer / Finder / Eagle all do;
  // the alternative — silently promoting the children — moves folders the user
  // never asked to move). The posts themselves stay in the library. Every removed
  // id has to reach pruneFolderLeaves, not just the one that was clicked, or a
  // saved search keeps a leaf pointing at a folder that no longer exists and
  // quietly answers zero forever.
  function remove(id: string | null | undefined) {
    const gone = isLibrary ? subtreeIds(id) : new Set(id ? [id] : []);
    folders = folders.filter((f) => !gone.has(f.id));
    invalidateTree();
    if (isLibrary && gone.size) pruneFolderLeaves(gone);
    persist();
    return gone;
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
    if (f.kind === 'dynamic') return null; // a saved search has no membership — its contents are the query's answer
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
    invalidateTree(); // sibling order IS array order, so the child index is stale now
    persist();
    return true;
  }
  return {
    all,
    allRaw,
    setAll,
    byId,
    has,
    hasDeep,
    childrenOf,
    pathOf,
    subtreeIds,
    reparent,
    place,
    create,
    remove,
    rename,
    toggleIn,
    reconcile,
    move,
    ...(isLibrary ? { update } : {}),
  };
}

// Persist/load-wired variant of createFolderStore, for callers that just want a ready
// store backed by a get/set IPC pair (the same load-caching idiom as the folders
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
  set: (data: { folders: HologramFolder[] }) => Promise<unknown>;
}): HologramFolderStore & { load: () => Promise<void> } {
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
export function hologramPosterFolderStore(): HologramPersistedFolderStore {
  return createPersistedFolderStore({
    idPrefix: 'pf',
    get: () => hologramIpc.getPosterFolders(),
    set: (data) => hologramIpc.setPosterFolders(data),
  });
}

// Library folders [{ id, name, kind, created, items:[captureId] }] — the unified
// folders container. isLibrary enables kind/created + dynamic saved-search.
const store = createFolderStore({ idPrefix: 'f', persist: () => persist(), isLibrary: true });
// The management modal (FolderManagerModal component, #ivFolderModal) is shared: by
// default it edits the library store, but openManager({store,onChange}) re-points it at
// the poster folder store (orchestrator.ts pfStore) so both views get the same CRUD +
// drag-reorder UI. Each store owns its own persist (folders.json vs poster-folders.json);
// mgrAfter re-renders the view that owns the rows. mgrModel/mgrSubs are the modal's own
// open/closed + list state (separate from `subs`/notify below, which is the folder-DATA
// change channel every view's chips subscribe to) — FolderManagerModal.tsx subscribes
// via getManager()/subscribeManager().
let mgrStore = store;
let mgrAfter = () => notify('list');
let mgrModel: HologramFolderManagerModel | null = null;
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

// i18n: this module's own toasts (foldAdded/foldRemoved,
// fired from business logic below, outside any component render) reuse the
// renderer's i18n — hologramI18n is a promise from i18n.ts; resolve once and cache
// getMessage as t(), until then t() echoes the key. The modal's own labels (title,
// placeholder, rename/delete prompts) are the component's concern — FolderManagerModal.tsx
// uses the shared _shared/i18n.ts t() directly in JSX.
let t: (key: string, subs2?: ReadonlyArray<string | number | null | undefined>) => string = (key) => key;
hologramI18n.then((api) => {
  if (api && api.getMessage) t = api.getMessage;
});

function persist() {
  loadPromise = null; // invalidate the load cache so a later load() re-reads disk (defensive; in-memory state stays authoritative this session)
  if (hologramIpc && hologramIpc.setFolders)
    hologramIpc.setFolders({ folders: store.allRaw() }).catch(() => {
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
    const r = hologramIpc && hologramIpc.getFolders ? await hologramIpc.getFolders() : null;
    store.setAll((r && r.folders) || []);
    // activeId is legacy (the old 🔖 target) — ignore it; the old active folder
    // just stays as a normal folder.
  } catch {
    store.setAll([]);
  }
  loaded = true;
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

export const byId = store.byId;
export const has = store.has;
// Nesting (#41). hasDeep is what the query engine asks (a parent stands for its
// subtree); plain `has` stays for the surfaces that mean this folder literally —
// the per-post 「フォルダに追加」 checkmarks, which answer "is it in THIS one".
export const hasDeep = store.hasDeep;
export const childrenOf = store.childrenOf;
export const pathOf = store.pathOf;
export const subtreeIds = store.subtreeIds;
export function placeFolder(id: string | null | undefined, targetId: string | null, mode: 'into' | 'before' | 'after') {
  const ok = store.place(id, targetId, mode);
  if (ok) notify('list');
  return ok;
}
export function reparentFolder(id: string | null | undefined, parentId: string | null) {
  const ok = store.reparent(id, parentId);
  if (ok) notify('list');
  return ok;
}

// Drop captureIds no longer present (deleted items), persisting + notifying once.
export function reconcile(existing: Set<string>) {
  const changed = store.reconcile(existing);
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
export function openManager(opts?: { store?: HologramFolderStore; onChange?: () => void } | null) {
  mgrStore = (opts && opts.store) || store;
  mgrAfter = (opts && opts.onChange) || (() => notify('list'));
  mgrModel = { openId: ++mgrSeq, list: managerList() };
  notifyMgr();
}
export function closeManager() {
  mgrModel = null;
  mgrStore = store;
  mgrAfter = () => notify('list');
  notifyMgr();
}
// The manager edits folders, not saved searches: it creates them, renames them and
// drag-reorders them among each other, none of which a saved search participates in
// (its own rename/delete live on the sidebar row). The filter is a no-op for the
// poster store, whose folders carry no kind.
function managerList() {
  return mgrStore.all().filter((f) => !isSavedSearch(f));
}
function refreshManager() {
  if (!mgrModel) return;
  mgrModel = { ...mgrModel, list: managerList() };
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

// --- static (a named set of posts) vs dynamic (a saved search) ---
// The one place that decides which is which; every surface that has to tell them
// apart goes through this or the two lists below.
export const isSavedSearch = (f: HologramFolder) => f.kind === 'dynamic';
// Only static folders can hold posts, so every surface that offers a folder as a
// DESTINATION reads staticFolders(): the sidebar flyout rows (facets.ts), the
// per-post 「フォルダに追加」 menu (post-grid-builder.ts) and the folder manager.
// Auditing those three is enough — they are the only callers that enumerate the
// store to pick a target.
export function staticFolders() {
  return store.allRaw().filter((f) => !isSavedSearch(f));
}
// Saved searches — the sidebar's own 保存した検索 group (never mixed in with folders).
export function dynamicFolders() {
  return store.allRaw().filter(isSavedSearch);
}

// Folder view (第3モード): expose the store's CRUD so the grid can list every
// folder and create/rename/delete from cards. Thin wrappers persist + notify so
// all views refresh (store.create/remove/rename persist).
export function allFolders() {
  return store.allRaw();
}
export function createFolder(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string; parentId?: string | null } | null) {
  const f = store.create(name, opts);
  if (f) notify('list');
  return f;
}
export function updateFolder(id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined) {
  const ok = store.update ? store.update(id, patch) : false; // update exists only on the folders store (isLibrary)
  if (ok) notify('list');
  return ok;
}
export function renameFolder(id: string | null | undefined, name: string | null | undefined) {
  const ok = store.rename(id, name);
  if (ok) notify('list');
  return ok;
}
// Returns every id that went away (the folder plus its subtree) so the caller can
// sweep the live query tree and the saved tabs with the same set the store used on
// the saved searches. Three places hold folder leaves; a set that reaches two of
// them leaves the third pointing at nothing.
export function removeFolder(id: string | null | undefined) {
  const gone = store.remove(id);
  notify('list');
  return gone;
}
export function onChange(cb: (kind?: string) => void) {
  subs.push(cb);
}
export function isLoaded() {
  return loaded;
}
