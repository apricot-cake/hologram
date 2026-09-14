import { searchFields } from '../../../shared/search-fields.ts';
const searchValues = (p: HologramPost) => Object.values(searchFields(p));
import { postView } from '../../../../../tests/helpers/test-post-view.ts';
// query.ts のロジック単体テスト。条件木の評価（evalNode）、葉ごとの述語
// （makePostPredOf / makePosterPredOf）、ローカル日の日付境界（localDayRange）、
// 移行ヘルパ facetTreeFrom、木の変異ドメイン、ファセットのドメインを直接確かめる。

import { beforeEach, describe, expect, test } from 'vitest';
import * as Q from './query';
import * as R from './records';

// これらのフィクスチャを「たまたま通る形」でなく契約にしているのが戻り値の型。
// 型注釈が無いと `kind` が `string` へ広がり、どの呼び出し側も
// HologramQueryLeaf / HologramQueryGroup に黙って一致しなくなる (#635)。
const leaf = (type: string, value?: unknown, extra?: object): HologramQueryLeaf => ({ kind: 'cond', type, value, ...extra });
const group = (op: 'and' | 'or', children: HologramQueryNode[], neg?: boolean): HologramQueryGroup => ({ kind: 'group', op, neg: !!neg, children });
const dLocal = (s: string) => new Date(s); // ローカル時刻として解釈した Date で投稿を組む

const post = (over?: object) =>
  postView(
    Object.assign(
      {
        captureId: 'cap-1',
        url: 'https://bsky.app/profile/neko.bsky.social/post/abc',
        platform: 'bluesky',
        userId: 'u123',
        screenName: 'neko',
        displayName: '猫の人',
        text: 'こんにちは世界',
        title: '',
        tags: ['作画'],
        hashtags: ['drawing'],
        mediaType: 'image',
        likes: 12,
        isReply: false,
        isQuote: false,
        isThread: false,
        date: '2026-05-10T12:34:00Z',
      },
      over || {},
    ),
  );

// 依存はスタブとして注入する（フォルダの所属判定 / スマートマッチ）
const folders = new Map([['col-1', new Set(['cap-in'])]]);
let searchCalls: string[];
let predOf: (leaf: any) => (p: any) => boolean;

beforeEach(() => {
  searchCalls = [];
  predOf = Q.makePostPredOf({
    isInFolder: (id: string, cap: string) => !!folders.get(id)?.has(cap),
    // スマートマッチを単純化したスタブ＝'ﾈｺ' だけを 'ネコ' へ正規化する部分一致。
    // 素の includes では絶対に当たらない問い合わせと組み合わせ、注入した側を本当に
    // 通ったことの証明にする
    postMatcher: (q: string) => {
      searchCalls.push(q);
      const nq = q === 'ﾈｺ' ? 'ネコ' : q;
      return (p: HologramPost) => searchValues(p).join(' ').includes(nq);
    },
  });
});

describe('葉の述語', () => {
  test.each([
    ['kind: post は url あり', { type: 'kind', value: 'post' }, {}],
    ['platform: 一致', { type: 'platform', value: 'bluesky' }, {}],
    ['user: userId 優先キー', { type: 'user', value: 'bluesky:u123' }, {}],
    ['postType: 素の投稿', { type: 'postType', value: 'post' }, {}],
    ['media: 一致', { type: 'media', value: 'image' }, {}],
    ['tag: 含む', { type: 'tag', value: '作画' }, {}],
    ['hashtag: 含む', { type: 'hashtag', value: 'drawing' }, {}],
  ])('%s', (_name, cond, over) => {
    expect(predOf(cond)(post(over))).toBe(true);
  });

  test('kind: image は url なし', () => {
    expect(predOf({ type: 'kind', value: 'image' })(post({ url: '' }))).toBe(true);
  });

  // #365: 'media' の '__none' は「文字だけの投稿」— mediaType 単体では作れない
  // (null は「無い」と「取れなかった」の両方を意味しうる) ので image/video/media
  // の実体を見る。
  describe("media: '__none'（#365 テキストのみ）", () => {
    test('image/video/media のいずれも無ければ真', () => {
      expect(predOf({ type: 'media', value: '__none' })(post({ mediaType: null }))).toBe(true);
    });

    test('mediaType が無くても image があれば偽', () => {
      expect(predOf({ type: 'media', value: '__none' })(post({ mediaType: null, image: 'a.jpg' }))).toBe(false);
    });

    test('media[] にファイルがあれば偽', () => {
      expect(predOf({ type: 'media', value: '__none' })(post({ mediaType: null, media: [{ file: 'a.mp4' }] }))).toBe(false);
    });

    test('通常の media 一致は影響を受けない', () => {
      expect(predOf({ type: 'media', value: 'image' })(post({ mediaType: 'image', image: 'a.jpg' }))).toBe(true);
    });
  });

  describe('Q.hasVisualMedia（#365）', () => {
    test('image/video/media[].file のいずれかがあれば真', () => {
      expect(Q.hasVisualMedia(postView(post({ image: 'a.jpg' })))).toBe(true);
      expect(Q.hasVisualMedia(postView(post({ video: 'a.mp4' })))).toBe(true);
      expect(Q.hasVisualMedia(postView(post({ media: [{ file: 'a.jpg' }] })))).toBe(true);
    });

    test('どれも無ければ偽（mediaType が残っていても見ない）', () => {
      expect(Q.hasVisualMedia(postView(post({ mediaType: 'image' })))).toBe(false);
    });

    test('media[] はファイルを持つ要素が無ければ偽', () => {
      expect(Q.hasVisualMedia(postView(post({ media: [{ alt: 'no file' }] })))).toBe(false);
      expect(Q.hasVisualMedia(postView(post({ media: [] })))).toBe(false);
    });
  });

  test('kindOf は post/image の2値を排他に返す', () => {
    expect(Q.kindOf(postView(post({ url: 'https://x.com/a/status/1' })))).toBe('post');
    expect(Q.kindOf(postView(post({ url: '' })))).toBe('image');
  });

  test('platform: __none はプラットフォーム無し', () => {
    expect(predOf({ type: 'platform', value: '__none' })(post({ platform: '' }))).toBe(true);
  });

  test('user: userId が無ければ @handle へフォールバック', () => {
    expect(predOf({ type: 'user', value: 'x:@neko' })(post({ platform: 'x', userId: '' }))).toBe(true);
  });

  test('postType: リプライ', () => {
    expect(predOf({ type: 'postType', value: 'reply' })(post({ isReply: true }))).toBe(true);
  });

  test('tag: tags が欠けていても落ちずに不一致', () => {
    expect(predOf({ type: 'tag', value: '作画' })(post({ tags: undefined }))).toBe(false);
  });

  // 「タグ無し」(P2⑬)＝タグの名前ではなく「tags が空かどうか」を見る番兵の値
  test('tag: __none は tags が空の投稿だけ', () => {
    expect(predOf({ type: 'tag', value: '__none' })(post({ tags: [] }))).toBe(true);
    expect(predOf({ type: 'tag', value: '__none' })(post({ tags: undefined }))).toBe(true);
    expect(predOf({ type: 'tag', value: '__none' })(post())).toBe(false);
  });

  // tagId 経路へ入る前に答えを返す＝'__none' という名前のタグを実際に探しに行かない
  test('tag: __none は tagIdOf を引かない', () => {
    const calls: string[] = [];
    const p = Q.makePostPredOf({
      isInFolder: () => false,
      tagIdOf: (name: string) => {
        calls.push(name);
        return 7;
      },
    });
    expect(p({ kind: 'cond', type: 'tag', value: '__none' } as any)(post({ tags: [], tagIds: [7] }) as any)).toBe(true);
    expect(calls).toEqual([]);
  });

  // #774: id の照合は実効集合を読む。これが「親タグで検索すると子も出る」を
  // 成り立たせている。下のレコードは自分の tagIds に親の id を一切持っていない。

  test('tag: 実効配列が無い記録は生の tagIds へ落ちる', () => {
    // タグの書き込みが失敗すると導出配列が落ちる（services/posts.ts の applyTagWrite）。
    expect(predOf({ type: 'tag', value: '東方', tagId: 22 })(post({ tags: ['東方'], tagIds: [22] }))).toBe(true);
    expect(predOf({ type: 'tag', value: '東方', tagId: 22 })(post({ tags: ['レミリア'], tagIds: [11] }))).toBe(false);
  });

  test('folder: 注入した依存で判定する', () => {
    expect(predOf({ type: 'folder', value: 'col-1' })(post({ captureId: 'cap-in' }))).toBe(true);
    expect(predOf({ type: 'folder', value: 'col-1' })(post())).toBe(false);
  });
});

