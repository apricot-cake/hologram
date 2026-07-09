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

// ---- renderer/records.js — record shape helpers + grouping (dual-exported
// to main via CommonJS for the shared postKeyOf) ----
interface CorpusPostGroup {
  key: string;
  records: CorpusPost[];
  rep: CorpusPost;
  files: string[];
  [k: string]: any;
}
interface CorpusRecordsApi {
  mediaFilesOf(p: CorpusPost): string[];
  isScreenshot(p: CorpusPost): boolean;
  captureFile(p: CorpusPost): string;
  artworkFile(p: CorpusPost): string;
  densityImage(p: CorpusPost, density: string): string;
  postIdKey(p: CorpusPost): string;
  /** Normalized url-derived group key (x.com⇄twitter.com folded); null for no-url records. */
  postKeyOf(url: string | null | undefined): string | null;
  groupFilesOf(p: CorpusPost): string[];
  /** Image-tab record resolution: resolve the tab's persisted captureIds against the live
      library via the injected byId lookup; null when none resolve (→ the missing state). */
  imageTabGroup(t: CorpusTab, byId: (id: string) => CorpusPost | undefined): CorpusPostGroup | null;
  /** Image-tab title from the group's rep (≤24 chars), else the injected 無題 fallback string. */
  imageTabTitleOf(g: CorpusPostGroup, fallback: string): string;
  /** Grouping factory; manualGroups/ungrouped are getters (viewer reassigns them; ungrouped is a Set of opted-out post keys). */
  makeGroupRecords(deps: { manualGroups(): string[][]; ungrouped(): Set<string> }): (list: CorpusPost[]) => CorpusPostGroup[];
  /** Lightbox gallery-item factory; fileSrc keeps the psimg URL scheme viewer-owned. */
  makeGallery(deps: { fileSrc(file: string): string }): {
    buildGalleryItems(p: CorpusPost): { src: string; alt: string; video: boolean }[];
    buildGroupGalleryItems(g: CorpusPostGroup): { src: string; alt: string; video: boolean }[];
  };
  /** Per-card view-model factory (the model PostCard.tsx renders as the grid's modelOf).
      Runtime couplings are injected: currentView/imgAspect are getters (viewer reassigns
      the lets), isClipped/fileSrc keep folder + psimg viewer-owned. Selection is NOT
      injected here — the grid island derives .selected from corpusStore's 'selectedSet'.
      Returns the PostCardModel shape (see PostCard.tsx); typed loosely here to avoid a
      parallel interface — the island re-validates on consumption. */
  makeCardModel(deps: {
    MSG: any;
    PF_NAME: Record<string, string>;
    formatCount(n: number): string;
    formatDate(d: string): string;
    compactDate(d: string): string;
    fileSrc(file: string, w?: number): string;
    isClipped(captureId: string): boolean;
    smokeCapture: boolean;
    currentView(): string;
    imgAspect(): Record<string, string>;
    tileThumbW(): number;
    cardThumbW(): number;
    listThumbW(): number;
  }): (g: CorpusPostGroup, i: number) => Record<string, any>;
  /** Per-platform likes percentile (0..1) over the given population. */
  percentileFn(list: CorpusPost[]): (p: CorpusPost) => number;
  /** Pre-computes _dateMs/_capturedMs/_postKey/_quotedKey on arrival. */
  stampPost(p: CorpusPost): CorpusPost;
  /** manual-groups.json load; [] on failure. */
  loadManualGroups(): Promise<string[][]>;
  persistManualGroups(groups: string[][]): Promise<void>;
  /** ungrouped.json load; empty Set on failure. */
  loadUngrouped(): Promise<Set<string>>;
  persistUngrouped(keys: Set<string> | string[]): Promise<void>;
}

