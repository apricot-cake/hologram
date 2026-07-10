// Window-global contracts for the renderer service layer (query/records/facets/
// cooc/users/tab-state/viewer + store, all .ts, strict-checked — see
// [[corpus-esm-under-file-protocol]]/backlog memory for the TS-stage history).
// This is a GLOBAL script d.ts (no import/export) so the interfaces merge into
// Window for every file that includes it. As of 2026-07-09 this project is
// merged into app/tsconfig.json — the same single strict TS program as the
// islands (formerly a separate, looser tsconfig.renderer.json).
//
// Typing altitude: function surfaces are typed; domain payloads (sidecar post
// records, aggregate rows) stay open objects (`CorpusPost` = index signature)
// until the JSON layer itself is typed — same pragmatics as the islands'
// globals.d.ts.

// Third-party global loaded via <script> in index.html (app/vendor/jszip.min.js);
// viewer.js references it as a bare global for library import/export.
declare const JSZip: any;

// The dual-export services (records/tags/users/tab-state/undo/…) also expose their api
// via CommonJS — `if (typeof module !== 'undefined' && module.exports) module.exports =
// api` — so the pure-unit tests can require() them. The reference is runtime-guarded;
// declare the ambient so strict .ts (no @types/node in this project) accepts it. Undefined
// in the browser bundle, where only the window.* assignment runs.
declare const module: any;

// ---- Sidecar post record (open shape — fields land from capture JSON) ----
type CorpusPost = { [k: string]: any };

// ---- renderer/query.js — condition-tree machinery + post-side predicates ----
// The tree is ALWAYS a root group (op 'and' by default); leaves are
// {kind:'cond', type, value, …}; groups carry children and an optional neg.
interface CorpusQueryLeaf {
  kind: 'cond';
  type: string;
  [k: string]: any;
}
interface CorpusQueryGroup {
  kind: 'group';
  op: 'and' | 'or';
  neg: boolean;
  children: CorpusQueryNode[];
}
type CorpusQueryNode = CorpusQueryLeaf | CorpusQueryGroup;

// Facet domain (改訂④ ファセット・チップ): the UI builds only facet-CNF trees.
// opts = the view-owned type schema (multi-value vs standalone types).
interface CorpusFacetOpts {
  multiValueTypes?: string[];
  standaloneTypes?: string[];
}
interface CorpusFacetCluster {
  type: string;
  op: 'and' | 'or';
  leaves: CorpusQueryLeaf[];
  grouped: boolean;
}
interface CorpusFacetView {
  clusters: CorpusFacetCluster[];
  singles: CorpusQueryLeaf[];
  excl: CorpusQueryLeaf[];
}

// query.ts's own API surface (emptyTree/evalNode/makePostPredOf/etc.) is a real
// ES module now — its named exports carry their own types, so no ambient
// Window-shaped interface is declared for it here anymore (see backlog memory
// 「window.corpusXxx → export/import」).

// ---- renderer/records.ts — record shape helpers + grouping. A real ES module
// (named exports) now; only the CorpusPostGroup data shape stays here (shared
// with viewer.ts / selection.ts / image-tab.ts). ----
interface CorpusPostGroup {
  key: string;
  records: CorpusPost[];
  rep: CorpusPost;
  files: string[];
  [k: string]: any;
}

// ---- renderer/selection.ts — the post-grid multi-select Set + shift-range
// anchor (P4-B スライス⑬). corpusStore's 'selectedSet' key IS the state (no
// closure copy); the anchor is a private module variable (no subscribers). A
// real ES module (named exports) now — no ambient Window-shaped interface
// needed (see backlog memory 「window.corpusXxx → export/import」). ----

// ---- renderer/bulk-edit.ts — the bulk "add tags to selection" staging list
// (records/tags/additive-flag) held while #editOverlay is open (P4-B スライス⑭).
// A real ES module (named exports) now — no ambient Window-shaped interface needed.