describe('user', () => {
  test('投稿者キーの完全一致で判定する', () => {
    const p = Q.makePostPredOf({ isInFolder: () => false });
    expect(p({ kind: 'cond', type: 'user', value: 'bluesky:u123' })(post())).toBe(true);
    expect(p({ kind: 'cond', type: 'user', value: 'x:@other' })(post())).toBe(false);
  });
});

// #42: 廃止した葉の型を読み込み時に直す
describe('normalizeLeaf / normalizeTree', () => {
  test('collection→folder、未知の型は素通し', () => {
    expect(Q.normalizeLeaf({ kind: 'cond', type: 'collection', value: 'x' }).type).toBe('folder');
    expect(Q.normalizeLeaf({ kind: 'cond', type: 'tag', value: 'x' }).type).toBe('tag');
  });

  test('normalizeTree は全ての深さで直す', () => {
    const tree = group('and', [leaf('collection', 'a'), group('or', [leaf('collection', 'b'), leaf('tag', 't')])]);
    Q.normalizeTree(tree);

    const types: string[] = [];
    (function walk(n: any) {
      if (n.kind === 'group') n.children.forEach(walk);
      else types.push(n.type);
    })(tree);

    expect(types.sort()).toEqual(['folder', 'folder', 'tag']);
  });
});

// to は翌日0時の「手前」＝単日レンジがその日を丸ごと覆う
describe('date: ローカル日境界', () => {
  const may10 = { type: 'date', from: '2026-05-10', to: '2026-05-10' };

  test('単日レンジがその日のローカル 23:59 を含む', () => {
    expect(predOf(may10)({ date: dLocal('2026-05-10T23:59:00').toISOString() })).toBe(true);
  });

  test('翌日のローカル 00:00 は含まない', () => {
    expect(predOf(may10)({ date: dLocal('2026-05-11T00:00:00').toISOString() })).toBe(false);
  });

  test('フィールドが欠けていれば不一致', () => {
    expect(predOf(may10)({ date: '' })).toBe(false);
  });

  test('dateField=capturedAt を参照できる', () => {
    expect(predOf({ type: 'date', dateField: 'capturedAt', from: '2026-05-10', to: '2026-05-10' })({ capturedAt: dLocal('2026-05-10T10:00:00').toISOString() })).toBe(true);
  });
});

describe('engagement', () => {
  test('既定は gte', () => {
    expect(predOf({ type: 'engagement', engType: 'likes', min: 10 })(post())).toBe(true);
  });

  test('lte', () => {
    expect(predOf({ type: 'engagement', engType: 'likes', op: 'lte', min: 20 })(post())).toBe(true);
  });

  test('min<=0 は素通し', () => {
    expect(predOf({ type: 'engagement', engType: 'likes', min: 0 })(post({ likes: 0 }))).toBe(true);
  });
});

