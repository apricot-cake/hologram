// facets.ts のロジック単体テスト。facetCounts（バケット集計）と qfValues（15カテゴリの
// フライアウト行モデル）を、スタブ deps 注入で直接検証する。

import { describe, expect, test } from 'vitest';
import { makeFacets } from '../app/src/renderer/src/services/facets';

// --- スタブ環境: 投稿6件（x2・misskey1・mastodon1・pixiv1・PFなし1） ---
const posts = [
  { captureId: 'c1', url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景', '作品A'], hashtags: ['art'], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
  { captureId: 'c2', url: 'https://x.com/b/status/2', platform: 'x', userId: 'u2', screenName: 'bob', displayName: '', tags: ['風景'], hashtags: ['art', 'wip'], mediaType: 'video', isReply: true, isQuote: false, isThread: false },
  { captureId: 'c3', url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', tags: [], hashtags: [], mediaType: 'image', isReply: false, isQuote: true, isThread: false },
  { captureId: 'c4', url: 'https://mstdn.jp/@d/3', platform: 'mastodon', userId: 'u4', screenName: 'dan', tags: ['キャラX'], hashtags: [], mediaType: 'gif', isReply: false, isQuote: false, isThread: true },
  { captureId: 'c5', url: 'https://www.pixiv.net/artworks/9', platform: 'pixiv', userId: 'u5', screenName: 'eve', tags: ['未分類タグ'], hashtags: [], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
  { captureId: 'c6', url: null, platform: null, tags: ['風景'], hashtags: [], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
];
// 現在クエリの母集団＝先頭3件だけに絞れている想定（facet count はこちらで数える）
const filtered = posts.slice(0, 3);

const active = new Set(['platform:x', 'tag:風景']);
const posterActive = new Set(['tag:P趣味']);
const KIND: Record<string, string> = { 作品A: 'work', キャラX: 'character', P作品: 'work' };

// 投稿者集計は 13 フィールド全部が必須（HologramUserAgg）＝この行が facet の読む分だけを
// 上書きし、残りは空で埋める。部分オブジェクトを直接置くと deps の契約と合わない。
const userAgg = (u: Partial<HologramUserAgg>): HologramUserAgg => ({
  key: '',
  platform: '',
  screenName: '',
  displayName: '',
  avatarFile: '',
  followers: null,
  authorCreatedAt: '',
  instance: '',
  latest: '',
  firstPost: '',
  lastCapture: '',
  firstCapture: '',
  count: 0,
  ...u,
});

const posters = [
  userAgg({ key: 'x:u1', platform: 'x', screenName: 'alice', displayName: 'アリス', count: 3 }),
  userAgg({ key: 'misskey:u3', platform: 'misskey', instance: 'misskey.io', screenName: 'carol', count: 2 }),
  userAgg({ key: 'mastodon:u4', platform: 'mastodon', instance: 'mstdn.jp', screenName: 'dan', count: 1 }),
];
const posterTags: Record<string, string[]> = { 'x:u1': ['P趣味', 'P作品'], 'misskey:u3': ['P趣味'], 'mastodon:u4': [] };
const posterFolders = [{ id: 'pf1', name: '推し', items: ['x:u1', 'mastodon:u4'] }];
// 投稿フォルダ（folders.json）は投稿者フォルダとは別の dep。親配下の小計まで数える（#41）
// ので、親子を1組持たせて「行のラベル＝パス／count＝サブツリー」を見られるようにする。
const postFolders = [
  { id: 'f-parent', name: '親', items: ['c1'] },
  { id: 'f-child', name: '子', items: ['c2'], parentId: 'f-parent' },
];

const LABELS: Record<string, string> = {
  kindPost: 'SNS投稿',
  kindImage: '画像',
  qfPost: '投稿',
  qfReply: 'リプライ',
  qfQuote: '引用',
  qfThread: 'スレッド',
  qfImage: '画像',
  qfVideo: '動画',
  qfGif: 'GIF',
  qfMultiImage: '複数画像',
  qfPlatformNone: 'なし',
  qfTagNone: 'タグなし',
};

const { facetCounts, qfValues } = makeFacets({
  getFilteredPosts: () => filtered,
  qHasValue: (t, v) => active.has(`${t}:${v}`),
  posterQHasValue: (t, v) => posterActive.has(`${t}:${v}`),
  allPosts: () => posts,
  hostOf: (url) => {
    try {
      return new URL(url ?? '').hostname;
    } catch {
      return '';
    }
  },
  userKey: (p) => `${p.platform}:${p.userId || `@${p.screenName || ''}`}`,
  t: (key: string) => LABELS[key],
  PF_NAME: { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' },
  tagKindOf: (t: string) => KIND[t],
  posterTagsOf: (key: string) => posterTags[key] || [],
  filteredPosters: () => posters,
  posterFilterVocab: () => ['P趣味', 'P作品'],
  namedPosters: () => posters,
  posterFolders: () => posterFolders,
  postFolders: () => postFolders,
  buildUsers: () => posters,
});

describe('facetCounts', () => {
  test('既定の母集団は filtered', () => {
    const m = facetCounts((p) => p.platform || '__none');
    expect(m.get('x')).toBe(2);
    expect(m.get('misskey')).toBe(1);
    expect(m.has('pixiv')).toBe(false);
  });

  test('配列キーは各値を加算する', () => {
    const t = facetCounts((p) => p.tags);
    expect(t.get('風景')).toBe(2);
    expect(t.get('作品A')).toBe(1);
  });

  test('null はスキップ', () => {
    expect(facetCounts(() => null).size).toBe(0);
  });

  test('pool を渡すと母集団が切り替わる', () => {
    // 2引数の overload は投稿者プール専用（facets.ts の契約）＝poster-* の行がここを通る。
    const pool = facetCounts((u) => u.platform, posters.slice(1));
    expect(pool.get('misskey')).toBe(1);
    expect(pool.get('mastodon')).toBe(1);
    expect(pool.has('x')).toBe(false);
  });
});

describe('qfValues: kind / platform', () => {
  test('kind は2値でラベルつき', () => {
    const rows = qfValues('kind');
    expect(rows).toHaveLength(2);
    expect(rows[0].l).toBe('SNS投稿');
    expect(rows[1].v).toBe('image');
  });

  test('platform の主行は 5PF + なし', () => {
    const main = qfValues('platform').filter((r) => !r.sub);
    expect(main).toHaveLength(6);
    expect(main[5].v).toBe('__none');
  });

  test('platform の on にアクティブ状態が出る', () => {
    const main = qfValues('platform').filter((r) => !r.sub);
    expect(main[0]).toMatchObject({ v: 'x', on: true });
    expect(main[1].on).toBe(false);
  });

  test('platform の count は filtered 由来', () => {
    const main = qfValues('platform').filter((r) => !r.sub);
    expect(main[0].count).toBe(2);
    expect(main.find((r) => r.v === 'pixiv')?.count).toBe(0);
  });

  test('platform のインスタンスサブ行は全ライブラリから列挙（type=instance）', () => {
    const subs = qfValues('platform').filter((r) => r.sub);
    expect(subs).toHaveLength(2);
    expect(subs.every((r) => r.type === 'instance')).toBe(true);
    expect(subs.map((r) => r.v).sort()).toEqual(['misskey.io', 'mstdn.jp']);
  });

  test('platform サブ行の count（filtered 外は 0）', () => {
    const subs = qfValues('platform').filter((r) => r.sub);
    expect(subs.find((r) => r.v === 'misskey.io')?.count).toBe(1);
    expect(subs.find((r) => r.v === 'mstdn.jp')?.count).toBe(0);
  });
});

describe('qfValues: postType / media', () => {
  test('postType は多重バケット', () => {
    const by = Object.fromEntries(qfValues('postType').map((r) => [r.v, r.count]));
    expect(by).toMatchObject({ post: 1, reply: 1, quote: 1, thread: 0 });
  });

  // 複数画像はサイドバー側の独立トグル行へ移動＝メディアのフライアウトはレコードごとの
  // メディア種別そのものへ戻った（__multi 撤去）
  test('media は image/video/gif のみ', () => {
    expect(qfValues('media').map((r) => r.v)).toEqual(['image', 'video', 'gif']);
  });

  test('media の count', () => {
    const media = qfValues('media');
    expect(media[0].count).toBe(2);
    expect(media[1].count).toBe(1);
  });
});

// 一般タグのみ・種別付き除外・「タグなし」先頭固定・present 先行
describe('qfValues: tag', () => {
  test('種別付きタグは出さない', () => {
    const vs = qfValues('tag').map((r) => r.v);
    expect(vs).not.toContain('作品A');
    expect(vs).not.toContain('キャラX');
  });

  test('見出し行を持たない（フラット）', () => {
    expect(qfValues('tag').every((r) => r.ghead == null)).toBe(true);
  });

  // 連続タグ付けの入口なので count 順に混ぜず先頭へ固定する（P2⑬）
  test('「タグなし」が先頭に固定される', () => {
    expect(qfValues('tag')[0]).toMatchObject({ v: '__none', l: 'タグなし' });
  });

  test('「タグなし」の count は tags が空の投稿（filtered 由来）', () => {
    // filtered = 先頭3件。うち tags が空なのは misskey の1件だけ。
    expect(qfValues('tag')[0].count).toBe(1);
  });

  test('「タグなし」が選択中なら on になる', () => {
    active.add('tag:__none');
    try {
      expect(qfValues('tag')[0].on).toBe(true);
    } finally {
      active.delete('tag:__none');
    }
  });

  test('present 先行（風景 count=2 が「タグなし」の次）', () => {
    expect(qfValues('tag')[1]).toMatchObject({ v: '風景', count: 2 });
  });

  test('未分類タグも一覧に含む', () => {
    expect(qfValues('tag').map((r) => r.v)).toContain('未分類タグ');
  });
});

describe('qfValues: work / character（用語帳）', () => {
  test('work は種別スコープ＋type=tag', () => {
    expect(qfValues('work')).toEqual([expect.objectContaining({ v: '作品A', type: 'tag', count: 1 })]);
  });

  test('character も種別スコープ（filtered 外は count 0）', () => {
    expect(qfValues('character')).toEqual([expect.objectContaining({ v: 'キャラX', count: 0 })]);
  });
});

describe('qfValues: hashtag / user / instance', () => {
  test('hashtag は # ラベル＋count 降順', () => {
    const h = qfValues('hashtag');
    expect(h[0]).toMatchObject({ l: '#art', count: 2 });
    expect(h[1].count).toBe(1);
  });

  test('user の表示名は displayName→screenName へフォールバック', () => {
    const labels = qfValues('user').map((r) => r.l);
    expect(labels).toContain('アリス');
    expect(labels.some((l) => l === 'bob' || l === 'carol')).toBe(true);
  });

  test('user の count は filtered の userKey 集計', () => {
    expect(qfValues('user').find((r) => r.v === 'x:u1')?.count).toBe(1);
  });

  test('instance は misskey/mastodon のホストを列挙し present 先行', () => {
    const i = qfValues('instance');
    expect(i.map((r) => r.v).sort()).toEqual(['misskey.io', 'mstdn.jp']);
    expect(i[0]).toMatchObject({ v: 'misskey.io', count: 1 });
  });
});

// postFolders は posterFolders とは別の dep。スタブが渡していなかった間ここは一度も
// 呼ばれておらず、型検査の対象外だったので誰も気づかなかった（#635）。
describe('qfValues: folder（投稿フォルダ）', () => {
  test('ラベルはパス・count はサブツリー小計（#41）', () => {
    // filtered＝先頭3件（c1/c2/c3）。親は自分の c1 ＋ 子の c2 で 2、子は c2 だけで 1。
    expect(qfValues('folder')).toEqual([expect.objectContaining({ v: 'f-parent', l: '親', count: 2 }), expect.objectContaining({ v: 'f-child', l: '親 / 子', count: 1 })]);
  });
});

describe('qfValues: poster-*', () => {
  test('poster-tag は一般のみ＋poster 側のクエリ状態を反映', () => {
    expect(qfValues('poster-tag')).toEqual([expect.objectContaining({ v: 'P趣味', on: true, count: 2 })]);
  });

  test('poster-work は種別スコープ', () => {
    expect(qfValues('poster-work')).toEqual([expect.objectContaining({ v: 'P作品', kind: 'work' })]);
  });

  test('poster-platform は PF_ORDER 順（x が先頭）', () => {
    const pp = qfValues('poster-platform');
    expect(pp).toHaveLength(3);
    expect(pp.map((r) => r.v).slice(0, 2)).toEqual(['x', 'misskey']);
  });

  test('poster-instance はホストを列挙し facetDim を持つ', () => {
    const pi = qfValues('poster-instance');
    expect(pi).toHaveLength(2);
    expect(pi.every((r) => r.facetDim)).toBe(true);
  });

  test('poster-folder の count はメンバー数', () => {
    expect(qfValues('poster-folder')).toEqual([expect.objectContaining({ l: '推し', count: 2 })]);
  });
});

test('未知のカテゴリは []', () => {
  expect(qfValues('nonsense')).toEqual([]);
});

// 空振りする行は並べない＝プラットフォームなしと同じ規則。ライブラリ全体を見て決めるので、
// 別の makeFacets を立てて「全件にタグがある」状態を作る。
test('タグの無い投稿が1件も無ければ「タグなし」を出さない', () => {
  const tagged = posts.map((p) => ({ ...p, tags: p.tags && p.tags.length ? p.tags : ['何かのタグ'] }));
  const { qfValues: qv } = makeFacets({
    getFilteredPosts: () => tagged,
    qHasValue: () => false,
    posterQHasValue: () => false,
    allPosts: () => tagged,
    hostOf: () => '',
    userKey: (p) => String(p.platform),
    t: (key: string) => LABELS[key],
    PF_NAME: { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' },
    tagKindOf: (t: string) => KIND[t],
    posterTagsOf: () => [],
    filteredPosters: () => [],
    posterFilterVocab: () => [],
    namedPosters: () => [],
    posterFolders: () => [],
    postFolders: () => [],
    buildUsers: () => [],
  });
  expect(qv('tag').map((r) => r.v)).not.toContain('__none');
});
