// Listing pipeline service — "what is visible, in what order" for all three
// browse modes: getFilteredPosts (post grid = content gate → query tree →
// sticky merge → sort), namedPosters/filteredPosters (poster grid), and the
// collection derivations (dynamic saved-search matching, per-pass record cache,
// cover thumbs, counts, condition chips, filteredCollections). Extracted 1:1
// from viewer.js as the seventh "pure logic → service" slice of the viewer
// decomposition (最終形B). Plain IIFE on window (like query.js / records.js /
// users.js / tab-state.js); loaded BEFORE viewer.js; touches no DOM. Runtime
// couplings are injected via makeListing(deps) — reassigned viewer lets come in
// as getters, consts declared after the wiring point as deferred arrows — so
// this file loads under Node (scripts/test-listing-unit.js). CommonJS-exported
// like records.js.
(function () {
  'use strict';

  // deps contract (all functions unless noted):
  //   allPosts() / postsById() — the library + its captureId map (getters — viewer reassigns both)
  //   mediaFilesOf(p) / densityImage(p, d) / percentileFn(list) — from records.js
  //   evalNode(n, item, predOf) / treeLeaves(n) — from query.js
  //   postPredOf(f) — the post-side leaf-predicate (query.js makePostPredOf product)
  //   currentTree() — the active tab's boolean query tree (root group)
  //   stickyRecs — Set of captureIds kept visible after a mutation un-matches the filter
  //   sortValue() — the post sort select's current value
  //   searchQuery() — the search-box term (corpusStore-backed)
  //   buildUsers() — poster roll-up (users.js product)
  //   posterQBEval(u) / posterQBTree() — the poster query builder (deferred — later const)
  //   posterSort() / collectionSort() — mode sort keys (getters — reassigned lets)
  //   allCollections() — CF().allCollections() or [] before folders load
  //   filterLabel(f) — leaf pill label (tab-state.js makeTabLabels product)
  function makeListing(deps) {
    const { allPosts, postsById, mediaFilesOf, densityImage, percentileFn, evalNode, treeLeaves, postPredOf, currentTree, stickyRecs, sortValue, searchQuery, buildUsers, posterQBEval, posterQBTree, posterSort, collectionSort, allCollections, filterLabel } = deps;

    // Content gate shared by the post grid and dynamic collections: only records
    // with something to show (image / media / text / title) enter a listing.
    const hasContent = (p) => !!(p.image || mediaFilesOf(p).length || p.text || p.title);

    function getFilteredPosts() {
      // 統一ビュー: 全アイテム（SNS投稿＋ライブラリ画像）が対象。中身（画像 or 本文）の
      // 無いレコードだけ除外。SNS投稿だけ/画像だけの絞り込みは「種別」フィルタ(kind)で。
      let posts = allPosts().filter(hasContent);
      const sort = sortValue();
      // The search-box term now lives in the query tree as a 'text' leaf — evaluated by
      // evalNode below alongside every other condition (no separate text-filter phase).

      // ---- Query-builder evaluation: boolean condition tree ----
      // queryTree is a tree of groups (AND/OR, optionally negated) over leaf
      // conditions, built directly by the inline drag builder; evalNode walks it
      // recursively. See docs/design-query-builder.md「改訂③」.
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
      }

      return posts;
    }

    // Named posters only — the identity-less ('(unknown)') bucket stays out of the grid.
    function namedPosters() {
      return buildUsers().filter((u) => u.displayName || u.screenName);
    }
    function filteredPosters() {
      const q = searchQuery().trim().toLowerCase();
      let list = namedPosters();
      // Boolean query tree (platform / instance / tag / folder / date).
      const root = posterQBTree();
      if (root.children.length) list = list.filter((u) => posterQBEval(u));
      // Search is kept OUT of the tree (same作法 as the post side).
      if (q) list = list.filter((u) => (u.displayName || '').toLowerCase().includes(q) || (u.screenName || '').toLowerCase().includes(q));
      const nameOf = (u) => (u.displayName || u.screenName || '').toLowerCase();
      list = list.slice();
      // Sort: 'count' | 'name' | 'date-desc' | 'date-asc'. The date axis (dim) comes from the
      // query's date leaf (range axis == sort axis), falling back to 最終投稿日 (latest).
      const pSort = posterSort();
      if (pSort === 'date-desc' || pSort === 'date-asc') {
        const dl = treeLeaves(root).find((c) => c.type === 'date');
        const field = (dl && dl.dateField) || 'latest',
          asc = pSort === 'date-asc';
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

    // Records backing a collection's cover + count. Static = its explicit items
    // (existing ones only); dynamic = posts matching the saved search (tree + q)
    // against the CURRENT library (= 開けば最新). Memoized per renderCollections pass
    // (resetCollectionCache) so the sort + the card map don't each re-scan allPosts.
    let _collRecCache: Map<string, any> | null = null;
    function resetCollectionCache() {
      _collRecCache = new Map();
    }
    // Fold a legacy free-text q into a tree as a confirmed 'text' leaf (pre-text-leaf
    // saves stored the search term separately in coll.q). Returns the tree to evaluate —
    // a pass-through when q is empty or the tree already carries a text leaf.
    function treeWithLegacyQ(tree, q) {
      const t = tree && Array.isArray(tree.children) ? tree : null;
      if (!q || !q.trim() || (t && treeLeaves(t).some((c) => c.type === 'text'))) return t;
      return { kind: 'group', op: 'and', neg: false, children: [...((t && t.children) || []), { kind: 'cond', type: 'text', value: q.trim(), mode: 'exact' }] };
    }
    function dynamicMatches(coll) {
      const tree = treeWithLegacyQ(coll.tree, coll.q); // text term lives in the tree now (q = legacy only)
      const out: any[] = [];
      for (const p of allPosts()) {
        if (!hasContent(p)) continue; // mirror getFilteredPosts' content gate
        if (tree && tree.children.length && !evalNode(tree, p, postPredOf)) continue;
        out.push(p);
      }
      return out;
    }
    function collectionRecords(coll) {
      if (_collRecCache && _collRecCache.has(coll.id)) return _collRecCache.get(coll.id);
      let recs: any;
      if (coll.kind === 'dynamic') recs = dynamicMatches(coll);
      else {
        recs = [];
        for (const cid of coll.items) {
          const r = postsById().get(cid);
          if (r) recs.push(r);
        }
      }
      if (_collRecCache) _collRecCache.set(coll.id, recs);
      return recs;
    }
    function collectionThumbsFrom(recs) {
      const files: string[] = [];
      for (const rec of recs) {
        const f = densityImage(rec, 'card');
        if (f) files.push(f);
        if (files.length >= 4) break;
      }
      return files;
    }
    function collectionItemCount(coll) {
      return collectionRecords(coll).length;
    }
    // Small condition chips under a dynamic card's name (saved tree leaves + the
    // free-text q). Capped; purely informational (the mock's optional 条件チップ).
    function collCondLabels(coll) {
      const chips: string[] = [];
      try {
        for (const leaf of treeLeaves(coll.tree)) {
          chips.push(filterLabel(leaf));
          if (chips.length >= 4) break;
        }
      } catch {
        /* ignore malformed tree */
      }
      if (coll.q && coll.q.trim() && chips.length < 4) chips.push('“' + coll.q.trim() + '”');
      return chips; // React renders the .collection-cond chips from these labels
    }
    function filteredCollections() {
      const q = searchQuery().trim().toLowerCase();
      let list = allCollections().slice();
      if (q) list = list.filter((c) => (c.name || '').toLowerCase().includes(q));
      const cSort = collectionSort();
      if (cSort === 'recent') list.sort((a, b) => (b.created || 0) - (a.created || 0) || (a.name || '').localeCompare(b.name || ''));
      else if (cSort === 'count') list.sort((a, b) => collectionItemCount(b) - collectionItemCount(a) || (a.name || '').localeCompare(b.name || ''));
      else list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      return list;
    }

    return { getFilteredPosts, namedPosters, filteredPosters, treeWithLegacyQ, dynamicMatches, resetCollectionCache, collectionRecords, collectionThumbsFrom, collectionItemCount, collCondLabels, filteredCollections };
  }

  // Deep-clone a query tree for persistence, dropping transient memo fields (_compiled…).
  const cloneTree = (tree) => JSON.parse(JSON.stringify(tree, (k, v) => (k[0] === '_' ? undefined : v)));

  const api = { makeListing, cloneTree };
  if (typeof window !== 'undefined') window.corpusListing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