// ---- renderer/facets.ts — facet counts + value-flyout row models. makeFacets
// (facets.ts) and makeCooc (cooc.ts) are real ES modules (named exports) now; only
// CorpusQfRow stays here as a cross-module value-flyout row shape. ----
interface CorpusQfRow {
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
// CorpusUserAgg stays (a data shape shared with listing.ts/sidebar.ts). ----
interface CorpusUserAgg {
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
// ES module (named exports) now; only the CorpusTabSnapshot / CorpusTab data shapes
// stay here (shared with viewer.ts / tabs.ts / image-tab.ts). ----
interface CorpusTabSnapshot {
  f?: Array<{ type: string; [k: string]: any }>;
  search?: string;
  multi?: boolean;
  [k: string]: any;
}
interface CorpusTab {
  id: string;
  pinned: boolean;
  title: string | null;
  state: CorpusTabSnapshot | null;
  type?: 'image';
  img?: { recs: string[]; idx: number };
  _scrollTop?: number;
  [k: string]: any;
}

// ---- renderer/listing.js — the "what is visible, in what order" pipeline for
// all three browse modes (post filter+sort / poster filter+sort / collection
// derivations incl. the per-render-pass record cache) ----
interface CorpusCollection {
  id: string;
  name?: string;
  kind?: 'dynamic';
  items?: string[];
  tree?: CorpusQueryGroup | null;
  q?: string;
  created?: number;
  [k: string]: any;
}
// listing.ts's own API surface (makeListing/cloneTree/namedPosters/etc.) is a
// real ES module now — its named exports (including the exported ListingDeps
// interface) carry their own types, so no ambient Window-shaped interface is
// declared for it here anymore (see backlog memory 「window.corpusXxx →
// export/import」).

// ---- renderer/geometry.ts — pure column / slider-track / thumbnail math. A
// real ES module (named exports) now — no ambient Window-shaped interface
// needed, but CorpusGridMetrics stays (a data shape shared with viewer.ts). ----
// Metrics: W = floored fractional container width, g = gutter px.
interface CorpusGridMetrics {
  W: number;
  g: number;
}

// ---- renderer/format.ts — pure count/date display formatters. A real ES
// module (named exports) now — no ambient Window-shaped interface needed. ----

// ---- renderer/undo.ts — linear tag-edit undo/redo stack. A real ES module
// (named exports) now — no ambient Window-shaped interface needed, but
// CorpusUndoRecord stays (a data shape shared with viewer.ts). ----
interface CorpusUndoRecord {
  captureId?: string;
  image?: string;
  key?: string;
  prevTags: string[];
  newTags: string[];
}

// ---- renderer/search-editing.ts — search box ↔ query-tree text-leaf state
// machine + suggestion-pick handling (P4-B slice⑨). A real ES module (named
// exports) now — SearchEditingDeps is exported directly from search-editing.ts,
// no ambient Window-shaped interface needed.

// ---- renderer/folders.ts — library collections store + management modal +
// library-wide clip set. A real ES module (named exports) now — no ambient
// CorpusFoldersApi/Window-shaped interface needed. The raw createFolderStore factory is
// shared internally by the library collections store (isCollections) and, via
// createPersistedFolderStore's persist/load wiring, the corpusPosterFolderStore()
// factory (used by viewer.js pfStore, no isCollections). A folder always has an
// id/name/items; collections additionally carry kind/created and a dynamic
// saved-search (tree+q). ----
interface CorpusFolder {
  id: string;
  name: string;
  items: string[];
  kind?: 'static' | 'dynamic';
  created?: number | null;
  tree?: CorpusQueryGroup | null;
  q?: string;
  [k: string]: any;
}
interface CorpusFolderStore {
  all(): CorpusFolder[];
  allRaw(): CorpusFolder[];
  setAll(list: unknown): void;
  byId(id: string | null | undefined): CorpusFolder | null;
  has(id: string | null | undefined, key: string): boolean;
  create(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string } | null): CorpusFolder | null;
  remove(id: string | null | undefined): void;
  rename(id: string | null | undefined, name: string | null | undefined): boolean;
  /** Toggle one key or a whole group in the folder; anchorKey decides the resulting state. Returns the action or null. */
  toggleIn(id: string | null | undefined, keys: string | string[] | null | undefined, anchorKey?: string | null): 'added' | 'removed' | null;
  /** Drops keys no longer present (deleted items); true when anything changed. */
  reconcile(existing: Set<string>): boolean;
  /** Drag-reorder: place draggedId before/after targetId; true when the order changed. */
  move(draggedId: string | null | undefined, targetId: string | null | undefined, before: boolean): boolean;
  /** Present only on the collections store (isCollections): re-save a dynamic collection's search. */
  update?(id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined): boolean;
}
/** A ready-to-use folder store backed by a get/set IPC pair (persist()/load() built in). */
type CorpusPersistedFolderStore = CorpusFolderStore & { load(): Promise<void> };

// renderer/bridge.ts's makeCallbackBridge factory (shared by the callback-carrying
// popover bridges qf-pop / filter-popover) is a real ES module (named export) now —
// its return type is inferred, so no ambient CorpusCallbackBridge/CorpusMakeBridge type.

// renderer/store.ts is a real ES module now (Wave12) — get/set/subscribe are
// imported directly by every consumer; no ambient CorpusStore/Window merge
// exists anywhere anymore. The old duplicated `interface Window { corpusSelection }`
// (once the only Window-merge in this file) is gone too — selection.ts is a real
// ES module now.