// #162: 寸法・ファイルサイズファセット。value<=0 は素通し（engagement の min<=0 と同じ規約）、
// 欠損（0/null）は positive/negated どちらでも不一致 — 「確かに満たすものだけ」が安全側。
describe('dimension', () => {
  test('width: 既定は gte', () => {
    expect(predOf({ type: 'dimension', axis: 'width', value: 2000 })(post({ mediaMaxW: 3000, mediaMaxH: 2000 }))).toBe(true);
    expect(predOf({ type: 'dimension', axis: 'width', value: 2000 })(post({ mediaMaxW: 1000, mediaMaxH: 2000 }))).toBe(false);
  });

  test('height: lte', () => {
    expect(predOf({ type: 'dimension', axis: 'height', value: 2000, op: 'lte' })(post({ mediaMaxW: 3000, mediaMaxH: 2000 }))).toBe(true);
    expect(predOf({ type: 'dimension', axis: 'height', value: 2000, op: 'lte' })(post({ mediaMaxW: 3000, mediaMaxH: 3000 }))).toBe(false);
  });

  test('long: 幅・高さの大きい方（縦長・横長どちらも同じ長辺で当たる）', () => {
    expect(predOf({ type: 'dimension', axis: 'long', value: 3000 })(post({ mediaMaxW: 2000, mediaMaxH: 3000 }))).toBe(true);
    expect(predOf({ type: 'dimension', axis: 'long', value: 3000 })(post({ mediaMaxW: 3000, mediaMaxH: 2000 }))).toBe(true);
    expect(predOf({ type: 'dimension', axis: 'long', value: 3001 })(post({ mediaMaxW: 3000, mediaMaxH: 2000 }))).toBe(false);
  });

  test('bytes: mediaMaxBytes を参照する', () => {
    expect(predOf({ type: 'dimension', axis: 'bytes', value: 10485760 })(post({ mediaMaxBytes: 20971520 }))).toBe(true);
    expect(predOf({ type: 'dimension', axis: 'bytes', value: 10485760 })(post({ mediaMaxBytes: 1048576 }))).toBe(false);
  });

  test('value<=0 は素通し', () => {
    expect(predOf({ type: 'dimension', axis: 'width', value: 0 })(post({ mediaMaxW: 0 }))).toBe(true);
  });

  test('欠損（0/null）は不一致 — gte 側', () => {
    expect(predOf({ type: 'dimension', axis: 'width', value: 2000 })(post({ mediaMaxW: 0 }))).toBe(false);
    expect(predOf({ type: 'dimension', axis: 'width', value: 2000 })(post({ mediaMaxW: null }))).toBe(false);
    expect(predOf({ type: 'dimension', axis: 'width', value: 2000 })(post({}))).toBe(false);
  });

  test('欠損（0/null）は不一致 — lte 側も含め条件不成立（「不明を含める」扱いにしない）', () => {
    expect(predOf({ type: 'dimension', axis: 'width', value: 2000, op: 'lte' })(post({ mediaMaxW: 0 }))).toBe(false);
  });
});

// P2④: mode は廃止し、常に注入された compile を通す
describe('text: 単一スマートマッチとメモ化', () => {
  test('本文に当たり、注入した matcher が呼ばれる', () => {
    expect(predOf({ type: 'text', value: 'こんにちは' })(post())).toBe(true);
    expect(searchCalls).toContain('こんにちは');
  });

  test('タグにも当たる', () => {
    expect(predOf({ type: 'text', value: '作画' })(post({ text: '' }))).toBe(true);
  });

  test('不一致', () => {
    expect(predOf({ type: 'text', value: '存在しない語' })(post())).toBe(false);
  });

  test('空値は素通し（compile も呼ばない）', () => {
    expect(predOf({ type: 'text', value: '  ' })(post())).toBe(true);
    expect(searchCalls).toHaveLength(0);
  });

  test('media[].alt（画像ALT）にしか無い語にも当たる（#288）', () => {
    expect(predOf({ type: 'text', value: 'ALT専用語' })(post({ text: '', media: [{ alt: 'ここにALT専用語がある' }] }))).toBe(true);
  });

  test('media が無い・alt が null な投稿でも例外にならない', () => {
    expect(predOf({ type: 'text', value: '存在しない語' })(post({ media: undefined }))).toBe(false);
    expect(predOf({ type: 'text', value: '存在しない語' })(post({ media: [{ alt: null }, { url: 'x' }] }))).toBe(false);
  });

  test('半角カナが matcher の正規化で当たる（注入経路の証明）', () => {
    expect(predOf({ type: 'text', value: 'ﾈｺ' })(post({ text: 'ネコ' }))).toBe(true);
    expect(searchCalls).toEqual(['ﾈｺ']);
  });

  test('_compiled はノードにメモ化され、再 compile されない', () => {
    const node: any = { type: 'text', value: 'ﾈｺ' };
    predOf(node)(post({ text: 'ネコ' }));
    const memo = node._compiled;

    predOf(node)(post());

    expect(node._compiled).toBe(memo);
    expect(typeof memo).toBe('function');
    expect(searchCalls).toHaveLength(1);
  });

  test('_compiledKey が残っていても _compiled が欠けていれば再コンパイルする', () => {
    const node: any = { type: 'text', value: 'ﾈｺ' };
    predOf(node)(post({ text: 'ネコ' }));
    node._compiled = null; // JSON を往復した後（保存・タブ復元）に関数だけが落ちた状態

    expect(predOf(node)(post({ text: 'ネコ' }))).toBe(true);
    expect(searchCalls).toHaveLength(2);
  });
});

// URL 形の問い合わせだけが対象。postKeyOf での正規化、quotedUrl、smart matcher は経由しない
describe('text: URL 照合', () => {
  // 絶対に一致しない matcher のスタブ＝URL の一致が（テキスト照合ではなく）OR の経路から来ている証明
  const predOfU = Q.makePostPredOf({ isInFolder: () => false, postMatcher: () => () => false, postKeyOf: R.postKeyOf });
  const xPost = R.stampPost(post({ url: 'https://x.com/foo/status/123', platform: 'x' }));
  const blueskyPost = R.stampPost(post());

  test('フル URL の貼り付けが当たる', () => {
    expect(predOfU({ kind: 'cond', type: 'text', value: 'https://x.com/foo/status/123' })(xPost)).toBe(true);
  });

  test('twitter.com の貼り付けが x.com 保存分に postKey で当たる', () => {
    expect(predOfU({ kind: 'cond', type: 'text', value: 'https://twitter.com/foo/status/123' })(xPost)).toBe(true);
  });

  test('ドメイン断片も URL に当たる', () => {
    expect(predOfU({ kind: 'cond', type: 'text', value: 'bsky.app' })(blueskyPost)).toBe(true);
  });

  test('引用元 URL の貼り付けが、引用した投稿に当たる', () => {
    const quoter = R.stampPost(post({ quotedUrl: 'https://x.com/bar/status/999' }));
    expect(predOfU({ kind: 'cond', type: 'text', value: 'https://twitter.com/bar/status/999' })(quoter)).toBe(true);
  });

  // #181: linkCard.url が指すのは任意の外部ページで、対応プラットフォームの投稿では
  // ない。素の部分文字列だけで見て、postKeyOf の正規化はしない（すぐ上の quotedUrl は
  // 正規化キーでも一致する点が違う）。
  test('リンクカードの行き先 URL の貼り付けが、共有した投稿に当たる', () => {
    const sharer = R.stampPost(post({ linkCard: { url: 'https://example.com/some/article', title: 'A', description: null } } as any));
    expect(predOfU({ kind: 'cond', type: 'text', value: 'https://example.com/some/article' })(sharer)).toBe(true);
  });

  test('URL 形でない語は URL 一致では当たらない', () => {
    expect(predOfU({ kind: 'cond', type: 'text', value: 'notes' })(blueskyPost)).toBe(false);
  });

  test('URL の貼り付けは smart matcher を経由せず exact 経路で当たる', () => {
    expect(predOfU({ kind: 'cond', type: 'text', value: 'https://bsky.app/profile/neko.bsky.social/post/abc' })(blueskyPost)).toBe(true);
  });
});

