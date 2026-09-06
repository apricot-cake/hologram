// facets.ts のロジック単体テスト。スタブの deps を差し込んで、facetCounts（バケット集計）と
// qfValues（15カテゴリのフライアウト行モデル）を直接検証する。

import { describe, expect, test } from 'vitest';
import { makeFacets } from '../app/src/renderer/src/services/facets';

// --- スタブ環境: 投稿6件（x2、pixiv2、bluesky1、platform なし1）---
// どれも mediaType と並べて `image` を持たせている（#365 の hasVisualMedia は mediaType では
// なく実際のメディアの欄を読む＝mediaType はあるがファイルの無いフィクスチャは、下の新しい
// 「テキストのみ」バケットに誤って数えられてしまう。本当にどちらも持たないフィクスチャ投稿
// は、その describe ブロックの中にある）。
const posts = [
  { captureId: 'c1', url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景', '作品A'], hashtags: ['art'], mediaType: 'image', image: 'c1.jpg', isReply: false, isQuote: false, isThread: false },
  { captureId: 'c2', url: 'https://x.com/b/status/2', platform: 'x', userId: 'u2', screenName: 'bob', displayName: '', tags: ['風景'], hashtags: ['art', 'wip'], mediaType: 'video', video: 'c2.mp4', isReply: true, isQuote: false, isThread: false },
  { captureId: 'c3', url: 'https://www.pixiv.net/artworks/8', platform: 'pixiv', userId: 'u3', screenName: 'u3', tags: [], hashtags: [], mediaType: 'image', image: 'c3.jpg', isReply: false, isQuote: true, isThread: false },
  { captureId: 'c4', url: 'https://bsky.app/profile/dan.bsky.social/post/3abc', platform: 'bluesky', userId: 'u4', screenName: 'dan.bsky.social', tags: ['キャラX'], hashtags: [], mediaType: 'gif', media: [{ file: 'c4.mp4' }], isReply: false, isQuote: false, isThread: true },
  { captureId: 'c5', url: 'https://www.pixiv.net/artworks/9', platform: 'pixiv', userId: 'u5', screenName: 'eve', tags: ['未分類タグ'], hashtags: [], mediaType: 'image', image: 'c5.jpg', isReply: false, isQuote: false, isThread: false },
  { captureId: 'c6', url: null, platform: null, tags: ['風景'], hashtags: [], mediaType: 'image', image: 'c6.jpg', isReply: false, isQuote: false, isThread: false },
];
// 現在のクエリの母集団＝先頭3件だけに絞り込まれた想定（ファセットの件数はここから数える）
const filtered = posts.slice(0, 3);

const active = new Set(['platform:x', 'tag:風景']);
// #810: 投稿者のタグ行は tags テーブルの1行を指すので、投稿者ツリーの「点いているか」も実体で
// 引く＝投稿側の tag#<id> と同じ形。
const PID = { P趣味: 101, P作品: 102 };
const posterActive = new Set([`tag#${PID.P趣味}`]);
// 下の投稿フィクスチャは tagIds を持たないので、その行は名前の一致に退避し、種別も名前の側から
// 読む。投稿者フィクスチャは実体なので id から読む（#810。facets.ts の entryKind が行ごとに
// 選ぶ）。
const KIND: Record<string, string> = { 作品A: 'work', キャラX: 'character', P作品: 'work' };
const KIND_BY_ID: Record<number, string> = { [PID.P作品]: 'work' };
const entry = (id: number | null, name: string, label = name): HologramTagEntry => ({ id, name, label });

// 投稿者の集計は13の欄（HologramUserAgg）をすべて要求する＝ここではファセットが読む部分だけ
// を上書きし、残りは空の値で埋める。部分的なオブジェクトを直接置くと deps の取り決めに合わない。
const userAgg = (u: Partial<HologramUserAgg>): HologramUserAgg => ({
  key: '',
  platform: '',
  screenName: '',
  displayName: '',
  bio: '',
  avatarFile: '',
  bannerFile: '',
  followers: null,
  following: null,
  authorCreatedAt: '',
  profileHistory: [],
  followerRank: null,
  followerPopulation: 0,
  followerPercentile: null,
  latest: '',
  firstPost: '',
  lastCapture: '',
  firstCapture: '',
  count: 0,
  members: [],
  platforms: [],
  ...u,
});

const posters = [userAgg({ key: 'x:u1', platform: 'x', screenName: 'alice', displayName: 'アリス', count: 3 }), userAgg({ key: 'pixiv:u3', platform: 'pixiv', screenName: 'carol', count: 2 }), userAgg({ key: 'bluesky:u4', platform: 'bluesky', screenName: 'dan.bsky.social', count: 1 })];
const posterTagEntries: Record<string, HologramTagEntry[]> = {
  'x:u1': [entry(PID.P趣味, 'P趣味'), entry(PID.P作品, 'P作品')],
  'pixiv:u3': [entry(PID.P趣味, 'P趣味')],
  'bluesky:u4': [],
};
const posterVocab = [entry(PID.P作品, 'P作品'), entry(PID.P趣味, 'P趣味')];
// 投稿フォルダ（folders.json）は投稿者フォルダとは別の dep。親の下の小計も数える（#41）ので、
// 親子を1組だけ与えて「行のラベル＝パス、count＝サブツリー」を観察できるようにする。
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
  qfMediaNone: 'テキストのみ',
  qfMultiImage: '複数画像',
  qfSiteNone: 'なし',
  qfTagNone: 'タグなし',
};

