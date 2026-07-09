'use strict';

// Pure unit test for listing.ts — the 7th viewer.js extraction slice. listing.ts
// is a real ES module now (named exports), so load it with a dynamic import()
// (2026-07-09 window.corpusXxx→export/import conversion — see test-query-unit.cts
// for the same change on its sibling). Drives getFilteredPosts (content gate →
// query tree → sticky merge → sort), namedPosters/filteredPosters, the collection
// derivations (legacy-q folding / dynamic matching / per-pass record cache /
// thumbs / counts / cond chips / filteredCollections) and cloneTree with stub deps.
//
//   node scripts/test-listing-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const L = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'renderer', 'listing.ts')).href);

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- Stub environment ---------------------------------------------------
  // Posts: p1..p3 have content; p4 is empty (gated out); p5 is text-only.
  const posts = [
    { captureId: 'p1', platform: 'x', image: 'a.jpg', likes: 10, pct: 0.2, _dateMs: 300, _capturedMs: 30, text: 'cat post' },
    { captureId: 'p2', platform: 'pixiv', media: ['m.jpg'], likes: 50, pct: 0.9, _dateMs: 100, _capturedMs: 10 },
    { captureId: 'p3', platform: 'x', image: 'b.jpg', likes: 30, pct: 0.5, _dateMs: 200, _capturedMs: 20, text: 'dog post' },
    { captureId: 'p4', platform: 'x' }, // no image/media/text/title — content-gated out
    { captureId: 'p5', platform: 'bluesky', text: 'text only' },
  ];
  const postsById = new Map(posts.map((p) => [p.captureId, p]));
  let tree: any = { kind: 'group', op: 'and', neg: false, children: [] };
  let sort = 'none';
  let search = '';
  const stickyRecs = new Set();

  // Minimal AND-only tree walker + leaf predicates (we control every tree shape).
  const postPredOf = (f) => {
    if (f.type === 'platform') return (p) => p.platform === f.value;
    if (f.type === 'text') return (p) => String(p.text || '').includes(f.value);
    return () => true;
  };
  const evalNode = (t, item, predOf) => t.children.every((c) => (c.kind === 'group' ? evalNode(c, item, predOf) : predOf(c)(item)));
  const BAD_TREE = {
    get children() {
      throw new Error('malformed');
    },
  };
  const treeLeaves = (t) => (t && Array.isArray(t.children) ? t.children.filter((c) => c && c.kind === 'cond') : []);

  // Posters: u3 is identity-less (filtered out of the grid).
  const users = [
    { key: 'x:1', platform: 'x', displayName: 'Alice', screenName: 'alice', count: 5, latest: '2026-03-01', authorCreatedAt: '2020-01-01' },
    { key: 'x:2', platform: 'x', displayName: 'Bob', screenName: 'bob', count: 5, latest: '2026-01-01', authorCreatedAt: '' },
    { key: 'x:3', platform: 'x', displayName: '', screenName: '', count: 99 },
    { key: 'px:4', platform: 'pixiv', displayName: 'Carol', screenName: 'carol', count: 2, latest: '2026-02-01', authorCreatedAt: '2021-01-01' },
  ];
  let posterTree: any = { kind: 'group', op: 'and', neg: false, children: [] };
  let posterEval: (u?: any) => boolean = () => true;
  let posterSortV = 'count';
  let collectionSortV = 'name';
  let collections: any[] = [];

  const api = L.makeListing({
    allPosts: () => posts,
    postsById: () => postsById,
    mediaFilesOf: (p) => p.media || [],
    densityImage: (p) => p.thumb || '',
    percentileFn: () => (p) => p.pct || 0,
    evalNode,
    treeLeaves,
    postPredOf,
    currentTree: () => tree,
    stickyRecs,
    sortValue: () => sort,
    searchQuery: () => search,
    buildUsers: () => users,
    posterQBEval: (u) => posterEval(u),
    posterQBTree: () => posterTree,
    posterSort: () => posterSortV,
    collectionSort: () => collectionSortV,
    allCollections: () => collections,
    filterLabel: (f) => `${f.type}:${f.value}`,
  });

  // --- getFilteredPosts ----------------------------------------------------
  let out = api.getFilteredPosts();
  assert('content gate: empty record excluded, others in', out.length === 4 && !out.some((p) => p.captureId === 'p4'));
  assert('content gate: media-only and text-only records pass', out.some((p) => p.captureId === 'p2') && out.some((p) => p.captureId === 'p5'));

  tree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'platform', value: 'x' }] };
  out = api.getFilteredPosts();
  assert('query tree filters via evalNode+postPredOf', out.length === 2 && out.every((p) => p.platform === 'x'));

  stickyRecs.add('p2');
  out = api.getFilteredPosts();
  assert('sticky record survives an un-matching filter', out.length === 3 && out.some((p) => p.captureId === 'p2'));
  stickyRecs.add('p1'); // already matching — must not duplicate
  out = api.getFilteredPosts();
  assert('sticky record already in the result is not duplicated', out.filter((p) => p.captureId === 'p1').length === 1);
  stickyRecs.clear();
  tree = { kind: 'group', op: 'and', neg: false, children: [] };

  const ids = (list) => list.map((p) => p.captureId).join(',');
  sort = 'date-desc';
  assert('sort date-desc uses _dateMs (missing → 0 → last)', ids(api.getFilteredPosts()) === 'p1,p3,p2,p5');
  sort = 'date-asc';
  assert('sort date-asc', ids(api.getFilteredPosts()) === 'p5,p2,p3,p1');
  sort = 'likes-desc';
  assert('sort likes-desc', ids(api.getFilteredPosts()) === 'p2,p3,p1,p5');
  sort = 'captured-desc';
  assert('sort captured-desc uses _capturedMs', ids(api.getFilteredPosts()) === 'p1,p3,p2,p5');
  sort = 'likes-pct';
  assert('sort likes-pct via injected percentileFn', ids(api.getFilteredPosts()) === 'p2,p3,p1,p5');
  sort = 'none';

  // --- namedPosters / filteredPosters --------------------------------------
  assert('namedPosters drops the identity-less bucket', api.namedPosters().length === 3 && !api.namedPosters().some((u) => u.key === 'x:3'));

  const ukeys = (list) => list.map((u) => u.key).join(',');
  posterSortV = 'count';
  assert('poster sort count (default) — ties break by name', ukeys(api.filteredPosters()) === 'x:1,x:2,px:4');
  posterSortV = 'name';
  assert('poster sort name — ties break by count desc', ukeys(api.filteredPosters()) === 'x:1,x:2,px:4');
  posterSortV = 'date-desc';
  assert('poster sort date-desc falls back to latest', ukeys(api.filteredPosters()) === 'x:1,px:4,x:2');
  posterTree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'date', dateField: 'authorCreatedAt' }] };
  assert('poster date sort axis follows the tree date leaf; empty dates go last', ukeys(api.filteredPosters()) === 'px:4,x:1,x:2');
  posterSortV = 'date-asc';
  assert('poster sort date-asc', ukeys(api.filteredPosters()) === 'x:1,px:4,x:2');
  posterTree = { kind: 'group', op: 'and', neg: false, children: [] };
  posterSortV = 'count';

  posterEval = (u) => u.platform === 'pixiv';
  posterTree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'platform', value: 'pixiv' }] };
  assert('poster query tree filters via posterQBEval', ukeys(api.filteredPosters()) === 'px:4');
  posterTree = { kind: 'group', op: 'and', neg: false, children: [] };
  assert('empty poster tree skips posterQBEval entirely', api.filteredPosters().length === 3);
  posterEval = () => true;

  search = 'ali';
  assert('poster search matches displayName/screenName (case-folded)', ukeys(api.filteredPosters()) === 'x:1');
  search = '';

  // --- treeWithLegacyQ ------------------------------------------------------
  const t0 = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'platform', value: 'x' }] };
  assert('legacy q: empty q passes the tree through untouched', api.treeWithLegacyQ(t0, '') === t0);
  assert('legacy q: null tree + empty q → null', api.treeWithLegacyQ(null, ' ') === null);
  let folded = api.treeWithLegacyQ(t0, 'cat');
  assert('legacy q folds in as a confirmed text leaf', folded !== t0 && folded.children.length === 2 && folded.children[1].type === 'text' && folded.children[1].value === 'cat' && folded.children[1].mode === 'exact');
  const tText = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'text', value: 'x' }] };
  assert('legacy q: tree already carrying a text leaf passes through', api.treeWithLegacyQ(tText, 'cat') === tText);
  folded = api.treeWithLegacyQ(null, 'cat');
  assert('legacy q: q alone builds a fresh root group', folded && folded.children.length === 1 && folded.children[0].value === 'cat');

  // --- dynamicMatches / collectionRecords / cache ---------------------------
  const dynColl = { id: 'c1', kind: 'dynamic', tree: { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'text', value: 'post' }] }, q: '' };
  out = api.dynamicMatches(dynColl);
  assert('dynamicMatches: content gate + tree eval', ids(out) === 'p1,p3');
  out = api.dynamicMatches({ id: 'c2', kind: 'dynamic', tree: null, q: '' });
  assert('dynamicMatches: no tree → every content-bearing post', out.length === 4);

  const statColl = { id: 'c3', items: ['p2', 'gone', 'p5'] };
  out = api.collectionRecords(statColl);
  assert('static collectionRecords resolves via postsById, skipping missing ids', ids(out) === 'p2,p5');

  const before = api.collectionRecords(dynColl);
  assert('no cache before reset: fresh array per call', api.collectionRecords(dynColl) !== before);
  api.resetCollectionCache();
  const cached = api.collectionRecords(dynColl);
  assert('after reset: per-pass memo returns the same array', api.collectionRecords(dynColl) === cached);

  // --- thumbs / count / cond chips ------------------------------------------
  const recs = [{ thumb: 't1' }, {}, { thumb: 't2' }, { thumb: 't3' }, { thumb: 't4' }, { thumb: 't5' }];
  assert('collectionThumbsFrom skips thumbless records and caps at 4', api.collectionThumbsFrom(recs).join(',') === 't1,t2,t3,t4');
  assert('collectionItemCount = records length', api.collectionItemCount(statColl) === 2);

  const chips = api.collCondLabels({ id: 'c4', tree: t0, q: 'neko' });
  assert('collCondLabels: leaf labels via filterLabel + quoted legacy q', chips.length === 2 && chips[0] === 'platform:x' && chips[1] === '“neko”');
  const manyLeaves = { kind: 'group', op: 'and', neg: false, children: [1, 2, 3, 4, 5].map((i) => ({ kind: 'cond', type: 't', value: i })) };
  assert('collCondLabels caps at 4 (q dropped when full)', api.collCondLabels({ id: 'c5', tree: manyLeaves, q: 'x' }).length === 4);
  assert('collCondLabels swallows a malformed tree', api.collCondLabels({ id: 'c6', tree: BAD_TREE, q: 'q' }).join(',') === '“q”');

  // --- filteredCollections ---------------------------------------------------
  collections = [
    { id: 'a', name: 'Beta', created: 300, items: ['p1', 'p2'] },
    { id: 'b', name: 'alpha', created: 100, items: ['p1'] },
    { id: 'c', name: 'Gamma', created: 200, items: ['p1', 'p2', 'p5'] },
  ];
  const cnames = (list) => list.map((c) => c.name).join(',');
  collectionSortV = 'name';
  assert('collections sort by name', cnames(api.filteredCollections()) === 'alpha,Beta,Gamma');
  collectionSortV = 'recent';
  assert('collections sort by created desc', cnames(api.filteredCollections()) === 'Beta,Gamma,alpha');
  collectionSortV = 'count';
  api.resetCollectionCache();
  assert('collections sort by item count desc', cnames(api.filteredCollections()) === 'Gamma,Beta,alpha');
  search = 'gam';
  assert('collection search matches name (case-folded)', cnames(api.filteredCollections()) === 'Gamma');
  search = '';
  assert('filteredCollections does not mutate the source list order', collections[0].name === 'Beta');

  // --- cloneTree --------------------------------------------------------------
  const dirty = { kind: 'group', op: 'and', neg: false, _compiled: () => 1, children: [{ kind: 'cond', type: 'text', value: 'q', _memo: { big: true } }] };
  const clean = L.cloneTree(dirty);
  assert('cloneTree deep-copies', clean !== dirty && clean.children[0] !== dirty.children[0] && clean.children[0].value === 'q');
  assert('cloneTree drops _-prefixed transients at every depth', !('_compiled' in clean) && !('_memo' in clean.children[0]));

  console.log(failed ? `FAILED (${failed})` : 'PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