// 投稿側の makePostPredOf に対応する投稿者側。deps は posterTagEntriesOf
// （キー→その投稿者の実効タグの実体、#810）と folderById（id→{items}）。
describe('makePosterPredOf', () => {
  const entry = (id: number | null, name: string, label = name): HologramTagEntry => ({ id, name, label });
  // 作画 は id を持たない＝タグを編集してから書き込みが返るまでの間、投稿者の行が
  // 取る形。Ave Mujica は普通の実体。
  const posterTags = new Map([['x:@aaa', [entry(null, '作画'), entry(7, 'Ave Mujica')]]]);
  const posterPredOf = Q.makePosterPredOf({
    posterTagEntriesOf: (key: string) => posterTags.get(key) || [],
  });
  // これらのケースが読む欄だけでなく、HologramUserAgg の全メンバーを埋める。要点は
  // 戻り値の型 (#635)。14欄のうち6欄しか持たないフィクスチャは buildUsers が絶対に
  // 作らない形を試すことになり、しかも緑のまま通ってしまう。特に
  // `members`/`platforms` は、posterPredOf の platform の葉が実際に照合する先。
  const poster = (over?: Partial<HologramUserAgg>): HologramUserAgg => {
    const m = {
      key: 'x:@aaa',
      platform: 'x',
      screenName: 'aaa',
      displayName: 'あああ',
      bio: '',
      avatarFile: '',
      bannerFile: '',
      followers: null,
      following: null,
      authorCreatedAt: '2020-01-01T00:00:00Z',
      followerPercentile: null,
      latest: '2026-05-10T12:00:00Z',
      firstPost: '2026-01-01T00:00:00Z',
      lastCapture: '2026-06-01T00:00:00Z',
      firstCapture: '2026-01-02T00:00:00Z',
      count: 1,
      ...over,
    };
    return m;
  };

  test('platform の一致・不一致', () => {
    expect(posterPredOf({ kind: 'cond', type: 'platform', value: 'x' })(poster())).toBe(true);
    expect(posterPredOf({ kind: 'cond', type: 'platform', value: 'pixiv' })(poster())).toBe(false);
  });

  test('tag は注入した posterTagEntriesOf 経由（タグ無しでも落ちない）', () => {
    expect(posterPredOf({ kind: 'cond', type: 'tag', value: 'Ave Mujica' })(poster())).toBe(true);
    expect(posterPredOf({ kind: 'cond', type: 'tag', value: '作画' })(poster({ key: 'x:@none' }))).toBe(false);
  });

  // #810: 投稿者側も実体を優先して照合する。理由は投稿側と同じ2つ＝改名しても id は
  // 変わらない、2つの実体が同じ名前を持ちうる。
  describe('tag の実体一致（#810）', () => {
    const A = 11;
    const B = 12;
    const homonymPredOf = Q.makePosterPredOf({
      posterTagEntriesOf: (key: string) => (key === 'p:a' ? [entry(A, 'alice', 'alice(東方)')] : [entry(B, 'alice', 'alice(紅魔郷)')]),
    });
    const p = (key: string): HologramUserAgg => poster({ key, platform: '', latest: '', lastCapture: '', authorCreatedAt: '' });

    test('id を持つ葉は同名のもう一方に当たらない', () => {
      expect(homonymPredOf({ kind: 'cond', type: 'tag', value: 'alice', tagId: A })(p('p:a'))).toBe(true);
      expect(homonymPredOf({ kind: 'cond', type: 'tag', value: 'alice', tagId: A })(p('p:b'))).toBe(false);
    });

    test('id の無い葉は名前で両方に当たる（移行前の保存検索）', () => {
      expect(homonymPredOf({ kind: 'cond', type: 'tag', value: 'alice' })(p('p:a'))).toBe(true);
      expect(homonymPredOf({ kind: 'cond', type: 'tag', value: 'alice' })(p('p:b'))).toBe(true);
    });

    test('葉の id は実効集合と照合される（親タグで子だけのポスターが当たる）', () => {
      const child = 21;
      const parent = 22;
      const withParent = Q.makePosterPredOf({
        posterTagEntriesOf: () => [entry(child, 'レミリア'), entry(parent, '東方')],
      });
      expect(withParent({ kind: 'cond', type: 'tag', value: '東方', tagId: parent })(p('p:c'))).toBe(true);
    });
  });

  // 既定の欄は latest で、to は翌日0時の手前（投稿側と同じ localDayRange の規約）
  describe('date', () => {
    const pMay10 = leaf('date', undefined, { from: '2026-05-10', to: '2026-05-10' });

    test('既定の latest がその日のローカル 23:59 を含む', () => {
      expect(posterPredOf(pMay10)(poster({ latest: dLocal('2026-05-10T23:59:00').toISOString() }))).toBe(true);
    });

    test('翌日のローカル 00:00 は含まない', () => {
      expect(posterPredOf(pMay10)(poster({ latest: dLocal('2026-05-11T00:00:00').toISOString() }))).toBe(false);
    });

    test('dateField=lastCapture を参照できる', () => {
      expect(posterPredOf({ kind: 'cond', type: 'date', dateField: 'lastCapture', from: '2026-06-01', to: '2026-06-01' })(poster({ lastCapture: dLocal('2026-06-01T10:00:00').toISOString() }))).toBe(true);
    });

    test('フィールドが欠けていれば不一致', () => {
      expect(posterPredOf(pMay10)(poster({ latest: '' }))).toBe(false);
    });
  });

  test('未知の型は素通し（true）', () => {
    expect(posterPredOf({ kind: 'cond', type: 'workspace' })(poster())).toBe(true);
  });
});

