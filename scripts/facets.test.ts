// Logic unit test for facets.ts. Directly verifies facetCounts (bucket
// aggregation) and qfValues (the 15-category flyout row model) via stub deps injection.

import { describe, expect, test } from 'vitest';
import { makeFacets } from '../app/src/renderer/src/services/facets';

// --- stub environment: 6 posts (x2, misskey1, mastodon1, pixiv1, no-platform1) ---
const posts = [
  { captureId: 'c1', url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景', '作品A'], hashtags: ['art'], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
  { captureId: 'c2', url: 'https://x.com/b/status/2', platform: 'x', userId: 'u2', screenName: 'bob', displayName: '', tags: ['風景'], hashtags: ['art', 'wip'], mediaType: 'video', isReply: true, isQuote: false, isThread: false },
  { captureId: 'c3', url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', tags: [], hashtags: [], mediaType: 'image', isReply: false, isQuote: true, isThread: false },
  { captureId: 'c4', url: 'https://mstdn.jp/@d/3', platform: 'mastodon', userId: 'u4', screenName: 'dan', tags: ['キャラX'], hashtags: [], mediaType: 'gif', isReply: false, isQuote: false, isThread: true },
  { captureId: 'c5', url: 'https://www.pixiv.net/artworks/9', platform: 'pixiv', userId: 'u5', screenName: 'eve', tags: ['未分類タグ'], hashtags: [], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
  { captureId: 'c6', url: null, platform: null, tags: ['風景'], hashtags: [], mediaType: 'image', isReply: false, isQuote: false, isThread: false },
];
// The current query's population = assumed narrowed down to just the first 3 (facet count is counted from these)
const filtered = posts.slice(0, 3);

const active = new Set(['platform:x', 'tag:風景']);
const posterActive = new Set(['tag:P趣味']);
const KIND: Record<string, string> = { 作品A: 'work', キャラX: 'character', P作品: 'work' };

// A poster aggregate requires all 13 fields (HologramUserAgg) = this overrides
// only the parts facet reads, filling the rest with empty values. Placing a
// partial object directly wouldn't match the deps contract.
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
// Post folders (folders.json) are a dep separate from poster folders. Since it
// also counts subtotals under a parent (#41), give it one parent/child pair so
// "row label = path / count = subtree" can be observed.
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
    // The 2-argument overload is only for the poster pool (facets.ts's contract) = the poster-* rows go through here.
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

  // Multi-image moved to its own independent toggle row on the sidebar side = the
  // media flyout went back to being just each record's own media type (__multi removed)
  test('media は image/video/gif のみ', () => {
    expect(qfValues('media').map((r) => r.v)).toEqual(['image', 'video', 'gif']);
  });

  test('media の count', () => {
    const media = qfValues('media');
    expect(media[0].count).toBe(2);
    expect(media[1].count).toBe(1);
  });
});

// General tags only, kind-tagged ones excluded, "no tags" pinned first, present ones lead
describe('qfValues: tag', () => {
  test('種別付きタグは出さない', () => {
    const vs = qfValues('tag').map((r) => r.v);
    expect(vs).not.toContain('作品A');
    expect(vs).not.toContain('キャラX');
  });

  test('見出し行を持たない（フラット）', () => {
    expect(qfValues('tag').every((r) => r.ghead == null)).toBe(true);
  });

  // Since it's the entry point for tagging in succession, pin it first instead of mixing it into the count order (P2-13)
  test('「タグなし」が先頭に固定される', () => {
    expect(qfValues('tag')[0]).toMatchObject({ v: '__none', l: 'タグなし' });
  });

  test('「タグなし」の count は tags が空の投稿（filtered 由来）', () => {
    // filtered = the first 3. Of those, only the one misskey post has empty tags.
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

// postFolders is a dep separate from posterFolders. While the stub wasn't passing
// it, this was never called even once, and since it was outside typecheck's reach, no one noticed (#635).
describe('qfValues: folder（投稿フォルダ）', () => {
  test('ラベルはパス・count はサブツリー小計（#41）', () => {
    // filtered = the first 3 (c1/c2/c3). The parent is its own c1 + the child's c2 = 2; the child is just c2 = 1.
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

// A row that would come up empty isn't listed = the same rule as "no platform".
// Since this is decided by looking at the whole library, set up a separate
// makeFacets to create a state where "every post has a tag".
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
