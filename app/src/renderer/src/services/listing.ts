// Listing pipeline service — "what is visible, in what order" for all three
// browse modes: getFilteredPosts (post grid = content gate → query tree →
// sticky merge → sort), namedPosters/filteredPosters (poster grid), and the
// folder derivations (dynamic saved-search matching, per-pass record cache,
// cover thumbs, counts, condition chips, filteredFolders). Extracted 1:1
// from viewer.js as the seventh "pure logic → service" slice of the viewer
// decomposition (最終形B). A real ES module (named exports), imported directly
// by viewer.ts / sidebar.ts. Touches no DOM. Runtime couplings are injected via
// makeListing(deps) — reassigned viewer lets come in as getters, consts
// declared after the wiring point as deferred arrows — so this file can be
// exercised standalone (scripts/test-listing-unit.cts loads it via a dynamic
// import()).

// deps contract (all functions unless noted):
//   allPosts() / postsById() — the library + its captureId map (getters — viewer reassigns both)
//   mediaFilesOf(p) / densityImage(p) / percentileFn(list) — from records.ts
//   evalNode(n, item, predOf) / treeLeaves(n) — from query.ts
//   postPredOf(f) — the post-side leaf-predicate (query.ts makePostPredOf product)
//   currentTree() — the active tab's boolean query tree (root group)
//   stickyRecs — Set of captureIds kept visible after a mutation un-matches the filter
//   sortValue() — the post sort select's current value
//   shuffleSeed() — the active tab's shuffle seed (only read by the 'random' sort)
//   searchQuery() — the search-box term (hologramStore-backed)
//   buildUsers() — poster roll-up (users.ts product)
//   posterQBEval(u) / posterQBTree() — the poster query builder (deferred — later const)
//   posterSort() / folderSort() — mode sort keys (getters — reassigned lets)
//   allFolders() — CF().allFolders() or [] before folders load
//   filterLabel(f) — leaf pill label (tab-state.ts makeTabLabels product)
import { shuffleRank } from './shuffle.ts';