describe('evalNode: AND / OR / 否定 / 入れ子', () => {
  const p1 = post();

  test('AND は全一致で true、1つ外れれば false', () => {
    expect(Q.evalNode(group('and', [leaf('platform', 'bluesky'), leaf('media', 'image')]), p1, predOf)).toBe(true);
    expect(Q.evalNode(group('and', [leaf('platform', 'bluesky'), leaf('media', 'video')]), p1, predOf)).toBe(false);
  });

  test('OR はどれか一致で true', () => {
    expect(Q.evalNode(group('or', [leaf('platform', 'x'), leaf('media', 'image')]), p1, predOf)).toBe(true);
  });

  test('葉の否定・グループの否定', () => {
    expect(Q.evalNode(group('and', [leaf('platform', 'x', { neg: true })]), p1, predOf)).toBe(true);
    expect(Q.evalNode(group('and', [leaf('platform', 'bluesky')], true), p1, predOf)).toBe(false);
  });

  test('入れ子（bluesky AND (x OR image)）', () => {
    expect(Q.evalNode(group('and', [leaf('platform', 'bluesky'), group('or', [leaf('platform', 'x'), leaf('media', 'image')])]), p1, predOf)).toBe(true);
  });
});

describe('ツリーの基本機構', () => {
  test('emptyTree は and ルートで子なし', () => {
    expect(Q.emptyTree()).toMatchObject({ kind: 'group', op: 'and', children: [] });
  });

  test('opposite は and⇄or', () => {
    expect(Q.opposite('and')).toBe('or');
    expect(Q.opposite('or')).toBe('and');
  });

  test('treeLeaves は入れ子を平坦化し、null にも安全', () => {
    const nested = group('and', [leaf('tag', 'a'), group('or', [leaf('tag', 'b'), leaf('tag', 'c')])]);
    expect(Q.treeLeaves(nested).map((l: any) => l.value)).toEqual(['a', 'b', 'c']);
    expect(Q.treeLeaves(null)).toEqual([]);
  });
});

describe('facetTreeFrom（旧 faceted state からの移行）', () => {
  const mig = Q.facetTreeFrom([{ type: 'platform', value: 'x' }, { type: 'platform', value: 'pixiv' }, { type: 'tag', value: '作画' }, { type: 'engagement' }], { platform: 'or', tag: 'not' });

  test('型ごとにグループ化する（platform=or の2葉）', () => {
    expect(mig.children.some((c: any) => c.kind === 'group' && c.op === 'or' && !c.neg && c.children.length === 2)).toBe(true);
  });

  test('not は neg グループになる', () => {
    expect(mig.children.some((c: any) => c.kind === 'group' && c.neg && c.children[0].type === 'tag')).toBe(true);
  });

  test('グループ化しない型（engagement）は直下の葉のまま', () => {
    expect(mig.children.some((c: any) => c.kind === 'cond' && c.type === 'engagement')).toBe(true);
  });
});