// ---- renderer/selection.ts — the post-grid multi-select Set + shift-range
// anchor (P4-B スライス⑬). corpusStore's 'selectedSet' key IS the state (no
// closure copy); the anchor is a private module variable (no subscribers). ----
interface CorpusSelectionApi {
  has(key: string): boolean;
  size(): number;
  anchorIndex(): number | null;
  toggle(idx: number, key: string, shiftKey: boolean, groups: CorpusPostGroup[], postIdKey: (p: CorpusPost) => string): void;
  clear(): void;
  /** Unconditional select-all (Ctrl/Cmd+A): every group in, regardless of the current selection. */
  selectAll(groups: CorpusPostGroup[], postIdKey: (p: CorpusPost) => string): void;
  /** 全選択/全解除 button: flips between everything selected and nothing selected. */
  toggleAll(groups: CorpusPostGroup[], postIdKey: (p: CorpusPost) => string): void;
  isAllSelected(groups: CorpusPostGroup[], postIdKey: (p: CorpusPost) => string): boolean;
  selectedGroups(groups: CorpusPostGroup[], postIdKey: (p: CorpusPost) => string): CorpusPostGroup[];
  selectedRecords(groups: CorpusPostGroup[], postIdKey: (p: CorpusPost) => string): CorpusPost[];
}

// ---- renderer/bulk-edit.ts — the bulk "add tags to selection" staging list
// (records/tags/additive-flag) held while #editOverlay is open (P4-B スライス⑭). ----
interface CorpusBulkEditApi {
  open(records: CorpusPost[]): void;
  close(): void;
  getRecords(): CorpusPost[];
  getTags(): string[];
  isAdditive(): boolean;
  add(tag: string): void;
  remove(tag: string): void;
  toggle(tag: string): void;
}

// ---- renderer/facets.js — facet counts + value-flyout row models ----
interface CorpusQfRow {
  v?: string;
  l?: string;
  on?: boolean;
  count?: number;
  [k: string]: any;
}
interface CorpusFacetsApi {
  /** Everything comes in as functions: reassigned viewer lets are getters, later consts are deferred arrows (TDZ). */
  makeFacets(deps: { [k: string]: any }): {
    // Population is usually a post pool, but the poster-scoped rows (poster-tag /
    // poster-work / poster-character / poster-platform / poster-instance /
    // poster-folder) pass filteredPosters() and key off a CorpusUserAgg instead.
    facetCounts(keyFn: (p: CorpusPost) => string | string[] | null | undefined): Map<string, number>;
    facetCounts<T extends CorpusUserAgg>(keyFn: (p: T) => string | string[] | null | undefined, pool: T[]): Map<string, number>;
    qfValues(cat: string): CorpusQfRow[];
  };
  PF_ORDER: string[];
}

