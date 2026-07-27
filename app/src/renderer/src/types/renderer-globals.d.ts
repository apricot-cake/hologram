// Window-global contracts for the renderer service layer (query/records/facets/
// cooc/users/tab-state/viewer + store, all .ts, strict-checked).
// This is a GLOBAL script d.ts (no import/export) so the interfaces merge into
// Window for every file that includes it. As of 2026-07-09 this project is
// merged into the single strict renderer TS program (app/tsconfig.web.json) —
// the same program that type-checks the React components (formerly a separate,
// looser tsconfig.renderer.json).
//
// Typing altitude: function surfaces are typed; domain payloads (sidecar post
// records, aggregate rows) stay open objects (`HologramPost` = index signature)
// until the JSON layer itself is typed — same pragmatics as this directory's
// other globals.d.ts.

// The dual-export services (records/tags/users/tab-state/undo/…) also expose their api
// via CommonJS — `if (typeof module !== 'undefined' && module.exports) module.exports =
// api` — so the pure-unit tests can require() them. The reference is runtime-guarded;
// declare the ambient so strict .ts (no @types/node in this project) accepts it. Undefined
// in the browser bundle, where only the window.* assignment runs.
declare const module: any;

// ---- Sidecar post record (open shape — fields land from capture JSON) ----
type HologramPost = { [k: string]: any };

// ---- renderer/query.js — condition-tree machinery + post-side predicates ----
// The tree is ALWAYS a root group (op 'and' by default); leaves are
// {kind:'cond', type, value, …}; groups carry children and an optional neg.
interface HologramQueryLeaf {
  kind: 'cond';
  type: string;
  [k: string]: any;
}
interface HologramQueryGroup {
  kind: 'group';
  op: 'and' | 'or';
  neg: boolean;
  children: HologramQueryNode[];
}
type HologramQueryNode = HologramQueryLeaf | HologramQueryGroup;

// Facet domain (改訂④ ファセット・チップ): the UI builds only facet-CNF trees.
// opts = the view-owned type schema (multi-value vs standalone types).
interface HologramFacetOpts {
  multiValueTypes?: string[];
  standaloneTypes?: string[];
}
interface HologramFacetCluster {
  type: string;
  op: 'and' | 'or';
  leaves: HologramQueryLeaf[];
  grouped: boolean;
}
interface HologramFacetView {
  clusters: HologramFacetCluster[];
  singles: HologramQueryLeaf[];
  excl: HologramQueryLeaf[];
}

// query.ts's own API surface (emptyTree/evalNode/makePostPredOf/etc.) is a real
// ES module now — its named exports carry their own types, so no ambient
// Window-shaped interface is declared for it here anymore.

// ---- renderer/records.ts — record shape helpers + grouping. A real ES module
// (named exports) now; only the HologramPostGroup data shape stays here (shared
// with viewer.ts / selection.ts / image-tab.ts). ----
interface HologramPostGroup {
  key: string;
  records: HologramPost[];
  rep: HologramPost;
  files: string[];
  [k: string]: any;
}

// ---- renderer/selection.ts — the post-grid multi-select Set + shift-range
// anchor. hologramStore's 'selectedSet' key IS the state (no
// closure copy); the anchor is a private module variable (no subscribers). A
// real ES module (named exports) now — no ambient Window-shaped interface
// needed. ----

// ---- renderer/facets.ts — facet counts + value-flyout row models. makeFacets
// (facets.ts) and makeCooc (cooc.ts) are real ES modules (named exports) now; only
// HologramQfRow stays here as a cross-module value-flyout row shape. ----
interface HologramQfRow {
  v?: string;
  l?: string;
  on?: boolean;
  count?: number;
  [k: string]: any;
}

// ---- renderer/tags.ts — tag vocabulary / 種別 (kind) domain. A real ES module
// (named exports) now; the read-side derivations + disk round-trip carry their own
// types, so no ambient Window-shaped interface is declared here anymore. ----

// ---- renderer/users.ts — poster roll-up + search-box suggestions. A real ES
// module (named exports) now — no ambient Window-shaped interface needed, but
// HologramUserAgg stays (a data shape shared with listing.ts/sidebar.ts). ----
interface HologramUserAgg {
  key: string;
  platform: string;
  screenName: string;
  displayName: string;
  avatarFile: string;
  followers: number | null;
  authorCreatedAt: string;
  instance: string;
  latest: string;
  firstPost: string;
  lastCapture: string;
  firstCapture: string;
  count: number;
}
// ---- renderer/tab-state.ts — tab titles + nav history + tabs.json shape. A real
// ES module (named exports) now; only the HologramTabSnapshot / HologramTab data shapes
// stay here (shared with viewer.ts / tabs.ts / image-tab.ts). ----
interface HologramTabSnapshot {
  f?: Array<{ type: string; [k: string]: any }>;
  search?: string;
  multi?: boolean;
  [k: string]: any;
}
// One per-tab history entry (#144): a tagged union over the three view kinds.
// `u` is a pseudo-URL — a display label + identity key (the global history page
// derives its rows from it); it is NEVER a restore contract (state is the truth,
// u is derived from it).
interface HologramNavEntry {
  u: string;
  kind: 'posts' | 'posters' | 'image';
  state: HologramTabSnapshot | { tree?: any; sort?: string; search?: string } | { recs: string[]; idx: number };
}
interface HologramTab {
  id: string;
  pinned: boolean;
  title: string | null;
  state: HologramTabSnapshot | null;
  _scrollTop?: number;
  // Per-tab back/forward stack (JSON-serialized HologramNavEntry each) — carried
  // on the tab object across switches AND persisted to tabs.json (#144 未決5).
  _navHist?: string[];
  _navIdx?: number;
  [k: string]: any;
}