describe('純ヘルパ', () => {
  test('hostOf', () => {
    expect(Q.hostOf('https://www.pixiv.net/artworks/1')).toBe('www.pixiv.net');
    expect(Q.hostOf('not a url')).toBe('');
  });

  test('userKey は userId 優先で handle へフォールバック', () => {
    expect(Q.userKey(postView({ platform: 'x', userId: 'u1', screenName: 's' }))).toBe('x:u1');
    expect(Q.userKey(postView({ platform: 'x', screenName: 's' }))).toBe('x:@s');
  });

  // #760: platform-less レコードは platform 名前空間を持たないので、URL のホストで閉じる
  // （同名の著者でも別ドメインなら別キー＝投稿者グリッドで1人に統合されない）。
  test('userKey は platform 無しのレコードをホストで閉じる（#760）', () => {
    expect(Q.userKey(postView({ platform: null, userId: 'u1', url: 'https://sitea.example/p' }))).toBe('web:sitea.example:u1');
    expect(Q.userKey(postView({ platform: null, screenName: 'alice', url: 'https://sitea.example/p' }))).toBe('web:sitea.example:@alice');
    // 同じ screenName でもホストが違えば別キー（同名別人の統合ミスを防ぐ）
    expect(Q.userKey(postView({ platform: null, screenName: 'alice', url: 'https://siteb.example/p' }))).toBe('web:siteb.example:@alice');
  });

  test('textHaystackOf は null 安全に文字列化する', () => {
    expect(searchValues(postView({ text: null, tags: ['t'] })).every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  test('textHaystackOf は media[].alt を連結し、media 欠如や alt=null でも例外にならない（#288）', () => {
    expect(searchValues(postView({ text: null, media: [{ alt: 'キャラA' }, { alt: null }, { url: 'x' }] }))).toEqual(expect.arrayContaining(['キャラA']));
    expect(searchValues(postView({ text: null })).every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  // #188: pixiv シリーズタイトルで検索すると所属作品が出るように、検索テキスト束へ足す
  test('textHaystackOf は seriesTitle を連結する（#188）', () => {
    expect(searchValues(postView({ text: null, seriesTitle: 'ある冒険' }))).toEqual(expect.arrayContaining(['ある冒険']));
    expect(searchValues(postView({ text: null, seriesTitle: null })).every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  // #180: 引用元/リプライ先サブレコードの本文・投稿者名で検索すると、サブレコード
  // 自体でなく親が見つかる（単体では検索にヒットしない設計 — 2026-07-27 design
  // comment）。alt も同じ理由で他の media[].alt と同列に連結する。
  test('引用情報の本文・投稿者・media alt を検索対象にし、IDは別の属性にする（#180）', () => {
    const withQuote = { text: null, quotedPost: { text: '元の投稿', displayName: 'ボブ', screenName: 'bob', media: [{ alt: '引用先の画像' }] } };
    expect(searchValues(postView(withQuote))).toEqual(expect.arrayContaining(['元の投稿 ボブ 引用先の画像', 'bob']));

    const withReply = { text: null, replyToPost: { text: 'リプ先の本文', displayName: null, screenName: 'carol', media: [] } };
    expect(searchValues(postView(withReply))).toEqual(expect.arrayContaining(['リプ先の本文', 'carol']));
  });

  test('quotedPost/replyToPost が無い投稿でも textHaystackOf は例外にならない（#180）', () => {
    expect(searchValues(postView({ text: null })).every((s: unknown) => typeof s === 'string')).toBe(true);
    expect(searchValues(postView({ text: null, quotedPost: null, replyToPost: null })).every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  // #181: リンクカードのタイトル・説明文は投稿本文と同列に連結する（専用構文は
  // 増やさない、#181's Why）。行き先 URL 自体は 'text' 葉の URL プローブ側で扱う
  // （app/src/renderer/src/services/query.test.ts の「text: URL 照合」ブロック参照）。
  test('textHaystackOf はリンクカードのタイトル・説明文を連結する（#181）', () => {
    expect(searchValues(postView({ text: null, linkCard: { url: 'https://example.com/article', title: 'A great article', description: 'It explains things.' } }))).toEqual(expect.arrayContaining(['A great article It explains things.']));
  });

  test('linkCard が無い投稿でも textHaystackOf は例外にならない（#181）', () => {
    expect(searchValues(postView({ text: null, linkCard: null })).every((s: unknown) => typeof s === 'string')).toBe(true);
  });

  test('localDayRange の to は翌日ローカル0時（排他）で、空は null', () => {
    const ldr = Q.localDayRange('2026-05-10', '2026-05-10');
    expect(ldr.to!.getTime() - ldr.from!.getTime()).toBe(24 * 3600 * 1000);

    expect(Q.localDayRange('', '')).toMatchObject({ from: null, to: null });
  });
});

// 第9スライス: createQueryBuilder から切り出した純ロジック
describe('木の変異ドメイン', () => {
  test('treeParentMap / nodeContains / detachNode', () => {
    const a = leaf('tag', 'a');
    const b = leaf('tag', 'b');
    const inner = group('or', [a, b]);
    const t = group('and', [inner]);
    const pmap = Q.treeParentMap(t);

    expect(pmap.get(a)).toBe(inner);
    expect(pmap.get(inner)).toBe(t);
    expect(Q.nodeContains(t, a)).toBe(true);
    expect(Q.nodeContains(inner, inner)).toBe(true);
    expect(Q.nodeContains(a, b)).toBe(false);

    Q.detachNode(a, pmap);
    expect(inner.children).toEqual([b]);

    Q.detachNode(t, pmap); // 親が無い（root）＝何もしない
    expect(t.children).toHaveLength(1);
  });

  test('cleanupTree は空グループを除き、単独グループを折り畳む（neg は生存者へ合流）', () => {
    const only = leaf('tag', 'x', { neg: false });
    const t = group('and', [group('or', [], false), group('or', [only], true)]);

    Q.cleanupTree(t);

    expect(t.children).toEqual([only]);
    expect(only.neg).toBe(true);
  });

  describe('hasLeafValue / removeCondsMatching', () => {
    const t = group('and', [leaf('tag', 'a'), group('or', [leaf('tag', 'b'), leaf('platform', 'x')])]);

    test('hasLeafValue は入れ子も探す', () => {
      expect(Q.hasLeafValue(t, 'tag', 'b')).toBe(true);
      expect(Q.hasLeafValue(t, 'tag', 'zzz')).toBe(false);
    });

    test('removeCondsMatching は全段から削り、残り1葉のグループは折り畳む', () => {
      expect(Q.removeCondsMatching(t, (c: any) => c.type === 'tag')).toBe(true);
      expect(Q.treeLeaves(t)).toHaveLength(1);
      expect(t.children[0]).toMatchObject({ kind: 'cond', type: 'platform' });
    });

    test('一致が無ければ false', () => {
      expect(Q.removeCondsMatching(t, (c: any) => c.type === 'nope')).toBe(false);
    });
  });

  // #774: 2つのタグの実体が同じ名前を持ちうる（#5 の ID モデル）。だから自分の id を
  // 知っているタグの葉は、その id で同一視する＝名前は退避先でしかない。
  describe('sameLeaf / hasSameLeaf: タグは実体で同一視する', () => {
    test('同名でも tagId が違えば別の葉', () => {
      const a = { kind: 'cond', type: 'tag', value: 'alice', tagId: 1 } as any;
      expect(Q.sameLeaf(a, { type: 'tag', value: 'alice', tagId: 2 })).toBe(false);
      expect(Q.sameLeaf(a, { type: 'tag', value: 'alice', tagId: 1 })).toBe(true);
    });

    test('どちらかが id を持たなければ名前へ落ちる', () => {
      const noId = { kind: 'cond', type: 'tag', value: 'alice' } as any;
      expect(Q.sameLeaf(noId, { type: 'tag', value: 'alice', tagId: 2 })).toBe(true);
      expect(Q.sameLeaf(noId, { type: 'tag', value: 'bob', tagId: 2 })).toBe(false);
    });

    test('hasSameLeaf は入れ子の実体も見つける', () => {
      const t2 = group('and', [leaf('platform', 'x'), group('or', [{ kind: 'cond', type: 'tag', value: 'alice', tagId: 2 } as any])]);
      expect(Q.hasSameLeaf(t2, { type: 'tag', value: 'alice', tagId: 2 })).toBe(true);
      expect(Q.hasSameLeaf(t2, { type: 'tag', value: 'alice', tagId: 9 })).toBe(false);
    });
  });

  describe('buildShadow: 同名2実体が1件へ潰れない', () => {
    test('tagId 違いは別エントリとして残り、id を持ち帰る', () => {
      const t2 = group('and', [{ kind: 'cond', type: 'tag', value: 'alice', tagId: 1 } as any, { kind: 'cond', type: 'tag', value: 'alice', tagId: 2 } as any]);
      const sh = Q.buildShadow(t2);
      expect(sh).toHaveLength(2);
      expect(sh.map((f: any) => f.tagId)).toEqual([1, 2]);
    });

    test('id の無いタグは従来どおり type+value で重複排除', () => {
      const t2 = group('and', [leaf('tag', 'alice'), leaf('tag', 'alice')]);
      expect(Q.buildShadow(t2)).toHaveLength(1);
    });
  });

  test('sameLeaf: date は型一致のみ・engagement は engType・他は value', () => {
    expect(Q.sameLeaf(leaf('date', undefined, { from: '2026-01-01' }), { type: 'date' })).toBe(true);
    expect(Q.sameLeaf(leaf('engagement', undefined, { engType: 'likes' }), { type: 'engagement', engType: 'likes' })).toBe(true);
    expect(Q.sameLeaf(leaf('engagement', undefined, { engType: 'likes' }), { type: 'engagement', engType: 'reposts' })).toBe(false);
    expect(Q.sameLeaf(leaf('tag', 'a'), { type: 'tag', value: 'a' })).toBe(true);
    expect(Q.sameLeaf(leaf('tag', 'a'), { type: 'tag', value: 'b' })).toBe(false);
  });

  // #162: dimension は axis 一致（value ではない — 幅2000px と 幅2000MB相当のバイト数が
  // たまたま等しくなることはないが、規約としては axis 一致が正しい単位）
  test('sameLeaf: dimension は axis', () => {
    expect(Q.sameLeaf(leaf('dimension', undefined, { axis: 'width' }), { type: 'dimension', axis: 'width' })).toBe(true);
    expect(Q.sameLeaf(leaf('dimension', undefined, { axis: 'width' }), { type: 'dimension', axis: 'height' })).toBe(false);
  });

  describe('buildShadow', () => {
    const t = group('and', [leaf('tag', 'a', { label: 'ラベル' }), group('or', [leaf('tag', 'a'), leaf('date', undefined, { neg: true, from: '2026-01-01', to: '2026-01-02' })]), leaf('engagement', undefined, { engType: 'likes', min: 5 }), leaf('dimension', undefined, { axis: 'width', value: 2000, op: 'gte' })]);
    const sh = Q.buildShadow(t);

    test('type+value で重複排除し、label は保つ', () => {
      expect(sh.filter((f: any) => f.type === 'tag')).toHaveLength(1);
      expect(sh.find((f: any) => f.type === 'tag')!.label).toBe('ラベル');
    });

    test('date / engagement は kind・neg を落として素通し', () => {
      const dt = sh.find((f: any) => f.type === 'date')!;
      expect(dt.from).toBe('2026-01-01');
      expect(dt.kind).toBeUndefined();
      expect(dt.neg).toBeUndefined();
      expect(sh.some((f: any) => f.type === 'engagement' && f.min === 5)).toBe(true);
    });

    test('dimension も kind・neg を落として素通し（axis+value+op がそのまま残る）', () => {
      expect(sh.some((f: any) => f.type === 'dimension' && f.axis === 'width' && f.value === 2000 && f.op === 'gte')).toBe(true);
    });
  });

  describe('dropNode', () => {
    const a = leaf('tag', 'a');
    const b = leaf('tag', 'b');
    const c = leaf('tag', 'c');
    const t = group('and', [a, b, c]);

    test('pair はターゲット位置に逆 op のペアグループを作る', () => {
      expect(Q.dropNode(t, c, a, 'pair')).toBe(true);
      expect(t.children[0]).toMatchObject({ kind: 'group', op: 'or' });
      expect(t.children[0].children).toEqual([a, c]);
    });

    test('inside はグループの末尾へ足す', () => {
      const pairGrp = t.children[0];
      expect(Q.dropNode(t, b, pairGrp, 'inside')).toBe(true);
      expect(pairGrp.children[2]).toBe(b);
    });

    test('root へ移すと、2人残った元グループは折り畳まれず存続する', () => {
      const pairGrp = t.children[0];
      expect(Q.dropNode(t, b, t, 'root')).toBe(true);
      expect(t.children.at(-1)).toBe(b);
      expect(pairGrp.children).toHaveLength(2);
    });

    test('自分自身・自分の子孫・null は拒否する', () => {
      const pairGrp = t.children[0];
      expect(Q.dropNode(t, a, a, 'pair')).toBe(false);
      expect(Q.dropNode(t, pairGrp, a, 'inside')).toBe(false);
      expect(Q.dropNode(t, a, null, 'pair')).toBe(false);
    });
  });

  describe('wrapAllInGroup', () => {
    test('旧 root が op ごと1グループに包まれ、新しい root は and', () => {
      const w = Q.wrapAllInGroup(group('or', [leaf('tag', 'a'), leaf('tag', 'b')]))!;

      expect(w.op).toBe('and');
      expect(w.children).toHaveLength(1);
      expect(w.children[0]).toMatchObject({ kind: 'group', op: 'or' });
      expect(w.children[0].children).toHaveLength(2);
    });

    test('単独条件を括ると折り畳みで実質 no-op', () => {
      const ws = Q.wrapAllInGroup(group('and', [leaf('tag', 'a')]))!;
      expect(ws.children).toHaveLength(1);
      expect(ws.children[0].kind).toBe('cond');
    });

    test('空の木は null', () => {
      expect(Q.wrapAllInGroup(Q.emptyTree())).toBeNull();
    });
  });

  test('cloneTree は深くコピーし、_ で始まる一時フィールドを全階層で落とす', () => {
    // 戻り値の型注釈ではなく `as` を使う。このケースの主題がまさに `_compiled` /
    // `_memo` で、HologramQueryGroup は index signature を宣言していない。注釈を付けた
    // リテラルはこれらを持っているせいで弾かれてしまう。
    const dirty = { kind: 'group', op: 'and', neg: false, _compiled: () => 1, children: [{ kind: 'cond', type: 'text', value: 'q', _memo: { big: true } }] } as HologramQueryGroup;
    const clean = Q.cloneTree(dirty);

    expect(clean).not.toBe(dirty);
    expect(clean.children[0]).not.toBe(dirty.children[0]);
    expect(clean.children[0].value).toBe('q');
    expect(clean).not.toHaveProperty('_compiled');
    expect(clean.children[0]).not.toHaveProperty('_memo');
  });
});

// 改訂④: UI がファセット CNF として組む形を固定する純ロジック
describe('ファセットのドメイン', () => {
  const OPTS = { multiValueTypes: ['tag'], standaloneTypes: ['date', 'text'] };

  test('facetDefaultOp は多値=and・他=or', () => {
    expect(Q.facetDefaultOp('tag', OPTS)).toBe('and');
    expect(Q.facetDefaultOp('platform', OPTS)).toBe('or');
  });

  describe('facetViewOf', () => {
    test('正準形をクラスタ/単独/除外へ分解する', () => {
      const t = group('and', [group('or', [leaf('platform', 'x'), leaf('platform', 'pixiv')]), leaf('tag', 'a'), leaf('date', undefined, { from: '2026-01-01' }), leaf('tag', 'b', { neg: true })]);
      const v = Q.facetViewOf(t, OPTS)!;

      expect(v.clusters).toHaveLength(2);
      expect(v.singles).toHaveLength(1);
      expect(v.excl).toHaveLength(1);
      expect(v.clusters[0]).toMatchObject({ type: 'platform', op: 'or' });
    });

    test('単一値型の裸2葉（恒偽 AND）は or に修復する', () => {
      const v = Q.facetViewOf(group('and', [leaf('platform', 'x'), leaf('platform', 'pixiv')]), OPTS)!;
      expect(v.clusters[0].op).toBe('or');
      expect(v.clusters[0].leaves).toHaveLength(2);
    });

    test('多値型の裸2葉は and のまま（root AND の意味を保つ）', () => {
      expect(Q.facetViewOf(group('and', [leaf('tag', 'a'), leaf('tag', 'b')]), OPTS)!.clusters[0].op).toBe('and');
    });

    test.each([
      ['OR ルート', group('or', [leaf('tag', 'a'), leaf('tag', 'b')])],
      ['入れ子グループ', group('and', [group('or', [leaf('tag', 'a'), group('and', [leaf('tag', 'b'), leaf('tag', 'c')])])])],
      ['neg グループ', group('and', [group('or', [leaf('tag', 'a'), leaf('tag', 'b')], true)])],
      ['型混在グループ', group('and', [group('or', [leaf('tag', 'a'), leaf('platform', 'x')])])],
      ['グループ＋同型の裸葉（クラスタ∧葉は別物）', group('and', [group('or', [leaf('tag', 'a'), leaf('tag', 'b')]), leaf('tag', 'c')])],
      ['単独型(text)のグループ', group('and', [group('or', [leaf('text', 'a'), leaf('text', 'b')])])],
    ])('ファセット形でないものは null: %s', (_name, tree) => {
      expect(Q.facetViewOf(tree, OPTS)).toBeNull();
    });
  });

  describe('canonicalizeFacet', () => {
    test('裸2葉を実グループにし、クラスタ→単独→除外の順へ並べ替える', () => {
      const t = group('and', [leaf('tag', 'x', { neg: true }), leaf('date', undefined, { from: '2026-01-01' }), leaf('tag', 'a'), leaf('tag', 'b')]);

      expect(Q.canonicalizeFacet(t, OPTS)).toBe(true);
      expect(t.children[0]).toMatchObject({ kind: 'group', op: 'and' });
      expect(t.children[0].children).toHaveLength(2);
      // children[1] は葉のはず、というのがこの並べ替えの主張そのもの＝union の絞り込みで書く。
      expect((t.children[1] as HologramQueryLeaf).type).toBe('date');
      expect(t.children[2].neg).toBe(true);
    });

    test('ファセット形でなければ false を返し、木を壊さない', () => {
      const t = group('or', [leaf('tag', 'a'), leaf('tag', 'b')]);
      const before = JSON.stringify(t);

      expect(Q.canonicalizeFacet(t, OPTS)).toBe(false);
      expect(JSON.stringify(t)).toBe(before);
    });
  });

  test('facetAdd: 裸葉→2値目でグループ化（既定 op）→以降は合流・単独型はトップへ', () => {
    const t = group('and', []);

    Q.facetAdd(t, leaf('tag', 'a'), OPTS);
    expect(t.children).toHaveLength(1);
    expect(t.children[0].kind).toBe('cond');

    Q.facetAdd(t, leaf('tag', 'b'), OPTS);
    expect(t.children[0]).toMatchObject({ kind: 'group', op: 'and' }); // tag の既定は and
    expect(t.children[0].children).toHaveLength(2);

    t.children[0].op = 'or'; // 利用者が「いずれか」へ切り替える
    Q.facetAdd(t, leaf('tag', 'c'), OPTS);
    expect(t.children[0].children).toHaveLength(3);
    expect(t.children[0].op).toBe('or'); // 合流した後も op は保つ

    Q.facetAdd(t, leaf('platform', 'x'), OPTS);
    Q.facetAdd(t, leaf('platform', 'pixiv'), OPTS);
    expect(t.children[1]).toMatchObject({ kind: 'group', op: 'or' }); // platform の既定は or

    Q.facetAdd(t, leaf('text', 'hey'), OPTS);
    Q.facetAdd(t, leaf('text', 'yo'), OPTS);
    expect(t.children.filter((c: any) => c.kind === 'cond' && c.type === 'text')).toHaveLength(2); // 単独型はグループ化しない
  });

  test('facetSetOp は該当グループの op を書き換え、無ければ false', () => {
    const t = group('and', [group('and', [leaf('tag', 'a'), leaf('tag', 'b')])]);

    expect(Q.facetSetOp(t, 'tag', 'or')).toBe(true);
    expect(t.children[0].op).toBe('or');
    expect(Q.facetSetOp(t, 'platform', 'or')).toBe(false);
  });

  describe('facetSetNeg（除くへ移動⇄クラスタへ復帰）', () => {
    test('移動・復帰で op を維持し、1値になったクラスタは折り畳む', () => {
      const a = leaf('tag', 'a');
      const b = leaf('tag', 'b');
      const c = leaf('tag', 'c');
      const t = group('and', [group('or', [a, b, c])]);

      expect(Q.facetSetNeg(t, c, true, OPTS)).toBe(true);
      expect(c.neg).toBe(true);
      expect(t.children.at(-1)).toBe(c);
      expect(t.children[0].children).toHaveLength(2);

      expect(Q.facetSetNeg(t, c, false, OPTS)).toBe(true);
      expect(c.neg).toBe(false);
      expect(t.children[0].children).toHaveLength(3);
      expect(t.children[0].op).toBe('or');

      Q.facetSetNeg(t, b, true, OPTS);
      Q.facetSetNeg(t, a, true, OPTS);
      expect(t.children[0]).toBe(c);

      expect(Q.facetSetNeg(t, a, true, OPTS)).toBe(false); // neg は変わらない
    });

    test('戻し先に同値の陽性があれば、冗長な葉は消える', () => {
      const d1 = leaf('tag', 'd');
      const d2 = leaf('tag', 'd', { neg: true });
      const t = group('and', [d1, d2]);

      Q.facetSetNeg(t, d2, false, OPTS);

      expect(Q.treeLeaves(t)).toHaveLength(1);
      expect(t.children[0]).toBe(d1);
    });
  });
});
