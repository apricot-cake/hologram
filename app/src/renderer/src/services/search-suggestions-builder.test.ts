import { beforeEach, describe, expect, test, vi } from 'vitest';
import { registerSearchSuggestions } from './search-suggestions-builder';
import * as R from './search-suggestions';
import { store } from './store';

const SEARCHBOX: R.QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };
// 候補一覧は limit を渡さない＝当たった分を全部出してスクロールさせる（アプリの他の候補一覧と
// 同じ作法。「+ フィルタ」帯の一覧に上限は無く、ファセットの行は100件まで出る）。
const ALL_SUGGESTIONS: R.QueryOptions | undefined = undefined;

const BASE_POSTS = () => [
  { url: 'https://x.com/a/status/2', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景'] },
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: [] },
  { url: 'https://x.com/a/status/0', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: [] },
  { url: 'https://www.pixiv.net/artworks/3', platform: 'pixiv', userId: 'u3', screenName: 'u3', displayName: 'キャロル', tags: ['料理'] },
  { url: null, platform: null, tags: ['取込タグ'] }, // SNS 投稿ではない＝タグの集計から外れる
];

// #148 のチップ帯インライン入力の面（投稿ビュー／投稿者ビュー）。
const INLINE_POSTS: R.QueryOptions = { sections: ['tag', 'user', 'folder'], limit: { tag: 6, user: 4, folder: 4 } };
const INLINE_POSTERS: R.QueryOptions = { sections: ['tag', 'folder'], limit: { tag: 6, folder: 4 } };

let posts: any[];
let folderList: any[];
let posterTags: { value: string; count: number }[];
let performed: string[];

// buildUsers のスタブは本物と同じ形（url を持つ投稿を投稿者ごとに配列へ畳んだもの）。
const usersOf = (all: any[]): any[] => {
  const map = new Map<string, any>();
  for (const p of all) {
    if (!p.url) continue;
    const key = `${p.platform}:${p.userId}`;
    const u = map.get(key) || { key, screenName: p.screenName || '', displayName: p.displayName || '', count: 0 };
    u.count++;
    map.set(key, u);
  }
  return [...map.values()];
};

const titlesOf = (groups: R.SuggestionGroup[], section: R.SuggestionSection) => groups.find((g) => g.section === section)?.items.map((e) => e.title) ?? [];
const itemsOf = (groups: R.SuggestionGroup[], section: R.SuggestionSection) => groups.find((g) => g.section === section)?.items ?? [];

beforeEach(() => {
  R.resetProviders();

  posts = BASE_POSTS();
  folderList = [{ id: 'f1', name: 'お気に入り' }];
  posterTags = [{ value: '常連', count: 4 }];
  performed = [];
  // エントリが分岐に使う browse モードは hologramStore 自身のキー＝アプリが書くのと同じものな
  // ので、テストはスタブではなくアプリの状態を動かす。
  store.setState({ browseMode: 'posts' });
  registerSearchSuggestions({
    t: (key) => key,
    allPosts: () => posts,
    buildUsers: () => usersOf(posts),
    listFolders: () => folderList,
    folderPath: (id) => (id === 'f1' ? 'お気に入り' : ''),
    openFolder: (id) => performed.push(`openFolder:${id}`),
    posterTagRows: () => posterTags,
    posterAddFilter: (f) => performed.push(`posterAddFilter:${f.type}:${f.value}`),
  });
});

describe('ジャンプ候補（旧 buildSuggest）', () => {
  test('url 無し投稿のタグは集計外（SNS 投稿のみ）', () => {
    expect(titlesOf(R.queryEntries('取込', ALL_SUGGESTIONS), 'tag')).toEqual([]);
  });

  test('tag 候補は hint に件数を持つ', () => {
    expect(itemsOf(R.queryEntries('風景', ALL_SUGGESTIONS), 'tag')[0]).toMatchObject({ title: '風景', hint: '1' });
  });

  test('投稿者は screenName でも当たる（表記ゆれ正規化＝大文字小文字を無視）', () => {
    expect(titlesOf(R.queryEntries('ALICE', ALL_SUGGESTIONS), 'user')).toEqual(['アリス']);
  });

  test('displayName マッチ＝表示は displayName・hint は投稿数', () => {
    expect(itemsOf(R.queryEntries('アリス', ALL_SUGGESTIONS), 'user')[0]).toMatchObject({ title: 'アリス', hint: '3' });
  });

  test('displayName が空なら screenName へフォールバック', () => {
    posts.push({ url: 'https://x.com/b/status/9', platform: 'x', userId: 'u2', screenName: 'bob', displayName: '', tags: [] });
    expect(titlesOf(R.queryEntries('bob', ALL_SUGGESTIONS), 'user')).toEqual(['bob']);
  });

  test('フォルダはパス表示で出る', () => {
    expect(titlesOf(R.queryEntries('お気に入り', ALL_SUGGESTIONS), 'folder')).toEqual(['お気に入り']);
  });

  test('空クエリでは列挙しない（開いた瞬間に数千件並べない）', () => {
    const groups = R.queryEntries('', ALL_SUGGESTIONS);
    expect(groups.map((g) => g.section)).toEqual([]);
  });
});

