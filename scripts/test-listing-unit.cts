'use strict';

// Pure unit test for listing.ts — the 7th viewer.js extraction slice. listing.ts
// is a real ES module now (named exports), so load it with a dynamic import()
// (2026-07-09 window.corpusXxx→export/import conversion — see test-query-unit.cts
// for the same change on its sibling). Drives getFilteredPosts (content gate →
// query tree → sticky merge → sort), namedPosters/filteredPosters, the collection
// derivations (legacy-q folding / dynamic matching / per-pass record cache /
// thumbs / counts / cond chips / filteredFolders) and cloneTree with stub deps.
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
    folderSort: () => collectionSortV,
    allFolders: () => collections,
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

  // --- dynamicMatches / folderRecords / cache ---------------------------
  const t0 = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'platform', value: 'x' }] };
  const dynColl = { id: 'c1', kind: 'dynamic', tree: { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'text', value: 'post' }] } };
  out = api.dynamicMatches(dynColl);
  assert('dynamicMatches: content gate + tree eval', ids(out) === 'p1,p3');
  out = api.dynamicMatches({ id: 'c2', kind: 'dynamic', tree: null });
  assert('dynamicMatches: no tree → every content-bearing post', out.length === 4);
  out = api.dynamicMatches({ id: 'c2b', kind: 'dynamic', tree: { kind: 'group', op: 'and', neg: false } });
  assert('dynamicMatches: childless tree → every content-bearing post', out.length === 4);

  const statColl = { id: 'c3', items: ['p2', 'gone', 'p5'] };
  out = api.folderRecords(statColl);
  assert('static folderRecords resolves via postsById, skipping missing ids', ids(out) === 'p2,p5');

  const before = api.folderRecords(dynColl);
  assert('no cache before reset: fresh array per call', api.folderRecords(dynColl) !== before);
  api.resetFolderCache();
  const cached = api.folderRecords(dynColl);
  assert('after reset: per-pass memo returns the same array', api.folderRecords(dynColl) === cached);

  // --- thumbs / count / cond chips ------------------------------------------
  const recs = [{ thumb: 't1' }, {}, { thumb: 't2' }, { thumb: 't3' }, { thumb: 't4' }, { thumb: 't5' }];
  assert('folderThumbsFrom skips thumbless records and caps at 4', api.folderThumbsFrom(recs).join(',') === 't1,t2,t3,t4');
  assert('folderItemCount = records length', api.folderItemCount(statColl) === 2);

  const chips = api.folderCondLabels({ id: 'c4', tree: t0 });
  assert('folderCondLabels: leaf labels via filterLabel', chips.length === 1 && chips[0] === 'platform:x');
  const manyLeaves = { kind: 'group', op: 'and', neg: false, children: [1, 2, 3, 4, 5].map((i) => ({ kind: 'cond', type: 't', value: i })) };
  assert('folderCondLabels caps at 4', api.folderCondLabels({ id: 'c5', tree: manyLeaves }).length === 4);
  assert('folderCondLabels swallows a malformed tree', api.folderCondLabels({ id: 'c6', tree: BAD_TREE }).length === 0);

  // --- filteredFolders ---------------------------------------------------
  collections = [
    { id: 'a', name: 'Beta', created: 300, items: ['p1', 'p2'] },
    { id: 'b', name: 'alpha', created: 100, items: ['p1'] },
    { id: 'c', name: 'Gamma', created: 200, items: ['p1', 'p2', 'p5'] },
  ];
  const cnames = (list) => list.map((c) => c.name).join(',');
  collectionSortV = 'name';
  assert('collections sort by name', cnames(api.filteredFolders()) === 'alpha,Beta,Gamma');
  collectionSortV = 'recent';
  assert('collections sort by created desc', cnames(api.filteredFolders()) === 'Beta,Gamma,alpha');
  collectionSortV = 'count';
  api.resetFolderCache();
  assert('collections sort by item count desc', cnames(api.filteredFolders()) === 'Gamma,Beta,alpha');
  search = 'gam';
  assert('collection search matches name (case-folded)', cnames(api.filteredFolders()) === 'Gamma');
  search = '';
  assert('filteredFolders does not mutate the source list order', collections[0].name === 'Beta');

  console.log(failed ? `FAILED (${failed})` : 'PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