// ---- renderer/cooc.js — tag co-occurrence math ----
interface CorpusCoocApi {
  makeCooc(deps: { allPosts(): CorpusPost[]; tagKindOf(tag: string): string | null | undefined }): {
    /** [characterTag, sharedPostCount] pairs, most-frequent first. */
    charCandidatesFor(workTags: string[] | null | undefined): Array<[string, number]>;
    worksCooccurringWith(charTag: string, excludeIds?: Set<string> | null): Set<string>;
    /** Weak tier: {tag, withTag, count} rows, count-desc, capped. */
    relatedTagCandidates(selectedTags: ReadonlyArray<string> | null | undefined, opts?: { minCount?: number; limit?: number; exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }>;
  };
}

// ---- renderer/tags.js — tag vocabulary / 種別 (kind) domain (read-side
// derivations take every store as a getter dep; loadTagGroups/persistTagGroups/
// loadTagTypes/persistTagTypes/loadPosterTags/persistPosterTags own the disk
// round-trip for those same three stores) ----
interface CorpusTagPickerItem {
  tag: string;
  kind?: string | null;
  title?: string;
}
interface CorpusTagsApi {
  makeTags(deps: {
    tagTypes(): Record<string, string>;
    tagLabels(): Record<string, string>;
    tagGroups(): Array<{ id: string; name: string; tags?: string[] }>;
    posterTags(): Record<string, string[]>;
    allPosts(): CorpusPost[];
    MSG: { [k: string]: any };
    charCandidatesFor(workTags: string[]): Array<[string, number]>;
    relatedTagCandidates(selectedTags: string[], opts?: { exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }>;
  }): {
    tagKindOf(tag: string): string | null;
    kindLabel(kind: string): string;
    posterTagsOf(key: string): string[];
    /** Poster-applied tags, ordered 作品 → キャラ → 一般 then ja-collation. */
    posterFilterVocab(): string[];
    groupedTagVocab(query: string, opts?: { scope?: 'post' | 'poster' } | null): Array<{ name: string; tags: string[] }>;
    /** The React tag editor's data bundle: sectioned vocab + source hashtags + cooc suggestion tiers. */
    inspectorTagPickerData(selectedTags: string[] | null | undefined, recordsForSource: CorpusPost[] | null | undefined, scope?: string): { vocabGroups: Array<{ name: string; items: CorpusTagPickerItem[] }>; srcTagsForPicker: CorpusTagPickerItem[]; coocGroups: Array<{ name: string; items: CorpusTagPickerItem[] }> };
  };
  /** Set-equality on tag arrays (order-insensitive). */
  sameTags(a: string[], b: string[]): boolean;
  /** Loads tag-groups.json / tag-types.json / poster-tags.json into this service's own state (idempotent — safe to call once at boot). */
  load(): Promise<void>;
  getTagTypes(): Record<string, string>;
  getTagLabels(): Record<string, string>;
  getTagGroups(): Array<{ id: string; name: string; tags?: string[] }>;
  getPosterTags(): Record<string, string[]>;
  /** Set (or clear, kind=null) a tag's 種別; persists both maps and notifies subscribers. */
  setTagKind(tag: string, kind: string | null): Promise<void>;
  /** Rename (or reset, label falsy) a 種別's custom label; persists both maps and notifies subscribers. */
  setKindLabel(kind: string, label: string | null | undefined): Promise<void>;
  setTagGroups(groups: Array<{ id: string; name: string; tags?: string[] }>): Promise<void>;
  /** Set (or clear, tags=null) one poster's tag list; persists and notifies subscribers. */
  setPosterTags(key: string, tags: string[] | null): void;
  /** Bulk-apply poster tag records (undo/redo); persists once and notifies subscribers. */
  applyPosterTagRecords(records: Array<{ key: string; tags?: string[] }>): void;
  /** Subscribe to any mutator above; returns an unsubscribe function. */
  onChange(cb: (kind?: string) => void): () => void;
  // Bound once at boot (viewer.ts, right after its own makeTags() call) so
  // renderer/sidebar.ts (P4-B slice⑰, self-deriving from services) can read the
  // SAME tagKindOf/posterFilterVocab viewer uses — both close over this module's
  // own getTagTypes()/getPosterTags(), so there's no second implementation to
  // drift. Optional: undefined until viewer.ts's assignment runs (a pull that
  // fires before then just sees "no data yet", same as any other P4-B source).
  tagKindOf?(tag: string): string | null;
  posterFilterVocab?(): string[];
}

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
// ---- renderer/tab-state.js — tab titles + nav history + tabs.json shape ----
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
interface CorpusNavHistory {
  push(snap: CorpusTabSnapshot): void;
  /** true = actually navigated (caller persists on true). */
  back(): boolean;
  forward(): boolean;
  adopt(t: CorpusTab | null | undefined): void;
  saveInto(t: CorpusTab): void;
  canBack(): boolean;
  canForward(): boolean;
}
interface CorpusTabStateApi {
  genTabId(): string;
  makeTabLabels(deps: {
    MSG: { [k: string]: any };
    engTypeLabels: { [k: string]: string };
    platformName(v: string): string;
    formatShortDate(dateStr: string): string;
    formatCount(n: number | null | undefined): string;
    collectionName(id: string): string | null | undefined;
    posterFolderName(id: string): string | null | undefined;
  }): {
    filterLabel(f: { type: string; [k: string]: any }): string;
    tabTitleOf(state: CorpusTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string };
    posterFilterLabel(f: { type: string; [k: string]: any }): string;
  };
  makeNavHistory(deps: { cap: number; enabled(): boolean; snapshot(): CorpusTabSnapshot; apply(s: CorpusTabSnapshot): void; onChange(): void }): CorpusNavHistory;
  serializeTabs(tabs: CorpusTab[], activeTabId: string | null): { activeTabId: string | null; tabs: Array<{ [k: string]: any }> };
  sanitizeSavedTabs(saved: unknown, genId: () => string): { tabs: CorpusTab[]; activeTabId: string } | null;
  /** tabs.json load (raw shape — pass through sanitizeSavedTabs); null on failure. */
  loadTabs(): Promise<unknown>;
  /** Serializes + persists tabs.json. */
  persistTabs(tabs: CorpusTab[], activeTabId: string | null): Promise<void>;
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

// ---- renderer/search-editing.js — search box ↔ query-tree text-leaf state
// machine + suggestion-pick handling (P4-B slice⑨). Encapsulates which leaf (if
// any) is being typed; rendering/persistence side effects stay injected callbacks.
interface CorpusSearchEditingApi {
  makeSearchEditing(deps: {
    getTree(): CorpusQueryGroup;
    addFilter(leaf: { type: string; [k: string]: any }): CorpusQueryLeaf | null;
    removeNode(node: CorpusQueryLeaf): void;
    treeLeaves(tree: CorpusQueryGroup): CorpusQueryLeaf[];
    searchQuery(): string;
    setSearchBoxValue(v: string): void;
    isFuzzy(): boolean;
    isPostsMode(): boolean;
    afterQueryChange(): void;
    renderPosts(): void;
    updateSidebarState(): void;
  }): {
    isEditingLeaf(node: unknown): boolean;
    onLeafMutated(node: unknown): void;
    clear(): void;
    sync(): void;
    confirm(): void;
    rebind(): void;
    pick(it: { kind: string; value: string; label?: string } | null | undefined): void;
    onSearchModeChange(): void;
  };
}

// ---- renderer/folders.js — library collections store + management modal +
// library-wide clip set. The raw createFolderStore factory is shared internally by the
// library collections store (isCollections) and, via createPersistedFolderStore's
// persist/load wiring, the poster folder store (window.corpusPosterFolderStore, used by
// viewer.js pfStore, no isCollections). A folder always has an id/name/items;
// collections additionally carry kind/created and a dynamic saved-search (tree+q). ----
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
interface CorpusFoldersApi {
  load(): Promise<void>;
  all(): CorpusFolder[];
  byId(id: string | null | undefined): CorpusFolder | null;
  has(id: string | null | undefined, key: string): boolean;
  isClipped(cid: string): boolean;
  toggleClip(captureIds: string[] | null | undefined, anchorCid?: string | null): 'added' | 'removed' | null;
  clearClips(): number;
  clippedItems(): string[];
  clipCount(existing?: Set<string> | null): number;
  reconcile(existing: Set<string>): void;
  toggleIn(fid: string | null | undefined, captureIds: string[] | null | undefined, anchorCid?: string | null): 'added' | 'removed' | null;
  openManager(opts?: { store?: CorpusFolderStore; onChange?: () => void } | null): void;
  closeManager(): void;
  isManagerOpen(): boolean;
  allCollections(): CorpusFolder[];
  createCollection(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string } | null): CorpusFolder | null;
  updateCollection(id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined): boolean;
  renameCollection(id: string | null | undefined, name: string | null | undefined): boolean;
  removeCollection(id: string | null | undefined): void;
  toast(msg: unknown): void;
  onChange(cb: (kind?: string) => void): void;
  isLoaded(): boolean;
}

// ---- renderer/bridge.js — makeCallbackBridge factory shared by the callback-carrying
// popover bridges (qf-pop / filter-popover). Returns the open/close/get/subscribe api
// and, when given a name, assigns window[name] = api. ----
interface CorpusCallbackBridge {
  /** Replaces the model and stamps a fresh monotonic openId onto it. */
  open(model: { [k: string]: any }): void;
  close(): void;
  get(): { openId: number; [k: string]: any } | null;
  subscribe(cb: () => void): () => void;
}
type CorpusMakeBridge = (name?: string) => CorpusCallbackBridge;

// renderer/store.ts's window.corpusStore contract (CorpusStore) now comes from
// islands/types/globals.d.ts, which this same tsconfig.json project includes
// directly (via `islands/**/*`) — the old duplicated CorpusStoreApi is gone.

interface Window {
  corpusRecords: CorpusRecordsApi;
  corpusFacets: CorpusFacetsApi;
  corpusCooc: CorpusCoocApi;
  corpusTags: CorpusTagsApi;
  corpusTabState: CorpusTabStateApi;
  corpusSearchEditing: CorpusSearchEditingApi;
  corpusPosterFolderStore: () => CorpusPersistedFolderStore;
  corpusFolders: CorpusFoldersApi;
  corpusMakeBridge: CorpusMakeBridge;
  corpusSelection: CorpusSelectionApi;
  corpusBulkEdit: CorpusBulkEditApi;
}
