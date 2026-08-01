// Pure unit tests for listing.ts (7th slice extracted from viewer.js). Drives getFilteredPosts
// (content gate → query tree → sticky merge → sorting), namedPosters/filteredPosters,
// and the folder-side derivation (dynamic matching / per-pass record cache / thumbnails /
// counts / condition chips / filteredFolders) with stub deps injected.

import { beforeEach, describe, expect, test } from 'vitest';
import { makeListing } from '../app/src/renderer/src/services/listing';

// --- Stub environment ---
// Posts: p1..p3 have content, p4 is empty (dropped by the gate), p5 is text-only.
const posts = [
  { captureId: 'p1', platform: 'x', image: 'a.jpg', likes: 10, pct: 0.2, _dateMs: 300, _capturedMs: 30, text: 'cat post' },
  { captureId: 'p2', platform: 'pixiv', media: ['m.jpg'], likes: 50, pct: 0.9, _dateMs: 100, _capturedMs: 10 },
  { captureId: 'p3', platform: 'x', image: 'b.jpg', likes: 30, pct: 0.5, _dateMs: 200, _capturedMs: 20, text: 'dog post' },
  { captureId: 'p4', platform: 'x' }, // no image/media/text/title = dropped by the content gate
  { captureId: 'p5', platform: 'bluesky', text: 'text only' },
];
const postsById = new Map(posts.map((p) => [p.captureId, p]));

// Posters: u3 has no identifiable name (excluded from the grid)
const users = [
  { key: 'x:1', platform: 'x', displayName: 'Alice', screenName: 'alice', count: 5, latest: '2026-03-01', authorCreatedAt: '2020-01-01' },
  { key: 'x:2', platform: 'x', displayName: 'Bob', screenName: 'bob', count: 5, latest: '2026-01-01', authorCreatedAt: '' },
  { key: 'x:3', platform: 'x', displayName: '', screenName: '', count: 99 },
  { key: 'px:4', platform: 'pixiv', displayName: 'Carol', screenName: 'carol', count: 2, latest: '2026-02-01', authorCreatedAt: '2021-01-01' },
];

const EMPTY_TREE = { kind: 'group', op: 'and', neg: false, children: [] };
const BAD_TREE = {
  get children() {
    throw new Error('malformed');
  },
};

// Minimal AND-only tree walker and leaf predicates (the tree shape is entirely built here)
const postPredOf = (f: any) => {
  if (f.type === 'platform') return (p: any) => p.platform === f.value;
  if (f.type === 'text') return (p: any) => String(p.text || '').includes(f.value);
  return () => true;
};
const evalNode = (t: any, item: any, predOf: any) => t.children.every((c: any) => (c.kind === 'group' ? evalNode(c, item, predOf) : predOf(c)(item)));
const treeLeaves = (t: any) => (t && Array.isArray(t.children) ? t.children.filter((c: any) => c && c.kind === 'cond') : []);

let state: {
  tree: any;
  sort: string;
  shuffleSeed: string;
  search: string;
  stickyRecs: Set<string>;
  posterTree: any;
  posterEval: (u: any) => boolean;
  posterSort: string;
  folderSort: string;
  folders: any[];
};
let api: ReturnType<typeof makeListing>;

beforeEach(() => {
  state = {
    tree: EMPTY_TREE,
    sort: 'none',
    shuffleSeed: '',
    search: '',
    stickyRecs: new Set(),
    posterTree: EMPTY_TREE,
    posterEval: () => true,
    posterSort: 'count',
    folderSort: 'name',
    folders: [],
  };
  api = makeListing({
    allPosts: () => posts,
    postsById: () => postsById,
    mediaFilesOf: (p: any) => p.media || [],
    densityImage: (p: any) => p.thumb || '',
    percentileFn: () => (p: any) => p.pct || 0,
    evalNode,
    treeLeaves,
    postPredOf,
    currentTree: () => state.tree,
    stickyRecs: state.stickyRecs,
    sortValue: () => state.sort,
    shuffleSeed: () => state.shuffleSeed,
    searchQuery: () => state.search,
    buildUsers: () => users,
    posterQBEval: (u: any) => state.posterEval(u),
    posterQBTree: () => state.posterTree,
    posterSort: () => state.posterSort,
    folderSort: () => state.folderSort,
    allFolders: () => state.folders,
    filterLabel: (f: any) => `${f.type}:${f.value}`,
  });
});

const ids = (list: any[]) => list.map((p) => p.captureId).join(',');
const ukeys = (list: any[]) => list.map((u) => u.key).join(',');
const onlyX = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'platform', value: 'x' }] };

