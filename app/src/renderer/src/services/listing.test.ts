// listing.ts（viewer.js から切り出した7つ目）の純粋な単体テスト。スタブの依存を
// 差し込んで、getFilteredPosts（中身ゲート → クエリ木 → sticky の合流 → 並べ替え）、
// namedPosters/filteredPosters、フォルダ側の導出（動的な突き合わせ／1パスごとの
// レコードキャッシュ／サムネ／件数／条件チップ／filteredFolders）を動かす。

import { beforeEach, describe, expect, test } from 'vitest';
import { makeListing } from './listing';

// --- スタブの環境 ---
// 投稿: p1..p3 は中身あり、p4 は空（ゲートで落ちる）、p5 はテキストのみ。
const posts = [
  { captureId: 'p1', platform: 'x', image: 'a.jpg', likes: 10, reposts: 1, replies: 4, localViewCount: 2, pct: 0.2, _dateMs: 300, _capturedMs: 30, text: 'cat post' },
  { captureId: 'p2', platform: 'pixiv', media: ['m.jpg'], likes: 50, reposts: 5, replies: 2, localViewCount: 7, pct: 0.9, _dateMs: 100, _capturedMs: 10 },
  { captureId: 'p3', platform: 'x', image: 'b.jpg', likes: 30, reposts: 3, replies: 6, localViewCount: 7, pct: 0.5, _dateMs: 200, _capturedMs: 20, text: 'dog post' },
  { captureId: 'p4', platform: 'x' }, // image/media/text/title のどれも無い＝中身ゲートで落ちる
  { captureId: 'p5', platform: 'bluesky', text: 'text only' },
];
const postsById = new Map(posts.map((p) => [p.captureId, p]));

// 投稿者: u3 は名前が分からない（グリッドから外れる）
const users = [
  { key: 'x:1', platform: 'x', displayName: 'Alice', screenName: 'alice', count: 5, latest: '2026-03-01', authorCreatedAt: '2020-01-01', followerPercentile: 0.4 },
  { key: 'x:2', platform: 'x', displayName: 'Bob', screenName: 'bob', count: 5, latest: '2026-01-01', authorCreatedAt: '', followerPercentile: 0.8 },
  { key: 'x:3', platform: 'x', displayName: '', screenName: '', count: 99 },
  { key: 'px:4', platform: 'pixiv', displayName: 'Carol', screenName: 'carol', count: 2, latest: '2026-02-01', authorCreatedAt: '2021-01-01', followerPercentile: null },
];

const EMPTY_TREE = { kind: 'group', op: 'and', neg: false, children: [] };

// AND だけの最小の木の走査と葉の述語（木の形はすべてここで組む）
const postPredOf = (f: any) => {
  if (f.type === 'platform') return (p: any) => p.platform === f.value;
  if (f.type === 'text') return (p: any) => String(p.text || '').includes(f.value);
  if (f.type === 'folder') return (p: any) => f.value === 'folder-1' && p.captureId === 'p2';
  return () => true;
};
const evalNode = (t: any, item: any, predOf: any) => t.children.every((c: any) => (c.kind === 'group' ? evalNode(c, item, predOf) : predOf(c)(item)));
const treeLeaves = (t: any) => (t && Array.isArray(t.children) ? t.children.filter((c: any) => c && c.kind === 'cond') : []);

let state: {
  tree: any;
  activeFolderId: string | null;
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
    activeFolderId: null,
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
    percentileFn: () => (p: any) => p.pct ?? null,
    evalNode,
    treeLeaves,
    postPredOf,
    currentTree: () => state.tree,
    activeFolderId: () => state.activeFolderId,
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

  test('サイドバーの現在地はクエリと別に投稿を部分木へ絞る', () => {
    state.activeFolderId = 'folder-1';
    expect(ids(api.getFilteredPosts())).toBe('p2');
    expect(state.tree).toBe(EMPTY_TREE);
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
    ['date-desc', 'p1,p3,p2,p5'], // _dateMs が無いものは 0 扱いで最後に来る
    ['date-asc', 'p2,p3,p1,p5'], // #47: 日付不明（p5）はここでも先頭ではなく末尾
    ['likes-desc', 'p2,p3,p1,p5'],
    ['likes-asc', 'p5,p1,p3,p2'],
    ['local-views-asc', 'p5,p1,p3,p2'],
    ['captured-asc', 'p2,p3,p1,p5'],
    ['likes-pct-asc', 'p1,p3,p2,p5'],
    ['local-views-desc', 'p3,p2,p1,p5'], // 同数ならキャプチャ日時が新しい方を先にする
    ['captured-desc', 'p1,p3,p2,p5'], // _capturedMs
    ['likes-pct', 'p2,p3,p1,p5'], // 差し込んだ percentileFn 経由。順位なしの p5 は末尾
  ])('%s', (sort, expected) => {
    state.sort = sort;
    expect(ids(api.getFilteredPosts())).toBe(expected);
  });
});

// #118: 並び順は（シード, レコードのキー）の純粋な関数＝シードが同じなら安定し、
// シードを変えれば変わり、入力の並び順には依存しない
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

  // その場でのシャッフルに偏りが無いことを確かめる
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
  test.each([
    ['count-asc', 'px:4,x:1,x:2'],
    ['name-desc', 'px:4,x:2,x:1'],
    ['followers-pct-asc', 'x:1,x:2,px:4'],
  ])('%s の逆方向も欠損値と同率を安定して並べる', (sort, expected) => {
    state.posterSort = sort;
    expect(ukeys(api.filteredPosters())).toBe(expected);
  });
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

  test('フォロワー順位はサイト内パーセンタイルの高い順で、順位なしは最後', () => {
    state.posterSort = 'followers-pct';
    expect(ukeys(api.filteredPosters())).toBe('x:2,x:1,px:4');
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

  test('検索は字形ゆれを吸収する', () => {
    users[0].displayName = 'ﾊﾞｯｸﾞ';
    state.search = 'ばっぐ';
    expect(ukeys(api.filteredPosters())).toBe('x:1');
    users[0].displayName = 'Alice';
  });
});

describe('folderRecords / キャッシュ', () => {
  const dynColl = { id: 'c1', items: ['p1', 'p3'] };

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

  test('検索は名前の字形ゆれを吸収する', () => {
    state.folders[2].name = 'ﾊﾞｯｸﾞ';
    state.search = 'ばっぐ';
    expect(cnames(api.filteredFolders())).toBe('ﾊﾞｯｸﾞ');
  });

  test('元のリストの並びを壊さない', () => {
    api.filteredFolders();
    expect(state.folders[0].name).toBe('Beta');
  });
});
