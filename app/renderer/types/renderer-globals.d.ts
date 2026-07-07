// Window-global contracts for the build-less plain-JS renderer service layer —
// TypeScript stage 2 (BACKLOG 採用#1「残り②」): the extracted viewer.js service
// modules (query/records/facets/cooc/users/tab-state + store) get their
// cross-module contracts visible to tsc via checkJs (tsconfig.renderer.json)
// WITHOUT a build step; they convert to .ts when 単一バンドル化 puts them under
// Vite. This is a GLOBAL script d.ts (no import/export) so the interfaces merge
// into Window for every file of that project.
//
// Typing altitude: function surfaces are typed; domain payloads (sidecar post
// records, aggregate rows) stay open objects (`CorpusPost` = index signature)
// until the JSON layer itself is typed — same pragmatics as the islands'
// globals.d.ts. viewer.js is NOT checked yet; these contracts serve the service
// modules' own bodies and the future viewer/main adoption.

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

interface CorpusQueryApi {
  emptyTree(): CorpusQueryGroup;
  treeLeaves(n: CorpusQueryNode | null | undefined, out?: CorpusQueryLeaf[]): CorpusQueryLeaf[];
  opposite(op: string): 'and' | 'or';
  /** Migrates a flat filter list (+ per-type ops) into a condition tree. */
  facetTreeFrom(f: ReadonlyArray<{ type: string; [k: string]: any }>, ops?: Record<string, string> | null): CorpusQueryGroup;
  evalNode(n: CorpusQueryNode, item: unknown, predOf: (f: CorpusQueryLeaf) => (item: any) => boolean): boolean;
  // Tree mutation domain (9th slice) — pure surgery; viewer binds these to its
  // per-builder tree. All mutate in place except wrapAllInGroup (new root).
  /** child → parent map, rebuilt for one surgery pass. */
  treeParentMap(tree: CorpusQueryGroup): Map<CorpusQueryNode, CorpusQueryGroup>;
  nodeContains(a: CorpusQueryNode | null | undefined, b: CorpusQueryNode | null | undefined): boolean;
  detachNode(node: CorpusQueryNode, pmap: Map<CorpusQueryNode, CorpusQueryGroup>): void;
  /** Drops empty groups; collapses single-member non-root groups (neg folds into the survivor). */
  cleanupTree(tree: CorpusQueryGroup): void;
  hasLeafValue(tree: CorpusQueryGroup, type: string, value: unknown): boolean;
  /** Removes matching cond leaves anywhere in the tree (+cleanup); true when something was removed. */
  removeCondsMatching(tree: CorpusQueryGroup, pred: (c: CorpusQueryLeaf) => boolean): boolean;
  /** Shadow identity: date matches by type alone, engagement by engType, others by value. */
  sameLeaf(c: CorpusQueryLeaf, f: { type: string; [k: string]: any }): boolean;
  /** Flat deduped leaf shadow (sidebar highlight / row badges / tab title). */
  buildShadow(tree: CorpusQueryGroup): Array<{ type: string; [k: string]: any }>;
  /** Applies a drag-drop; false = rejected (drop onto itself / own descendant). */
  dropNode(tree: CorpusQueryGroup, drag: CorpusQueryNode | null | undefined, target: CorpusQueryNode | null | undefined, mode: 'pair' | 'inside' | 'root'): boolean;
  /** Wraps the whole expression in one group; returns the NEW root, or null when empty. */
  wrapAllInGroup(tree: CorpusQueryGroup): CorpusQueryGroup | null;
  // Facet domain (改訂④) — strict analysis + canonical mutations.
  /** Default within-cluster operator: multi-value types 'and', others 'or'. */
  facetDefaultOp(type: string, opts: CorpusFacetOpts): 'and' | 'or';
  /** Strict facet analysis; null = not facet-shaped (renders as a read-only summary). */
  facetViewOf(tree: CorpusQueryGroup, opts: CorpusFacetOpts): CorpusFacetView | null;
  /** Rebuilds a facet-shaped tree into canonical form in place; false = not facet-shaped. */
  canonicalizeFacet(tree: CorpusQueryGroup, opts: CorpusFacetOpts): boolean;
  /** Inserts a positive leaf into its type cluster (group-join / pair-up / top level). */
  facetAdd(tree: CorpusQueryGroup, node: CorpusQueryLeaf, opts: CorpusFacetOpts): CorpusQueryLeaf;
  /** Sets a cluster's operator (the すべて/どれか toggle); false when no such group. */
  facetSetOp(tree: CorpusQueryGroup, type: string, op: string): boolean;
  /** Moves a leaf between its cluster and the 除く cluster; false when neg is unchanged. */
  facetSetNeg(tree: CorpusQueryGroup, node: CorpusQueryLeaf, neg: boolean, opts: CorpusFacetOpts): boolean;
  /** LOCAL-day range: from = local midnight, to = NEXT local midnight (exclusive). */
  localDayRange(from?: string | null, to?: string | null): { from: Date | null; to: Date | null };
  hostOf(url: string | null | undefined): string;
  /** Stable per-author key: platform user id, falling back to the handle. */
  userKey(p: CorpusPost): string;
  textHaystackOf(p: CorpusPost): string[];
  /** Post-side leaf-predicate factory; runtime couplings injected by viewer.js. */
  makePostPredOf(deps: { isInCollection(id: string, captureId: string): boolean; isClipped(captureId: string): boolean; fuzzyCompile?(q: string): ((hay: string) => boolean) | null; postKeyOf?(url: string | null | undefined): string | null }): (f: CorpusQueryLeaf) => (p: CorpusPost) => boolean;
  /** Poster-side leaf-predicate factory (mirror of makePostPredOf); poster-only couplings injected by viewer.js. */
  makePosterPredOf(deps: { posterTagsOf(key: string): string[]; folderById(id: string): { items: string[] } | null | undefined }): (f: CorpusQueryLeaf) => (u: CorpusUserAgg) => boolean;
}

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
  /** Grouping factory; manualGroups/ungrouped are getters (viewer reassigns them; ungrouped is a Set of opted-out post keys). */
  makeGroupRecords(deps: { manualGroups(): string[][]; ungrouped(): Set<string> }): (list: CorpusPost[]) => CorpusPostGroup[];
  /** Lightbox gallery-item factory; fileSrc keeps the psimg URL scheme viewer-owned. */
  makeGallery(deps: { fileSrc(file: string): string }): {
    buildGalleryItems(p: CorpusPost): { src: string; alt: string; video: boolean }[];
    buildGroupGalleryItems(g: CorpusPostGroup): { src: string; alt: string; video: boolean }[];
  };
  /** Per-card view-model factory (the model PostCard.tsx renders as the grid's modelOf).
      Runtime couplings are injected: currentView/imgAspect are getters (viewer reassigns
      the lets), selectedSet is a live ref, isClipped/fileSrc keep folder + psimg viewer-owned.
      Returns the PostCardModel shape (see PostCard.tsx); typed loosely here to avoid a
      parallel interface — the island re-validates on consumption. */
  makeCardModel(deps: {
    MSG: any;
    PF_NAME: Record<string, string>;
    formatCount(n: number): string;
    formatDate(d: string): string;
    compactDate(d: string): string;
    fileSrc(file: string, w?: number): string;
    selectedSet: Set<string>;
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
    facetCounts(keyFn: (p: CorpusPost) => string | string[] | null | undefined, pool?: CorpusPost[]): Map<string, number>;
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

// ---- renderer/tags.js — tag vocabulary / 種別 (kind) domain (read-side only;
// mutations stay in viewer.js, so every store dep is a getter) ----
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
}

// ---- renderer/users.js — poster roll-up + search-box suggestions ----
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
interface CorpusUsersApi {
  makeUsers(deps: { allPosts(): CorpusPost[]; generation(): number; userKey(p: CorpusPost): string; hostOf(url: string | null | undefined): string; corpusSearch(): { isFuzzy(): boolean; compile(q: string): (hay: string) => boolean } | undefined }): {
    /** Cached behind the library generation; same array identity until the generation bumps. */
    buildUsers(): CorpusUserAgg[];
    buildSuggest(q: string): Array<{ kind: 'tag' | 'user'; value: string; label: string; note: number }>;
  };
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
interface CorpusListingApi {
  makeListing(deps: {
    allPosts(): CorpusPost[];
    postsById(): Map<string, CorpusPost>;
    mediaFilesOf(p: CorpusPost): string[];
    densityImage(p: CorpusPost, density: string): string;
    percentileFn(list: CorpusPost[]): (p: CorpusPost) => number;
    evalNode(n: CorpusQueryNode, item: unknown, predOf: (f: CorpusQueryLeaf) => (item: any) => boolean): boolean;
    treeLeaves(n: CorpusQueryNode | null | undefined, out?: CorpusQueryLeaf[]): CorpusQueryLeaf[];
    postPredOf(f: CorpusQueryLeaf): (p: CorpusPost) => boolean;
    currentTree(): CorpusQueryGroup;
    stickyRecs: Set<string>;
    sortValue(): string;
    searchQuery(): string;
    buildUsers(): CorpusUserAgg[];
    posterQBEval(u: CorpusUserAgg): boolean;
    posterQBTree(): CorpusQueryGroup;
    posterSort(): string;
    collectionSort(): string;
    allCollections(): CorpusCollection[];
    filterLabel(f: { type: string; [k: string]: any }): string;
  }): {
    getFilteredPosts(): CorpusPost[];
    namedPosters(): CorpusUserAgg[];
    filteredPosters(): CorpusUserAgg[];
    /** Folds a legacy free-text q into the tree as a confirmed 'text' leaf. */
    treeWithLegacyQ(tree: CorpusQueryGroup | null | undefined, q: string | null | undefined): CorpusQueryGroup | null;
    dynamicMatches(coll: CorpusCollection): CorpusPost[];
    /** Arms the per-render-pass record memo (renderCollections calls this first). */
    resetCollectionCache(): void;
    collectionRecords(coll: CorpusCollection): CorpusPost[];
    collectionThumbsFrom(recs: CorpusPost[]): string[];
    collectionItemCount(coll: CorpusCollection): number;
    collCondLabels(coll: CorpusCollection): string[];
    filteredCollections(): CorpusCollection[];
  };
  /** Deep-clone a query tree for persistence, dropping transient _memo fields. */
  cloneTree(tree: CorpusQueryNode): any;
}

// ---- renderer/geometry.js — pure column / slider-track / thumbnail math ----
// Metrics: W = floored fractional container width, g = gutter px.
interface CorpusGridMetrics {
  W: number;
  g: number;
}
interface CorpusGeometryApi {
  colsFor(size: number, m: CorpusGridMetrics): number;
  sizeFor(n: number, m: CorpusGridMetrics): number;
  minColsFor(max: number, m: CorpusGridMetrics): number;
  /** Column-count slider track, inverted (right = larger = fewer columns). */
  sliderTrack(st: { min: number; max: number; size: number }, m: CorpusGridMetrics, opts?: { minCols?: number }): { nBig: number; nSmall: number; single: boolean; value: number };
  /** Un-invert a track value back to its target column count (self-inverse). */
  trackCols(value: number, nBig: number, nSmall: number): number;
  /** 60px-bucketed thumbnail width, clamped to [min, max]. */
  thumbW(raw: number, min: number, max: number): number;
}

// ---- renderer/format.js — pure count/date display formatters ----
interface CorpusFormatApi {
  /** Engagement count abbreviation (1.2K / 3.4M); null/undefined → ''. */
  formatCount(n: number | null | undefined): string;
  /** Numeric short date for filter chips (M/D this year, else Y/M/D). */
  formatShortDate(dateStr: string): string;
  /** Compact month-name card date ("Jun 13" / "6月13日"); invalid → ''. */
  compactDate(ds: string | number | Date): string;
  /** Full date + time for the card hover tooltip; invalid → ''. */
  formatDate(isoStr: string | number | Date): string;
  /** Absolute zero-padded Y/M/D HH:MM for the backup tooltip. */
  fmtTime(iso: string | number | Date): string;
  /** Relative backup time; today/yesterday words injected via labels. */
  fmtBackupTime(iso: string | number | Date, labels: { today: string; yesterday: string }): string;
  /** Platform-default locale date; falsy → '' (inspector join date). */
  localeDate(x: string | number | Date | null | undefined): string;
  /** Platform-default locale date+time; falsy → '' (posted/saved/updated). */
  localeDateTime(x: string | number | Date | null | undefined): string;
}

// ---- renderer/undo.js — linear tag-edit undo/redo stack ----
interface CorpusUndoRecord {
  captureId?: string;
  image?: string;
  key?: string;
  prevTags: string[];
  newTags: string[];
}
interface CorpusUndoApi {
  makeUndo(deps: {
    applyTags(records: { captureId?: string; image?: string; tags: string[] }[]): Promise<void> | void;
    applyPosterTags(records: { key?: string; tags: string[] }[]): Promise<void> | void;
  }): {
    push(type: string, records: CorpusUndoRecord[]): void;
    /** Both resolve to whether an entry was applied (callers toast only then). */
    undo(): Promise<boolean>;
    redo(): Promise<boolean>;
  };
}

// ---- renderer/folders.js — library collections store + management modal +
// library-wide clip set. The factory (window.corpusFolderStore) is shared by the
// library collections store (isCollections) and the poster folder store
// (viewer.js pfStore, no isCollections). A folder always has an id/name/items;
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
type CorpusFolderStoreFactory = (opts: { idPrefix: string; persist: () => void; isCollections?: boolean }) => CorpusFolderStore;
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

// renderer/store.js's window.corpusStore contract (CorpusStore) now comes from
// islands/types/globals.d.ts, which this tsc project shares directly (it is in
// tsconfig.renderer.json "files") — the old duplicated CorpusStoreApi is gone.

interface Window {
  corpusQuery: CorpusQueryApi;
  corpusRecords: CorpusRecordsApi;
  corpusFacets: CorpusFacetsApi;
  corpusCooc: CorpusCoocApi;
  corpusTags: CorpusTagsApi;
  corpusUsers: CorpusUsersApi;
  corpusTabState: CorpusTabStateApi;
  corpusListing: CorpusListingApi;
  corpusGeometry: CorpusGeometryApi;
  corpusFormat: CorpusFormatApi;
  corpusUndo: CorpusUndoApi;
  corpusFolderStore: CorpusFolderStoreFactory;
  corpusFolders: CorpusFoldersApi;
  corpusMakeBridge: CorpusMakeBridge;
}