export interface ListingDeps {
  allPosts(): HologramPost[];
  postsById(): Map<string, HologramPost>;
  mediaFilesOf(p: HologramPost): string[];
  densityImage(p: HologramPost): string;
  percentileFn(list: HologramPost[]): (p: HologramPost) => number;
  evalNode(n: HologramQueryNode, item: unknown, predOf: (f: HologramQueryLeaf) => (item: any) => boolean): boolean;
  treeLeaves(n: HologramQueryNode | null | undefined, out?: HologramQueryLeaf[]): HologramQueryLeaf[];
  postPredOf(f: HologramQueryLeaf): (p: HologramPost) => boolean;
  currentTree(): HologramQueryGroup;
  stickyRecs: Set<string>;
  sortValue(): string;
  shuffleSeed(): string;
  searchQuery(): string;
  buildUsers(): HologramUserAgg[];
  posterQBEval(u: HologramUserAgg): boolean;
  posterQBTree(): HologramQueryGroup;
  posterSort(): string;
  folderSort(): string;
  allFolders(): HologramFolder[];
  filterLabel(f: { type: string; [k: string]: any }): string;
}
export function makeListing(deps: ListingDeps) {
  const { allPosts, postsById, mediaFilesOf, densityImage, percentileFn, evalNode, treeLeaves, postPredOf, currentTree, stickyRecs, sortValue, shuffleSeed, searchQuery, buildUsers, posterQBEval, posterQBTree, posterSort, folderSort, allFolders, filterLabel } = deps;

  // Content gate shared by the post grid and dynamic folders: only records
  // with something to show (image / media / text / title) enter a listing.
  const hasContent = (p: HologramPost) => !!(p.image || mediaFilesOf(p).length || p.text || p.title);

  function getFilteredPosts() {
    // 統一ビュー: 全アイテム（SNS投稿＋ライブラリ画像）が対象。中身（画像 or 本文）の
    // 無いレコードだけ除外。SNS投稿だけ/画像だけの絞り込みは「種別」フィルタ(kind)で。
    let posts = allPosts().filter(hasContent);
    const sort = sortValue();
    // The search-box term now lives in the query tree as a 'text' leaf — evaluated by
    // evalNode below alongside every other condition (no separate text-filter phase).

    // ---- Query-builder evaluation: boolean condition tree ----
    // queryTree is a tree of groups (AND/OR, optionally negated) over leaf
    // conditions, built directly by the inline drag builder (改訂③); evalNode
    // walks it recursively.
    const queryRoot = currentTree(); // the boolean query tree (root group)
    if (queryRoot.children.length) posts = posts.filter((p) => evalNode(queryRoot, p, postPredOf));

    // Sticky records: items un-matched by a recent mutation stay visible
    // (cleared on the next filter change / data refresh).
    if (stickyRecs.size) {
      const have = new Set(posts.map((p) => p.captureId));
      for (const p of allPosts()) if (stickyRecs.has(p.captureId) && !have.has(p.captureId)) posts.push(p);
    }

    // Sort — use pre-cached numeric timestamps (_dateMs/_capturedMs) to avoid
    // new Date() per comparator call (was ~120k allocations per sort on 9k posts).
    switch (sort) {
      case 'date-desc':
        posts.sort((a, b) => (b._dateMs || 0) - (a._dateMs || 0));
        break;
      case 'date-asc':
        posts.sort((a, b) => (a._dateMs || 0) - (b._dateMs || 0));
        break;
      case 'likes-desc':
        posts.sort((a, b) => (b.likes || 0) - (a.likes || 0));
        break;
      case 'reposts-desc':
        posts.sort((a, b) => (b.reposts || 0) - (a.reposts || 0));
        break;
      case 'replies-desc':
        posts.sort((a, b) => (b.replies || 0) - (a.replies || 0));
        break;
      case 'captured-desc':
        posts.sort((a, b) => (b._capturedMs || 0) - (a._capturedMs || 0));
        break;
      case 'likes-pct': {
        const pct = percentileFn(posts);
        posts.sort((a, b) => pct(b) - pct(a));
        break;
      }
      case 'random': {
        // Seeded, not shuffled in place: the key is hash(seed | record), so the
        // order survives re-sorts and restores and ignores the input order (#118).
        // The record key mirrors records.ts postIdKey — inlined because records.ts
        // reaches IPC and this module stays pure.
        const seed = shuffleSeed();
        const rank = new Map(posts.map((p) => [p, shuffleRank(seed, p.captureId || (p.url || '') + '|' + (p.capturedAt || ''))]));
        posts.sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
        break;
      }
    }

    return posts;
  }

  // Named posters only — the identity-less ('(unknown)') bucket stays out of the grid.
  function namedPostersImpl() {
    return buildUsers().filter((u) => u.displayName || u.screenName);
  }
  function filteredPosters() {
    const q = searchQuery().trim().toLowerCase();
    let list = namedPostersImpl();
    // Boolean query tree (platform / instance / tag / folder / date).
    const root = posterQBTree();
    if (root.children.length) list = list.filter((u) => posterQBEval(u));
    // Search is kept OUT of the tree (same作法 as the post side).
    if (q) list = list.filter((u) => (u.displayName || '').toLowerCase().includes(q) || (u.screenName || '').toLowerCase().includes(q));
    const nameOf = (u: HologramUserAgg) => (u.displayName || u.screenName || '').toLowerCase();
    list = list.slice();
    // Sort: 'count' | 'name' | 'date-desc' | 'date-asc'. The date axis (dim) comes from the
    // query's date leaf (range axis == sort axis), falling back to 最終投稿日 (latest).
    const pSort = posterSort();
    if (pSort === 'date-desc' || pSort === 'date-asc') {
      const dl = treeLeaves(root).find((c) => c.type === 'date');
      // dateField's actual domain for posters (query.ts makePosterPredOf) — dl.dateField
      // itself is an open leaf field ('any'), so this just names its known values.
      const field: 'latest' | 'lastCapture' | 'authorCreatedAt' = (dl && dl.dateField) || 'latest';
      const asc = pSort === 'date-asc';
      list.sort((a, b) => {
        const av = a[field] || '',
          bv = b[field] || '';
        if (!av && !bv) return b.count - a.count;
        if (!av) return 1;
        if (!bv) return -1;
        const c = av.localeCompare(bv); // ISO strings compare lexically
        return (asc ? c : -c) || b.count - a.count;
      });
    } else if (pSort === 'name') {
      list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || b.count - a.count);
    } else {
      list.sort((a, b) => b.count - a.count || nameOf(a).localeCompare(nameOf(b))); // 'count' (default)
    }
    return list;
  }

  // Records backing a folder's cover + count. Static = its explicit items
  // (existing ones only); dynamic = posts matching the saved search (tree + q)
  // against the CURRENT library (= 開けば最新). Memoized per renderFolders pass
  // (resetFolderCache) so the sort + the card map don't each re-scan allPosts.
  let _folderRecCache: Map<string, any> | null = null;
  function resetFolderCache() {
    _folderRecCache = new Map();
  }
  function dynamicMatches(coll: HologramFolder): HologramPost[] {
    // The whole saved search lives in the condition tree — the free-text term is a
    // 'text' leaf inside it, not a field beside it.
    const tree = coll.tree && Array.isArray(coll.tree.children) ? coll.tree : null;
    const out: HologramPost[] = [];
    for (const p of allPosts()) {
      if (!hasContent(p)) continue; // mirror getFilteredPosts' content gate
      if (tree && tree.children.length && !evalNode(tree, p, postPredOf)) continue;
      out.push(p);
    }
    return out;
  }
  function folderRecords(coll: HologramFolder): HologramPost[] {
    if (_folderRecCache && _folderRecCache.has(coll.id)) return _folderRecCache.get(coll.id);
    let recs: HologramPost[];
    if (coll.kind === 'dynamic') recs = dynamicMatches(coll);
    else {
      recs = [];
      for (const cid of coll.items || []) {
        const r = postsById().get(cid);
        if (r) recs.push(r);
      }
    }
    if (_folderRecCache) _folderRecCache.set(coll.id, recs);
    return recs;
  }
  function folderThumbsFrom(recs: HologramPost[]) {
    const files: string[] = [];
    for (const rec of recs) {
      const f = densityImage(rec);
      if (f) files.push(f);
      if (files.length >= 4) break;
    }
    return files;
  }
  function folderItemCount(coll: HologramFolder) {
    return folderRecords(coll).length;
  }
  // Small condition chips summarizing a dynamic folder's saved tree. Capped;
  // purely informational (the mock's optional 条件チップ).
  function folderCondLabels(coll: HologramFolder) {
    const chips: string[] = [];
    try {
      for (const leaf of treeLeaves(coll.tree)) {
        chips.push(filterLabel(leaf));
        if (chips.length >= 4) break;
      }
    } catch {
      /* ignore malformed tree */
    }
    return chips; // React renders the .folder-cond chips from these labels
  }
  function filteredFolders() {
    const q = searchQuery().trim().toLowerCase();
    let list = allFolders().slice();
    if (q) list = list.filter((c) => (c.name || '').toLowerCase().includes(q));
    const cSort = folderSort();
    if (cSort === 'recent') list.sort((a, b) => (b.created || 0) - (a.created || 0) || (a.name || '').localeCompare(b.name || ''));
    else if (cSort === 'count') list.sort((a, b) => folderItemCount(b) - folderItemCount(a) || (a.name || '').localeCompare(b.name || ''));
    else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return list;
  }

  // The per-instance namedPosters closure is also bound onto the module-level
  // namedPosters live binding below (bindNamedPosters), so sidebar.ts — which
  // has no access to this closure — reads the SAME bound instance rather than
  // a second copy that could drift.
  return { getFilteredPosts, namedPosters: namedPostersImpl, filteredPosters, dynamicMatches, resetFolderCache, folderRecords, folderThumbsFrom, folderItemCount, folderCondLabels, filteredFolders };
}

// namedPosters is bound once at boot (viewer.ts, right after its own
// makeListing() call) via bindNamedPosters — the poster sidebar source needs
// namedPosters() for poster-instance disclosure, and this live binding lets a
// separate module (sidebar.ts) read the SAME already-bound closure instead of
// a second implementation. `let` + a setter (not a plain exported mutable
// object) because ES module named exports can only be reassigned by their own
// module — an importer's binding updates live once bindNamedPosters runs.
export let namedPosters: (() => HologramUserAgg[]) | null = null;
export function bindNamedPosters(fn: () => HologramUserAgg[]): void {
  namedPosters = fn;
}
