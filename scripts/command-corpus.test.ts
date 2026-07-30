// command-builder.ts のエントリ生成の単体テスト（#28）。makeCommands にスタブ deps を
// 注入して登録させ、queryEntries から出てくる顔ぶれを見る。
//
// 中身の多くは users.ts の buildSuggest から移ってきたもの（タグは SNS 投稿のみ集計・
// 件数は count・投稿者は displayName 優先で screenName へフォールバック・上限）。
// #28 の「エンジンは1つ・面は3つ」がここで守られていることが要点で、検索ボックスの面
// （タグ6件・投稿者4件）とパレットの面（8件・コマンドとタブも出る）が同じ生成から
// 出ていることを両方から確かめる。並びのスコア自体は command-registry.test.ts の担当。

import { beforeEach, describe, expect, test } from 'vitest';
import { makeCommands } from '../app/src/renderer/src/services/command-builder';
import * as R from '../app/src/renderer/src/services/command-registry';

// 検索ボックスの面（SearchBox.tsx と同じ指定）とパレットの面（CommandPalette.tsx と同じ）
const SEARCHBOX: R.QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };
const PALETTE: R.QueryOptions = { limit: { tag: 8, user: 8, folder: 8 } };

const BASE_POSTS = () => [
  { url: 'https://x.com/a/status/2', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景'] },
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: [] },
  { url: 'https://x.com/a/status/0', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: [] },
  { url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', displayName: 'キャロル', tags: ['料理'] },
  { url: null, platform: null, tags: ['取込タグ'] }, // SNS 投稿でない＝タグ集計外
];

let posts: any[];
let folderList: any[];
let performed: string[];
let mode: string;

// buildUsers のスタブは実物と同じ形（url ありの投稿を投稿者ごとに畳んだ配列）。
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

const titlesOf = (groups: R.CommandGroup[], section: R.CommandSection) => groups.find((g) => g.section === section)?.items.map((e) => e.title) ?? [];
const itemsOf = (groups: R.CommandGroup[], section: R.CommandSection) => groups.find((g) => g.section === section)?.items ?? [];

beforeEach(() => {
  R.resetProviders();
  R.close();
  posts = BASE_POSTS();
  folderList = [{ id: 'f1', name: 'お気に入り' }];
  performed = [];
  mode = 'posts';
  makeCommands({
    t: (key) => key,
    allPosts: () => posts,
    buildUsers: () => usersOf(posts),
    listFolders: () => folderList,
    folderPath: (id) => (id === 'f1' ? 'お気に入り' : ''),
    getBrowseMode: () => mode,
    addTab: () => performed.push('addTab'),
    switchTab: (id) => performed.push(`switchTab:${id}`),
    resetAllFilters: () => performed.push('resetAllFilters'),
    resetPosterFilters: () => performed.push('resetPosterFilters'),
    browseTo: (m) => performed.push(`browseTo:${m}`),
    applyFolderFilter: (id) => performed.push(`applyFolderFilter:${id}`),
  });
});

describe('ジャンプ候補（旧 buildSuggest）', () => {
  test('url 無し投稿のタグは集計外（SNS 投稿のみ）', () => {
    expect(titlesOf(R.queryEntries('取込', PALETTE), 'tag')).toEqual([]);
  });

  test('tag 候補は hint に件数を持つ', () => {
    expect(itemsOf(R.queryEntries('風景', PALETTE), 'tag')[0]).toMatchObject({ title: '風景', hint: '1' });
  });

  test('投稿者は screenName でも当たる（表記ゆれ正規化＝大文字小文字を無視）', () => {
    expect(titlesOf(R.queryEntries('ALICE', PALETTE), 'user')).toEqual(['アリス']);
  });

  test('displayName マッチ＝表示は displayName・hint は投稿数', () => {
    expect(itemsOf(R.queryEntries('アリス', PALETTE), 'user')[0]).toMatchObject({ title: 'アリス', hint: '3' });
  });

  test('displayName が空なら screenName へフォールバック', () => {
    posts.push({ url: 'https://x.com/b/status/9', platform: 'x', userId: 'u2', screenName: 'bob', displayName: '', tags: [] });
    expect(titlesOf(R.queryEntries('bob', PALETTE), 'user')).toEqual(['bob']);
  });

  test('フォルダはパス表示で出る', () => {
    expect(titlesOf(R.queryEntries('お気に入り', PALETTE), 'folder')).toEqual(['お気に入り']);
  });

  test('空クエリでは列挙しない（開いた瞬間に数千件並べない）', () => {
    const groups = R.queryEntries('', PALETTE);
    expect(groups.map((g) => g.section)).toEqual(['command']);
  });
});

describe('面ごとの顔ぶれ（同じ生成・別の見せ方）', () => {
  beforeEach(() => {
    posts = [];
    // 共通0..共通9 を出現回数が階段状になるよう配る（旧 buildSuggest の上限テストと同型）
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

  test('パレットの面: 同じタグ列がより多く出る＝生成は1つで上限だけが違う', () => {
    expect(titlesOf(R.queryEntries('共通', PALETTE), 'tag')).toHaveLength(8);
    // 先頭の顔ぶれは検索ボックスの面と一致する（並びがズレない）
    expect(titlesOf(R.queryEntries('共通', PALETTE), 'tag').slice(0, 6)).toEqual(titlesOf(R.queryEntries('共通', SEARCHBOX), 'tag'));
  });
});

describe('操作系コマンド', () => {
  test('空クエリでも全部出る（まず何ができるかが読める）', () => {
    expect(titlesOf(R.queryEntries('', PALETTE), 'command')).toEqual(['cmdOpenSettings', 'cmdNewTab', 'cmdClearFilters', 'cmdViewGallery', 'cmdViewList', 'cmdTogglePanels', 'cmdBrowsePosts', 'cmdBrowsePosters']);
  });

  const run = (title: string) => {
    const entry = itemsOf(R.queryEntries('', PALETTE), 'command').find((e) => e.title === title);
    expect(entry, `${title} が登録されていない`).toBeTruthy();
    (entry as R.CommandEntry).perform();
  };

  test('新しいタブ', () => {
    run('cmdNewTab');
    expect(performed).toEqual(['addTab']);
  });

  test('フィルタ全解除はモードで宛先が変わる（項目自体は消えない）', () => {
    run('cmdClearFilters');
    mode = 'posters';
    run('cmdClearFilters');
    expect(performed).toEqual(['resetAllFilters', 'resetPosterFilters']);
  });

  test('投稿 / 投稿者の切替', () => {
    run('cmdBrowsePosts');
    run('cmdBrowsePosters');
    expect(performed).toEqual(['browseTo:posts', 'browseTo:posters']);
  });

  test('フォルダへのジャンプは applyFolderFilter を通る', () => {
    itemsOf(R.queryEntries('お気に入り', PALETTE), 'folder')[0].perform();
    expect(performed).toEqual(['applyFolderFilter:f1']);
  });
});