describe('面ごとの顔ぶれ（同じ生成・別の見せ方）', () => {
  beforeEach(() => {
    posts = [];
    // 共通0..共通9 を、出現回数が階段状になるように配る（旧 buildSuggest の上限テストに倣う）
    for (let i = 0; i < 10; i++) {
      posts.push({ url: `https://x.com/t/status/${i}`, platform: 'x', userId: 'tagger', screenName: 'tagger', displayName: '', tags: Array.from({ length: 10 }, (_, j) => `共通${j}`).slice(0, 10 - i) });
    }
    for (let i = 0; i < 6; i++) {
      posts.push({ url: `https://x.com/u${i}/status/1`, platform: 'x', userId: `common${i}`, screenName: `共通ユーザー${i}`, displayName: '', tags: [] });
    }
  });

  test('検索ボックスの面: タグ6件・投稿者4件・コマンドは出ない', () => {
    const groups = R.queryEntries('共通', SEARCHBOX);
    expect(groups.map((g) => g.section)).toEqual(['tag', 'user']);
    expect(titlesOf(groups, 'tag')).toHaveLength(6);
    expect(titlesOf(groups, 'user')).toHaveLength(4);
  });

  test('タグは使用回数の降順（共通0 が10件で先頭）', () => {
    const tags = itemsOf(R.queryEntries('共通', SEARCHBOX), 'tag');
    expect(tags[0]).toMatchObject({ title: '共通0', hint: '10' });
    expect(tags.map((e) => e.weight)).toEqual([...tags.map((e) => e.weight as number)].sort((a, b) => b - a));
  });

  test('上限なしの候補: 当たった分を全部出す＝生成は1つで上限だけが違う', () => {
    // 母集団は 共通0..共通9 の10件。候補一覧は limit を渡さないので全部出る。
    expect(titlesOf(R.queryEntries('共通', ALL_SUGGESTIONS), 'tag')).toHaveLength(10);
    // 先頭のエントリは検索ボックスの面と一致する（並びがずれない）
    expect(titlesOf(R.queryEntries('共通', ALL_SUGGESTIONS), 'tag').slice(0, 6)).toEqual(titlesOf(R.queryEntries('共通', SEARCHBOX), 'tag'));
  });
});

test('フォルダへのジャンプ', () => {
  itemsOf(R.queryEntries('お気に入り'), 'folder')[0].perform();
  expect(performed).toEqual(['openFolder:f1']);
});

// #148: 3つ目の面（チップ帯のインライン入力）。要点は、生成が今までどおり同じ queryEntries を
// 通ることと、面が変えるのは「どのセクションを何件出すか」と「確定したときに何が起きるか」だけ
// だということ。
describe('チップ帯インライン入力の面（#148）', () => {
  test('タグ・投稿者の候補は filter（＝足す条件そのもの）を持つ', () => {
    expect(itemsOf(R.queryEntries('風景', INLINE_POSTS), 'tag')[0].filter).toEqual({ type: 'tag', value: '風景' });
    expect(itemsOf(R.queryEntries('アリス', INLINE_POSTS), 'user')[0].filter).toEqual({ type: 'user', value: 'x:u1', label: 'アリス' });
  });

  test('フォルダは filter を持たない＝行き先なので perform() に倒れる', () => {
    expect(itemsOf(R.queryEntries('お気に入り', INLINE_POSTS), 'folder')[0].filter).toBeUndefined();
  });

  test('チップ帯の面と上限なしの候補は同じ候補（顔ぶれがズレない）', () => {
    expect(titlesOf(R.queryEntries('風景', INLINE_POSTS), 'tag')).toEqual(titlesOf(R.queryEntries('風景', ALL_SUGGESTIONS), 'tag'));
  });
});

describe('語彙は見ているビューのもの（#148）', () => {
  beforeEach(() => {
    store.setState({ browseMode: 'posters' });
  });

  test('投稿者ビューでは投稿側のタグ・投稿者・フォルダを出さない', () => {
    expect(titlesOf(R.queryEntries('風景', ALL_SUGGESTIONS), 'tag')).toEqual([]);
    expect(titlesOf(R.queryEntries('アリス', ALL_SUGGESTIONS), 'user')).toEqual([]);
    expect(titlesOf(R.queryEntries('お気に入り', ALL_SUGGESTIONS), 'folder')).toEqual([]);
  });

  test('投稿者ビューのタグは投稿者側の語彙から出て、投稿者のクエリへ入る', () => {
    const tags = itemsOf(R.queryEntries('常連', INLINE_POSTERS), 'tag');
    expect(tags.map((e) => e.title)).toEqual(['常連']);
    expect(tags[0]).toMatchObject({ hint: '4', weight: 4, filter: { type: 'tag', value: '常連' } });
    tags[0].perform();
    expect(performed).toEqual(['posterAddFilter:tag:常連']);
  });

  test('投稿ビューへ戻れば投稿側の語彙に戻る（provider は出し分けるだけ）', () => {
    store.setState({ browseMode: 'posts' });
    expect(titlesOf(R.queryEntries('風景', ALL_SUGGESTIONS), 'tag')).toEqual(['風景']);
    expect(titlesOf(R.queryEntries('常連', ALL_SUGGESTIONS), 'tag')).toEqual([]);
  });
});

vi.mock('./search-results.ts', () => ({
  matchingIds: (_kind: string, q: string, entries: any[]) => {
    const norm = (s: string) =>
      s
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
    return new Set(entries.filter((e) => norm(e.title + ' ' + (e.keywords || '') + ' ' + (e.screenName || '')).includes(norm(q))).map((e) => e.id));
  },
}));