// ---- renderer/listing.js — the "what is visible, in what order" pipeline for
// all three browse modes (post filter+sort / poster filter+sort / folder
// derivations incl. the per-render-pass record cache). The folder shape is
// HologramFolder (below); dynamic folders carry a saved-search (tree + q). ----
// listing.ts's own API surface (makeListing/cloneTree/namedPosters/etc.) is a
// real ES module now — its named exports (including the exported ListingDeps
// interface) carry their own types, so no ambient Window-shaped interface is
// declared for it here anymore.

// ---- renderer/geometry.ts — pure column / slider-track / thumbnail math. A
// real ES module (named exports) now — no ambient Window-shaped interface
// needed, but HologramGridMetrics stays (a data shape shared with viewer.ts). ----
// Metrics: W = floored fractional container width, g = gutter px.
interface HologramGridMetrics {
  W: number;
  g: number;
}

// ---- renderer/format.ts — pure count/date display formatters. A real ES
// module (named exports) now — no ambient Window-shaped interface needed. ----

// ---- renderer/undo.ts — linear tag-edit undo/redo stack. A real ES module
// (named exports) now — no ambient Window-shaped interface needed, but
// HologramUndoRecord stays (a data shape shared with viewer.ts). ----
interface HologramUndoRecord {
  captureId?: string;
  image?: string;
  key?: string;
  prevTags: string[];
  newTags: string[];
}

// ---- renderer/search-editing.ts — search box ↔ query-tree text-leaf state
// machine + suggestion-pick handling. A real ES module (named
// exports) now — SearchEditingDeps is exported directly from search-editing.ts,
// no ambient Window-shaped interface needed.

// ---- renderer/folders.ts — library folders store + management modal.
// A real ES module (named exports) now — no ambient
// HologramFoldersApi/Window-shaped interface needed. The raw createFolderStore factory is
// shared internally by the library folders store (isLibrary) and, via
// createPersistedFolderStore's persist/load wiring, the hologramPosterFolderStore()
// factory (used by viewer.js pfStore, no isLibrary). A folder always has an
// id/name/items; folders additionally carry kind/created and a dynamic
// saved-search (tree+q). ----
interface HologramFolder {
  id: string;
  name: string;
  items: string[];
  kind?: 'static' | 'dynamic';
  created?: number | null;
  /** Static folders only: the parent folder's id (#41). Absent/null = a root folder. */
  parentId?: string | null;
  /** Dynamic folders only: the saved search. The free-text term is a 'text' leaf inside it. */
  tree?: HologramQueryGroup | null;
  [k: string]: any;
}
interface HologramFolderStore {
  all(): HologramFolder[];
  allRaw(): HologramFolder[];
  setAll(list: unknown): void;
  byId(id: string | null | undefined): HologramFolder | null;
  has(id: string | null | undefined, key: string): boolean;
  create(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; parentId?: string | null } | null): HologramFolder | null;
  /** Deletes the folder and (library store) its whole subtree. Returns every id removed. */
  remove(id: string | null | undefined): Set<string>;
  /** Membership including descendants; `only` restricts it to the folder's own items (#41). */
  hasDeep(id: string | null | undefined, key: string, only?: boolean): boolean;
  /** Direct children, in sibling order (= array order). */
  childrenOf(id: string | null): HologramFolder[];
  /** "親 / 子 / 孫" — for surfaces that show a folder outside the tree, where a bare name no longer identifies it. */
  pathOf(id: string | null | undefined): string;
  /** The folder plus everything under it (empty when id is absent). */
  subtreeIds(id: string | null | undefined): Set<string>;
  /** Move a folder under a new parent (null = root). Refuses itself and its own subtree. */
  reparent(id: string | null | undefined, parentId: string | null): boolean;
  /** Tree drop in one write: into a folder (null = root), or beside one — adopting that row's parent. */
  place(draggedId: string | null | undefined, targetId: string | null, mode: 'into' | 'before' | 'after'): boolean;
  rename(id: string | null | undefined, name: string | null | undefined): boolean;
  /** Toggle one key or a whole group in the folder; anchorKey decides the resulting state. Returns the action or null. */
  toggleIn(id: string | null | undefined, keys: string | string[] | null | undefined, anchorKey?: string | null): 'added' | 'removed' | null;
  /** Drops keys no longer present (deleted items); true when anything changed. */
  reconcile(existing: Set<string>): boolean;
  /** Drag-reorder: place draggedId before/after targetId; true when the order changed. */
  move(draggedId: string | null | undefined, targetId: string | null | undefined, before: boolean): boolean;
  /** Present only on the folders store (isLibrary): re-save a dynamic folder's search. */
  update?(id: string | null | undefined, patch: { tree?: unknown } | null | undefined): boolean;
}
/** A ready-to-use folder store backed by a get/set IPC pair (persist()/load() built in). */
type HologramPersistedFolderStore = HologramFolderStore & { load(): Promise<void> };
/** folders.ts's management-modal state (FolderManagerModal.tsx via getManager()/subscribeManager()). openId bumps only on openManager() (a fresh modal session), not on list refreshes. */
interface HologramFolderManagerModel {
  openId: number;
  list: HologramFolder[];
}

// renderer/bridge.ts's makeCallbackBridge factory (shared by the callback-carrying
// popover bridges qf-pop / filter-popover) is a real ES module (named export) now —
// its return type is inferred, so no ambient HologramCallbackBridge/HologramMakeBridge type.

// renderer/store.ts is a real ES module now — get/set/subscribe are
// imported directly by every consumer; no ambient HologramStore/Window merge
// exists anywhere anymore. The old duplicated `interface Window { hologramSelection }`
// (once the only Window-merge in this file) is gone too — selection.ts is a real
// ES module now.