describe('getFilteredPosts: 中身ゲート', () => {
  test('中身の無いレコードだけ落ちる', () => {
    const out = api.getFilteredPosts();
    expect(out).toHaveLength(4);
    expect(out.map((p: any) => p.captureId)).not.toContain('p4');
  });

  test('メディアのみ・テキストのみのレコードは通る', () => {
    expect(ids(api.getFilteredPosts())).toContain('p2');
    expect(ids(api.getFilteredPosts())).toContain('p5');
  });
});

describe('getFilteredPosts: クエリ木と sticky', () => {
  test('クエリ木は evalNode+postPredOf で効く', () => {
    state.tree = onlyX;
    const out = api.getFilteredPosts();
    expect(out).toHaveLength(2);
    expect(out.every((p: any) => p.platform === 'x')).toBe(true);
  });

  test('sticky なレコードは条件に合わなくても残る', () => {
    state.tree = onlyX;
    state.stickyRecs.add('p2');
    const out = api.getFilteredPosts();
    expect(out).toHaveLength(3);
    expect(ids(out)).toContain('p2');
  });

  test('すでに結果に居る sticky を二重に足さない', () => {
    state.tree = onlyX;
    state.stickyRecs.add('p1');
    expect(api.getFilteredPosts().filter((p: any) => p.captureId === 'p1')).toHaveLength(1);
  });
});

describe('getFilteredPosts: 並べ替え', () => {
  test.each([
    ['date-desc', 'p1,p3,p2,p5'], // missing _dateMs is treated as 0 and sorts last
    ['date-asc', 'p5,p2,p3,p1'],
    ['likes-desc', 'p2,p3,p1,p5'],
    ['captured-desc', 'p1,p3,p2,p5'], // _capturedMs
    ['likes-pct', 'p2,p3,p1,p5'], // via the injected percentileFn
  ])('%s', (sort, expected) => {
    state.sort = sort;
    expect(ids(api.getFilteredPosts())).toBe(expected);
  });
});

// #118: the order is a pure function of (seed, record key) = stable per seed, changes
// when the seed changes, and does not depend on the input order
describe('getFilteredPosts: ランダム並べ替え（#118）', () => {
  beforeEach(() => {
    state.sort = 'random';
    state.shuffleSeed = 'seed-a';
  });

  test('同じシードでは安定し、レコードを1件も落とさない', () => {
    const rndA = ids(api.getFilteredPosts());
    expect(ids(api.getFilteredPosts())).toBe(rndA);
    expect(rndA.split(',').sort().join(',')).toBe('p1,p2,p3,p5');
  });

  test('シードを変えると並びが変わり、戻せば再現する', () => {
    const rndA = ids(api.getFilteredPosts());
    state.shuffleSeed = 'seed-b';
    expect(ids(api.getFilteredPosts())).not.toBe(rndA);

    state.shuffleSeed = 'seed-a';
    expect(ids(api.getFilteredPosts())).toBe(rndA);
  });

  // Confirms the in-place shuffle has no bias
  test('入力の並び順に依存しない', () => {
    const rndA = ids(api.getFilteredPosts());
    posts.reverse();
    try {
      expect(ids(api.getFilteredPosts())).toBe(rndA);
    } finally {
      posts.reverse();
    }
  });
});

describe('namedPosters / filteredPosters', () => {
  test('名前を持たないバケットは落とす', () => {
    expect(api.namedPosters()).toHaveLength(3);
    expect(ukeys(api.namedPosters())).not.toContain('x:3');
  });

  test('count 並び（既定）＝同数は名前で決着', () => {
    expect(ukeys(api.filteredPosters())).toBe('x:1,x:2,px:4');
  });

  test('name 並び＝同名は count 降順で決着', () => {
    state.posterSort = 'name';
    expect(ukeys(api.filteredPosters())).toBe('x:1,x:2,px:4');
  });

  test('date-desc は latest へ落ちる', () => {
    state.posterSort = 'date-desc';
    expect(ukeys(api.filteredPosters())).toBe('x:1,px:4,x:2');
  });

  test('日付の軸は木の日付葉に従い、空の日付は最後', () => {
    state.posterSort = 'date-desc';
    state.posterTree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'date', dateField: 'authorCreatedAt' }] };
    expect(ukeys(api.filteredPosters())).toBe('px:4,x:1,x:2');

    state.posterSort = 'date-asc';
    expect(ukeys(api.filteredPosters())).toBe('x:1,px:4,x:2');
  });

  test('投稿者のクエリ木は posterQBEval で効く', () => {
    state.posterEval = (u: any) => u.platform === 'pixiv';
    state.posterTree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'platform', value: 'pixiv' }] };
    expect(ukeys(api.filteredPosters())).toBe('px:4');
  });

  test('空の木なら posterQBEval を呼ばない', () => {
    state.posterEval = () => false;
    expect(api.filteredPosters()).toHaveLength(3);
  });

  test('検索は displayName/screenName に大小無視で当たる', () => {
    state.search = 'ali';
    expect(ukeys(api.filteredPosters())).toBe('x:1');
  });
});

