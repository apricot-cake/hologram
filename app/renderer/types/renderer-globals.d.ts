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

interface CorpusQueryApi {
  emptyTree(): CorpusQueryGroup;
  treeLeaves(n: CorpusQueryNode | null | undefined, out?: CorpusQueryLeaf[]): CorpusQueryLeaf[];
  opposite(op: string): 'and' | 'or';
  /** Migrates a flat filter list (+ per-type ops) into a condition tree. */
  facetTreeFrom(f: ReadonlyArray<{ type: string; [k: string]: any }>, ops?: Record<string, string> | null): CorpusQueryGroup;
  evalNode(n: CorpusQueryNode, item: unknown, predOf: (f: CorpusQueryLeaf) => (item: any) => boolean): boolean;
  /** LOCAL-day range: from = local midnight, to = NEXT local midnight (exclusive). */
  localDayRange(from?: string | null, to?: string | null): { from: Date | null; to: Date | null };
  hostOf(url: string | null | undefined): string;
  /** Stable per-author key: platform user id, falling back to the handle. */
  userKey(p: CorpusPost): string;
  textHaystackOf(p: CorpusPost): string[];
  /** Post-side leaf-predicate factory; runtime couplings injected by viewer.js. */
  makePostPredOf(deps: { isInCollection(id: string, captureId: string): boolean; isClipped(captureId: string): boolean; fuzzyCompile?(q: string): (hay: string) => boolean; postKeyOf?(url: string | null | undefined): string | null }): (f: CorpusQueryLeaf) => (p: CorpusPost) => boolean;
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
  /** Grouping factory; manualGroups/ungrouped are getters (viewer reassigns the arrays). */
  makeGroupRecords(deps: { manualGroups(): string[][]; ungrouped(): string[] }): (list: CorpusPost[]) => CorpusPostGroup[];
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
  makeTabLabels(deps: { MSG: { [k: string]: any }; engTypeLabels: { [k: string]: string }; platformName(v: string): string; formatShortDate(dateStr: string): string; formatCount(n: number | null | undefined): string; collectionName(id: string): string | null | undefined }): {
    filterLabel(f: { type: string; [k: string]: any }): string;
    tabTitleOf(state: CorpusTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string };
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

// ---- renderer/store.js — key-addressed external store (same contract as the
// islands' globals.d.ts CorpusStore; duplicated across the two tsc projects
// until 単一バンドル化 merges them) ----
interface CorpusStoreApi {
  get(key: string): any;
  set(key: string, val: unknown): void;
  subscribe(key: string, cb: () => void): () => void;
  subscribe(cb: () => void): () => void;
}

interface Window {
  corpusQuery: CorpusQueryApi;
  corpusRecords: CorpusRecordsApi;
  corpusFacets: CorpusFacetsApi;
  corpusCooc: CorpusCoocApi;
  corpusUsers: CorpusUsersApi;
  corpusTabState: CorpusTabStateApi;
  corpusListing: CorpusListingApi;
  corpusStore: CorpusStoreApi;
}