// 母集団は差し込めるようにしてある（既定は `filtered`）。基本のフィクスチャ集合に無い投稿
// （下の #195 の bookmark 種別の件数）を、他の欄をすべて写した2つ目の deps を手で書かずに
// 観察するため。
function makeFacetsWith(pop: any[]) {
  return makeFacets({
    getFilteredPosts: () => pop,
    qHasValue: (t, v) => active.has(`${t}:${v}`),
    // 実際の sameLeaf の規則（#774）に合わせる。実体を知っている葉は id で一致させ、
    // 持たない葉だけが名前に退避する。
    qHasTag: (id, name) => (id != null && active.has(`tag#${id}`)) || active.has(`tag:${name}`),
    posterQHasValue: (t, v) => posterActive.has(`${t}:${v}`),
    posterQHasTag: (id, name) => (id != null && posterActive.has(`tag#${id}`)) || posterActive.has(`tag:${name}`),
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
    PF_NAME: { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' },
    tagKindOf: (id) => (id != null ? KIND_BY_ID[id] : undefined),
    tagKindOfName: (t: string) => KIND[t],
    posterTagEntriesOf: (key: string) => posterTagEntries[key] || [],
    filteredPosters: () => posters,
    posterFilterVocab: () => posterVocab,
    namedPosters: () => posters,
    postFolders: () => postFolders,
    buildUsers: () => posters,
    resolve: (key: string) => key, // #23 St1
    membersOf: (key: string) => [key], // #23 St1
  });
}
const { facetCounts, qfValues } = makeFacetsWith(filtered);

describe('facetCounts', () => {
  test('既定の母集団は filtered', () => {
    const m = facetCounts((p) => p.platform || '__none');
    expect(m.get('x')).toBe(2);
    expect(m.get('pixiv')).toBe(1);
    expect(m.has('bluesky')).toBe(false);
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
    // 2引数のオーバーロードは投稿者プール専用（facets.ts の取り決め）＝poster-* の行はここを通る。
    const pool = facetCounts((u) => u.platform, posters.slice(1));
    expect(pool.get('pixiv')).toBe(1);
    expect(pool.get('bluesky')).toBe(1);
    expect(pool.has('x')).toBe(false);
  });
});

describe('qfValues: kind / platform', () => {
  test('kind は2値（post/image）でラベル・カウントつき', () => {
    const rows = qfValues('kind');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ v: 'post', l: 'SNS投稿' });
    expect(rows[1]).toMatchObject({ v: 'image', l: '画像' });
  });

  test('platform の主行は 3PF + なし', () => {
    const main = qfValues('platform').filter((r) => !r.sub);
    expect(main).toHaveLength(4);
    expect(main[3].v).toBe('__none');
  });

  test('platform の on にアクティブ状態が出る', () => {
    const main = qfValues('platform').filter((r) => !r.sub);
    expect(main[0]).toMatchObject({ v: 'x', on: true });
    expect(main[1].on).toBe(false);
  });

  test('platform の count は filtered 由来', () => {
    const main = qfValues('platform').filter((r) => !r.sub);
    expect(main[0].count).toBe(2);
    expect(main.find((r) => r.v === 'bluesky')?.count).toBe(0);
  });

  test('platform にインスタンスサブ行はない', () => {
    expect(qfValues('platform').filter((r) => r.sub)).toEqual([]);
  });
});