describe('dynamicMatches / folderRecords / キャッシュ', () => {
  const dynColl = { id: 'c1', kind: 'dynamic', tree: { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'text', value: 'post' }] } };

  test('中身ゲート＋木の評価', () => {
    expect(ids(api.dynamicMatches(dynColl))).toBe('p1,p3');
  });

  test('木が無い／子が無い場合は中身のある投稿すべて', () => {
    expect(api.dynamicMatches({ id: 'c2', kind: 'dynamic', tree: null })).toHaveLength(4);
    expect(api.dynamicMatches({ id: 'c2b', kind: 'dynamic', tree: { kind: 'group', op: 'and', neg: false } })).toHaveLength(4);
  });

  test('静的フォルダは postsById で解決し、消えた id は飛ばす', () => {
    expect(ids(api.folderRecords({ id: 'c3', items: ['p2', 'gone', 'p5'] }))).toBe('p2,p5');
  });

  test('reset 前は呼ぶたび新しい配列、reset 後は1パスのメモが同じ配列を返す', () => {
    const before = api.folderRecords(dynColl);
    expect(api.folderRecords(dynColl)).not.toBe(before);

    api.resetFolderCache();
    const cached = api.folderRecords(dynColl);
    expect(api.folderRecords(dynColl)).toBe(cached);
  });
});

describe('サムネ・件数・条件チップ', () => {
  test('folderThumbsFrom はサムネ無しを飛ばし4件で打ち切る', () => {
    const recs = [{ thumb: 't1' }, {}, { thumb: 't2' }, { thumb: 't3' }, { thumb: 't4' }, { thumb: 't5' }];
    expect(api.folderThumbsFrom(recs)).toEqual(['t1', 't2', 't3', 't4']);
  });

  test('folderItemCount はレコード数', () => {
    expect(api.folderItemCount({ id: 'c3', items: ['p2', 'gone', 'p5'] })).toBe(2);
  });

  test('folderCondLabels は filterLabel で葉のラベルを作る', () => {
    expect(api.folderCondLabels({ id: 'c4', tree: onlyX })).toEqual(['platform:x']);
  });

  test('folderCondLabels は4件で打ち切る', () => {
    const manyLeaves = { kind: 'group', op: 'and', neg: false, children: [1, 2, 3, 4, 5].map((i) => ({ kind: 'cond', type: 't', value: i })) };
    expect(api.folderCondLabels({ id: 'c5', tree: manyLeaves })).toHaveLength(4);
  });

  test('folderCondLabels は壊れた木を飲み込む', () => {
    expect(api.folderCondLabels({ id: 'c6', tree: BAD_TREE })).toEqual([]);
  });
});

describe('filteredFolders', () => {
  const cnames = (list: any[]) => list.map((c) => c.name).join(',');

  beforeEach(() => {
    state.folders = [
      { id: 'a', name: 'Beta', created: 300, items: ['p1', 'p2'] },
      { id: 'b', name: 'alpha', created: 100, items: ['p1'] },
      { id: 'c', name: 'Gamma', created: 200, items: ['p1', 'p2', 'p5'] },
    ];
  });

  test('名前順', () => {
    expect(cnames(api.filteredFolders())).toBe('alpha,Beta,Gamma');
  });

  test('作成日の新しい順', () => {
    state.folderSort = 'recent';
    expect(cnames(api.filteredFolders())).toBe('Beta,Gamma,alpha');
  });

  test('件数の多い順', () => {
    state.folderSort = 'count';
    api.resetFolderCache();
    expect(cnames(api.filteredFolders())).toBe('Gamma,Beta,alpha');
  });

  test('検索は名前に大小無視で当たる', () => {
    state.search = 'gam';
    expect(cnames(api.filteredFolders())).toBe('Gamma');
  });

  test('元のリストの並びを壊さない', () => {
    api.filteredFolders();
    expect(state.folders[0].name).toBe('Beta');
  });
});