// #253: 未対応ドメインの行と、絞り込まれた「出自なし」バケット。platform を持たないが解決でき
// る URL は必ず持つ投稿が要るので、別のフィクスチャ（makeFacets を独立に作る。下の「タグの無い
// 投稿が1件も無い」テストと同じやり方）にする＝上の主フィクスチャは platform なしの投稿が1件し
// かなく、それは URL を一切持たない（c6）ため、ドメインの経路を通らない。
describe('qfValues: platform のドメイン行（#253）', () => {
  const domainPosts = [
    { captureId: 'd1', url: 'https://x.com/a/status/1', platform: 'x' },
    { captureId: 'd2', url: 'https://www.youtube.com/watch?v=1', platform: null },
    { captureId: 'd3', url: 'https://youtube.com/watch?v=2', platform: null },
    { captureId: 'd4', url: 'https://note.com/a/n/1', platform: null },
    { captureId: 'd5', url: null, platform: null },
  ];
  const domainFiltered = domainPosts.slice(0, 4); // url を持たない d5 以外のすべて
  const { qfValues: qv } = makeFacets({
    getFilteredPosts: () => domainFiltered,
    qHasValue: () => false,
    qHasTag: () => false,
    posterQHasValue: () => false,
    posterQHasTag: () => false,
    allPosts: () => domainPosts,
    hostOf: (url) => {
      try {
        return new URL(url ?? '').hostname;
      } catch {
        return '';
      }
    },
    userKey: (p) => String(p.platform),
    t: (key: string) => LABELS[key],
    PF_NAME: { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' },
    tagKindOf: () => undefined,
    tagKindOfName: () => undefined,
    posterTagEntriesOf: () => [],
    filteredPosters: () => [],
    posterFilterVocab: () => [],
    namedPosters: () => [],
    postFolders: () => [],
    buildUsers: () => [],
    resolve: (key: string) => key,
    membersOf: (key: string) => [key],
  });

  test('www. を畳んで1行に統合する（youtube.com が2件）', () => {
    const domainRows = qv('platform').filter((r) => r.type === 'domain');
    expect(domainRows).toHaveLength(2); // youtube.com（2件統合）, note.com
    expect(domainRows.find((r) => r.v === 'youtube.com')?.count).toBe(2);
    expect(domainRows.map((r) => r.v)).not.toContain('www.youtube.com');
  });

  test('件数降順（同数はアルファベット順）', () => {
    const domainRows = qv('platform').filter((r) => r.type === 'domain');
    expect(domainRows.map((r) => r.v)).toEqual(['youtube.com', 'note.com']);
  });

  test('platform 済みレコードのドメインは列挙しない（二重掲載の除外）', () => {
    const domainRows = qv('platform').filter((r) => r.type === 'domain');
    expect(domainRows.map((r) => r.v)).not.toContain('x.com');
  });

  test('facetDim を持つ（他の自由語彙行と同じ扱い）', () => {
    const domainRows = qv('platform').filter((r) => r.type === 'domain');
    expect(domainRows.every((r) => r.facetDim)).toBe(true);
  });

  test('「出自なし」は URL の無いレコードだけ（ドメイン持ちは含まない）', () => {
    const none = qv('platform').find((r) => r.v === '__none');
    expect(none).toMatchObject({ l: 'なし', count: 0 }); // d5 は domainFiltered に含まれない
  });

  test('「出自なし」の label キーは qfSiteNone', () => {
    // LABELS には qfPlatformNone が無い（改名済み）＝qfSiteNone だけが解決される。
    const none = qv('platform').find((r) => r.v === '__none');
    expect(none?.l).toBe('なし');
  });
});

describe('qfValues: postType / media', () => {
  test('postType は多重バケット', () => {
    const by = Object.fromEntries(qfValues('postType').map((r) => [r.v, r.count]));
    expect(by).toMatchObject({ post: 1, reply: 1, quote: 1, thread: 0 });
  });

  // 複数画像はサイドバー側の独立したトグル行へ移した＝media のフライアウトは各レコード自身の
  // メディア種別だけに戻った（__multi は削除）
  test('media は image/video/gif のみ', () => {
    expect(qfValues('media').map((r) => r.v)).toEqual(['image', 'video', 'gif']);
  });

  test('media の count', () => {
    const media = qfValues('media');
    expect(media[0].count).toBe(2);
    expect(media[1].count).toBe(1);
  });

  // #365: メディアを一切持たないレコードのための4本目の行。ライブラリに実際に1件も無ければ出さ
  // ない（「空になるものは並べない」という「platform なし」「タグなし」と同じ規則）。mediaType
  // だけでは見つけられない（mediaType はあるが image/video/media のファイルが無いフィクスチャ
  // は、このバケットではない＝基本フィクスチャ自身のコメントを見よ）。makeFacets を別に作る
  // （上のドメイン行のブロックと同じ理由）。行が出るには、数える対象のプールだけでなく
  // allPosts の側にテキストのみのレコードが実際に含まれている必要がある。
  describe('テキストのみ行（__none, #365）', () => {
    test('該当レコードが無ければ出ない', () => {
      expect(qfValues('media').map((r) => r.v)).not.toContain('__none');
    });

    test('該当レコードがあれば出る。判定は mediaType でなく image/video/media の実体', () => {
      const textOnly = { captureId: 't1', url: 'https://x.com/a/status/9', platform: 'x', text: 'hello', tags: [], hashtags: [], mediaType: null };
      const withText = [...posts, textOnly];
      const { qfValues: qf2 } = makeFacets({
        getFilteredPosts: () => withText,
        qHasValue: () => false,
        qHasTag: () => false,
        posterQHasValue: () => false,
        posterQHasTag: () => false,
        allPosts: () => withText,
        hostOf: () => '',
        userKey: (p) => String(p.platform),
        t: (key: string) => LABELS[key],
        PF_NAME: { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' },
        tagKindOf: () => undefined,
        tagKindOfName: () => undefined,
        posterTagEntriesOf: () => [],
        filteredPosters: () => [],
        posterFilterVocab: () => [],
        namedPosters: () => [],
        postFolders: () => [],
        buildUsers: () => [],
        resolve: (key: string) => key,
        membersOf: (key: string) => [key],
      });
      const row = qf2('media').find((r) => r.v === '__none');
      expect(row).toMatchObject({ l: 'テキストのみ', count: 1 });
    });
  });
});

// 一般タグのみ。種別付きは除外し、「タグなし」を先頭に固定して、present を先行させる
describe('qfValues: tag', () => {
  test('種別付きタグは出さない', () => {
    const vs = qfValues('tag').map((r) => r.v);
    expect(vs).not.toContain('作品A');
    expect(vs).not.toContain('キャラX');
  });

  test('見出し行を持たない（フラット）', () => {
    expect(qfValues('tag').every((r) => r.ghead == null)).toBe(true);
  });

  // 続けてタグ付けするときの入口なので、件数順に混ぜず先頭へ固定する (P2-13)
  test('「タグなし」が先頭に固定される', () => {
    expect(qfValues('tag')[0]).toMatchObject({ v: '__none', l: 'タグなし' });
  });

  test('「タグなし」の count は tags が空の投稿（filtered 由来）', () => {
    // filtered は先頭3件。そのうち tags が空なのは pixiv の投稿1件だけ。
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

// #774: レコードが effective 系の配列を持つようになると、タグの行は名前ではなく tags テーブルの
// 1行を指す＝件数には子孫だけを持つ投稿も入り、名前を共有する2つの実体は2行になる。
describe('qfValues: tag（実体キー・親子適用）', () => {
  const ID = { 東方: 1, レミリア: 2, aliceA: 3, aliceB: 4 };
  // effective* は lib-db-query.ts が導出する3本の並行した配列。
  const entityPosts = [
    { captureId: 'e1', tags: ['レミリア'], tagIds: [ID.レミリア], effectiveTagIds: [ID.レミリア, ID.東方], effectiveTags: ['レミリア', '東方'], effectiveTagLabels: ['レミリア', '東方'] },
    { captureId: 'e2', tags: ['東方'], tagIds: [ID.東方], effectiveTagIds: [ID.東方], effectiveTags: ['東方'], effectiveTagLabels: ['東方'] },
    { captureId: 'e3', tags: ['alice'], tagIds: [ID.aliceA], effectiveTagIds: [ID.aliceA], effectiveTags: ['alice'], effectiveTagLabels: ['alice(東方)'] },
    { captureId: 'e4', tags: ['alice'], tagIds: [ID.aliceB], effectiveTagIds: [ID.aliceB], effectiveTags: ['alice'], effectiveTagLabels: ['alice(紅魔郷)'] },
    { captureId: 'e5', tags: [], tagIds: [], effectiveTagIds: [], effectiveTags: [], effectiveTagLabels: [] },
  ];
  const entityActive = new Set<string>();
  const { qfValues: qf } = makeFacets({
    getFilteredPosts: () => entityPosts,
    qHasValue: (t, v) => entityActive.has(`${t}:${v}`),
    qHasTag: (id, name) => (id != null && entityActive.has(`tag#${id}`)) || entityActive.has(`tag:${name}`),
    posterQHasValue: () => false,
    posterQHasTag: () => false,
    allPosts: () => entityPosts,
    hostOf: () => '',
    userKey: () => '',
    t: (key: string) => LABELS[key],
    PF_NAME: {},
    tagKindOf: () => undefined,
    tagKindOfName: () => undefined,
    posterTagEntriesOf: () => [],
    filteredPosters: () => [],
    posterFilterVocab: () => [],
    namedPosters: () => [],
    postFolders: () => [],
    buildUsers: () => [],
    resolve: (key: string) => key,
    membersOf: (key: string) => [key],
  });
  const rowFor = (tagId: number) => qf('tag').find((r) => r.tagId === tagId);

  test('親タグの件数に、子タグだけの投稿が数えられる', () => {
    // e1 が持つのは レミリア だけ、e2 は 東方 自体を持つ → 親の行は両方を数える。
    expect(rowFor(ID.東方)).toMatchObject({ v: '東方', count: 2 });
    expect(rowFor(ID.レミリア)).toMatchObject({ v: 'レミリア', count: 1 });
  });

  test('同名2実体は2行になり、ラベルで区別される', () => {
    const alices = qf('tag').filter((r) => r.v === 'alice');
    expect(alices).toHaveLength(2);
    expect(new Set(alices.map((r) => r.l))).toEqual(new Set(['alice(東方)', 'alice(紅魔郷)']));
  });

  test('葉が持つ実体だけが on になる（同名のもう一方は消灯）', () => {
    entityActive.add(`tag#${ID.aliceA}`);
    try {
      expect(rowFor(ID.aliceA)?.on).toBe(true);
      expect(rowFor(ID.aliceB)?.on).toBe(false);
    } finally {
      entityActive.delete(`tag#${ID.aliceA}`);
    }
  });

  test('id を持たない葉（移行前の保存検索）は名前で両方を灯す', () => {
    entityActive.add('tag:alice');
    try {
      expect(rowFor(ID.aliceA)?.on).toBe(true);
      expect(rowFor(ID.aliceB)?.on).toBe(true);
    } finally {
      entityActive.delete('tag:alice');
    }
  });

  // #810: Kind は tags の行にぶら下がるので、同じ名前でも一方の実体では作品、もう一方では未分類
  // にできる＝作品セクションに入るのは実体の行であって、名前の行ではない。
  test('同名2実体は別々の Kind を持てる（片方だけが作品セクションに出る）', () => {
    const { qfValues: qk } = makeFacets({
      getFilteredPosts: () => entityPosts,
      qHasValue: () => false,
      qHasTag: () => false,
      posterQHasValue: () => false,
      posterQHasTag: () => false,
      allPosts: () => entityPosts,
      hostOf: () => '',
      userKey: () => '',
      t: (key: string) => LABELS[key],
      PF_NAME: {},
      tagKindOf: (id) => (id === ID.aliceA ? 'work' : undefined),
      tagKindOfName: () => undefined,
      posterTagEntriesOf: () => [],
      filteredPosters: () => [],
      posterFilterVocab: () => [],
      namedPosters: () => [],
      postFolders: () => [],
      buildUsers: () => [],
      resolve: (key: string) => key,
      membersOf: (key: string) => [key],
    });
    expect(qk('work').map((r) => r.tagId)).toEqual([ID.aliceA]);
    // …もう一方は一般タグのままなので、tag の行はそれを保持する。
    expect(qk('tag').map((r) => r.tagId)).toContain(ID.aliceB);
    expect(qk('tag').map((r) => r.tagId)).not.toContain(ID.aliceA);
  });

  test('行は v=名前 / tagId=実体を運ぶ（選択時に葉へ渡すため）', () => {
    expect(rowFor(ID.東方)).toMatchObject({ v: '東方', tagId: ID.東方 });
  });

  test('「タグなし」は生タグが空の投稿だけを数える（親の含意で埋まらない）', () => {
    expect(qf('tag')[0]).toMatchObject({ v: '__none', count: 1 });
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

  test('instance は廃止済み', () => {
    expect(qfValues('instance')).toEqual([]);
  });
});

// postFolders は posterFolders とは別の dep。スタブがこれを渡していなかった間、一度も呼ばれず、
// typecheck の届かない場所だったので誰も気づかなかった (#635)。
describe('qfValues: folder（投稿フォルダ）', () => {
  test('ラベルはパス・count はサブツリー小計（#41）', () => {
    // filtered は先頭3件 (c1/c2/c3)。親は自身の c1 と子の c2 で2、子は c2 だけで1。
    expect(qfValues('folder')).toEqual([expect.objectContaining({ v: 'f-parent', l: '親', count: 2 }), expect.objectContaining({ v: 'f-child', l: '親 / 子', count: 1 })]);
  });
});

describe('qfValues: poster-*', () => {
  test('poster-tag は一般のみ＋poster 側のクエリ状態を反映', () => {
    expect(qfValues('poster-tag')).toEqual([expect.objectContaining({ v: 'P趣味', tagId: PID.P趣味, on: true, count: 2 })]);
  });

  test('poster-work は種別スコープ', () => {
    expect(qfValues('poster-work')).toEqual([expect.objectContaining({ v: 'P作品', tagId: PID.P作品, kind: 'work' })]);
  });

  // #810: 投稿者の行も、上の投稿側のタグ行とまったく同じく、あくまで実体ごとになった＝同名の
  // 投稿者タグ2つは2行になり、行の「on」は名前ではなく葉の id に従う。
  test('ポスター側も同名2実体が2行になり、葉の実体だけが on になる', () => {
    const A = 201;
    const B = 202;
    const entries = [entry(A, 'alice', 'alice(東方)'), entry(B, 'alice', 'alice(紅魔郷)')];
    const on = new Set([`tag#${A}`]);
    const { qfValues: qv } = makeFacets({
      getFilteredPosts: () => [],
      qHasValue: () => false,
      qHasTag: () => false,
      posterQHasValue: () => false,
      posterQHasTag: (id) => id != null && on.has(`tag#${id}`),
      allPosts: () => [],
      hostOf: () => '',
      userKey: () => '',
      t: (key: string) => LABELS[key],
      PF_NAME: {},
      tagKindOf: () => undefined,
      tagKindOfName: () => undefined,
      posterTagEntriesOf: (key: string) => (key === 'p1' ? [entries[0]] : [entries[1]]),
      filteredPosters: () => [userAgg({ key: 'p1' }), userAgg({ key: 'p2' })],
      posterFilterVocab: () => entries,
      namedPosters: () => [],
      postFolders: () => [],
      buildUsers: () => [],
      resolve: (key: string) => key,
      membersOf: (key: string) => [key],
    });
    // 行の並びはファセット自身のもの（count 降順、同数はラベルの日本語照合）。ここで見たいのは
    // 2つの実体がどちらも出て、区別されていること。
    const rows = qv('poster-tag');
    expect(new Set(rows.map((r) => r.l))).toEqual(new Set(['alice(東方)', 'alice(紅魔郷)']));
    expect(rows.find((r) => r.tagId === A)).toMatchObject({ v: 'alice', on: true, count: 1 });
    expect(rows.find((r) => r.tagId === B)).toMatchObject({ v: 'alice', on: false, count: 1 });
  });

  test('poster-platform は PF_ORDER 順（x が先頭）', () => {
    const pp = qfValues('poster-platform');
    expect(pp).toHaveLength(3);
    expect(pp.map((r) => r.v).slice(0, 2)).toEqual(['x', 'bluesky']);
  });
});

// #23 St1: resolve/membersOf は、合流した投稿者の生の posterKeys をそのグループの primary へ畳
// む＝恒等でない resolve を持つ makeFacets を別に作る。上の他の独立したフィクスチャ（#253 のド
// メイン行、空の「タグなし」行）が、共有のものを書き換えずそれぞれ自前のインスタンスを持つのと
// 同じ。
describe('名寄せ（resolve/membersOf, #23 St1）', () => {
  // x:u1 と pixiv:u3 は合流済み（primary は x:u1）＝buildUsers() が既に 'x:u1' をキーとする
  // 1つの HologramUserAgg 行へ畳んでいるのに合わせる。
  const groupMembers: Record<string, string[]> = { 'x:u1': ['x:u1', 'pixiv:u3'], 'pixiv:u3': ['x:u1', 'pixiv:u3'] };
  const resolveAlias = (key: string) => (key === 'pixiv:u3' ? 'x:u1' : key);
  const mergedPosters = [posters[0], posters[2]]; // x:u1（畳んだ後）と bluesky:u4。pixiv:u3 はもう独立した行ではない
  const { qfValues: qv } = makeFacets({
    getFilteredPosts: () => filtered,
    qHasValue: () => false,
    qHasTag: () => false,
    posterQHasValue: () => false,
    posterQHasTag: () => false,
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
    PF_NAME: { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' },
    tagKindOf: (id) => (id != null ? KIND_BY_ID[id] : undefined),
    tagKindOfName: (t: string) => KIND[t],
    posterTagEntriesOf: (key: string) => posterTagEntries[key] || [],
    filteredPosters: () => mergedPosters,
    posterFilterVocab: () => posterVocab,
    namedPosters: () => mergedPosters,
    // secondary のキー（pixiv:u3）だけに記録されたフォルダ。合流前のライブラリが持つ形で、
    // x:u1 と pixiv:u3 が同じ行になる前にトグルされたもの。
    postFolders: () => postFolders,
    buildUsers: () => mergedPosters,
    resolve: resolveAlias,
    membersOf: (key: string) => groupMembers[key] || [key],
  });

  test("'user' の count は resolve 後のキーへ畳まれる（c1=x:u1 と c3=pixiv:u3 が合算）", () => {
    expect(qv('user').find((r) => r.v === 'x:u1')?.count).toBe(2);
  });
});

test('未知のカテゴリは []', () => {
  expect(qfValues('nonsense')).toEqual([]);
});

// 空になる行は並べない＝「platform なし」と同じ規則。これはライブラリ全体を見て決まるので、
// 「どの投稿にもタグがある」状態を作るために makeFacets を別に用意する。
test('タグの無い投稿が1件も無ければ「タグなし」を出さない', () => {
  const tagged = posts.map((p) => ({ ...p, tags: p.tags && p.tags.length ? p.tags : ['何かのタグ'] }));
  const { qfValues: qv } = makeFacets({
    getFilteredPosts: () => tagged,
    qHasValue: () => false,
    qHasTag: () => false,
    posterQHasValue: () => false,
    posterQHasTag: () => false,
    allPosts: () => tagged,
    hostOf: () => '',
    userKey: (p) => String(p.platform),
    t: (key: string) => LABELS[key],
    PF_NAME: { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' },
    tagKindOf: (id) => (id != null ? KIND_BY_ID[id] : undefined),
    tagKindOfName: (t: string) => KIND[t],
    posterTagEntriesOf: () => [],
    filteredPosters: () => [],
    posterFilterVocab: () => [],
    namedPosters: () => [],
    postFolders: () => [],
    buildUsers: () => [],
    resolve: (key: string) => key,
    membersOf: (key: string) => [key],
  });
  expect(qv('tag').map((r) => r.v)).not.toContain('__none');
});
