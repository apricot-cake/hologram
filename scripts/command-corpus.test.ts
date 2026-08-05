// Unit tests for entry generation in command-builder.ts (#28). Injects stub deps into
// makeCommands to register them, and checks who shows up from queryEntries.
//
// Most of this was moved over from buildSuggest in users.ts (tags are tallied from SNS posts
// only, counts come from count, posters prefer displayName and fall back to screenName, and
// there's a limit). The point pinned down here is #28's "one engine, three surfaces" — that the
// search box surface (6 tags, 4 posters) and the palette surface (8 items, commands and tabs
// also show up) both come out of the same generation. Ranking scores themselves are the job of
// command-registry.test.ts.

import { beforeEach, describe, expect, test } from 'vitest';
import { makeCommands } from '../app/src/renderer/src/services/command-builder';
import * as R from '../app/src/renderer/src/services/command-registry';

// The search box surface (same options as SearchBox.tsx) and the palette surface (same as CommandPalette.tsx)
const SEARCHBOX: R.QueryOptions = { sections: ['tag', 'user'], limit: { tag: 6, user: 4 } };
// The palette passes no limit = shows every hit and lets you scroll (matches the convention
// used for candidate lists elsewhere in the app — the "+ filter" bar's list has no limit, and
// facet rows go up to 100).
const PALETTE: R.QueryOptions | undefined = undefined;

const BASE_POSTS = () => [
  { url: 'https://x.com/a/status/2', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: ['風景'] },
  { url: 'https://x.com/a/status/1', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: [] },
  { url: 'https://x.com/a/status/0', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'アリス', tags: [] },
  { url: 'https://misskey.io/notes/n1', platform: 'misskey', userId: 'u3', screenName: 'carol', displayName: 'キャロル', tags: ['料理'] },
  { url: null, platform: null, tags: ['取込タグ'] }, // not an SNS post = excluded from tag tallying
];

// #148's chip-bar inline input surface (post view / poster view).
const INLINE_POSTS: R.QueryOptions = { sections: ['tag', 'user', 'folder'], limit: { tag: 6, user: 4, folder: 4 } };
const INLINE_POSTERS: R.QueryOptions = { sections: ['tag', 'folder'], limit: { tag: 6, folder: 4 } };

let posts: any[];
let folderList: any[];
let posterTags: { value: string; count: number }[];
let posterFolders: { id: string; name: string }[];
let performed: string[];
let mode: string;

// The buildUsers stub matches the real shape (posts with a url folded per-poster into an array).
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
  posterTags = [{ value: '常連', count: 4 }];
  posterFolders = [{ id: 'pf1', name: '追いかけ中' }];
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
    openTagManagementTab: () => performed.push('openTagManagementTab'),
    openHistoryEntry: (e) => performed.push(`openHistoryEntry:${e.u}`),
    switchTab: (id) => performed.push(`switchTab:${id}`),
    resetAllFilters: () => performed.push('resetAllFilters'),
    resetPosterFilters: () => performed.push('resetPosterFilters'),
    browseTo: (m) => performed.push(`browseTo:${m}`),
    applyFolderFilter: (id) => performed.push(`applyFolderFilter:${id}`),
    posterTagRows: () => posterTags,
    posterFolderRows: () => posterFolders,
    posterAddFilter: (f) => performed.push(`posterAddFilter:${f.type}:${f.value}`),
    startTriage: () => performed.push('startTriage'),
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
    // Distribute 共通0..共通9 with a step-shaped occurrence count (mirrors the old buildSuggest limit test)
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

  test('パレットの面: 当たった分を全部出す＝生成は1つで上限だけが違う', () => {
    // The population is 10 items, 共通0..共通9. The palette passes no limit so all of them show up.
    expect(titlesOf(R.queryEntries('共通', PALETTE), 'tag')).toHaveLength(10);
    // The leading entries match the search box surface (ordering doesn't drift)
    expect(titlesOf(R.queryEntries('共通', PALETTE), 'tag').slice(0, 6)).toEqual(titlesOf(R.queryEntries('共通', SEARCHBOX), 'tag'));
  });
});

describe('操作系コマンド', () => {
  test('空クエリでも全部出る（まず何ができるかが読める）', () => {
    expect(titlesOf(R.queryEntries('', PALETTE), 'command')).toEqual(['cmdOpenSettings', 'cmdNewTab', 'cmdManageTags', 'cmdOpenHistory', 'cmdClearFilters', 'cmdViewGrid', 'cmdViewList', 'cmdTogglePanels', 'cmdBrowsePosts', 'cmdBrowsePosters', 'cmdBrowseTrash', 'cmdTriageStart']);
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

  test('投稿 / 投稿者 / ゴミ箱の切替', () => {
    run('cmdBrowsePosts');
    run('cmdBrowsePosters');
    // Trash also goes through the same browseTo destination as the other two (#268) = don't build a dedicated path on the palette side.
    run('cmdBrowseTrash');
    expect(performed).toEqual(['browseTo:posts', 'browseTo:posters', 'browseTo:trash']);
  });

  test('フォルダへのジャンプは applyFolderFilter を通る', () => {
    itemsOf(R.queryEntries('お気に入り', PALETTE), 'folder')[0].perform();
    expect(performed).toEqual(['applyFolderFilter:f1']);
  });

  test('高速トリアージの開始（#46）は startTriage を通る', () => {
    run('cmdTriageStart');
    expect(performed).toEqual(['startTriage']);
  });
});

// #148: the third surface (chip-bar inline input). The point is that generation still goes
// through the same queryEntries, and all a surface changes is "which sections, how many items"
// and "what happens on confirm".
describe('チップ帯インライン入力の面（#148）', () => {
  test('タグ・投稿者の候補は filter（＝足す条件そのもの）を持つ', () => {
    expect(itemsOf(R.queryEntries('風景', INLINE_POSTS), 'tag')[0].filter).toEqual({ type: 'tag', value: '風景' });
    expect(itemsOf(R.queryEntries('アリス', INLINE_POSTS), 'user')[0].filter).toEqual({ type: 'user', value: 'x:u1', label: 'アリス' });
  });

  test('フォルダは filter を持たない＝行き先なので perform() に倒れる', () => {
    expect(itemsOf(R.queryEntries('お気に入り', INLINE_POSTS), 'folder')[0].filter).toBeUndefined();
  });

  test('チップ帯の面とパレットの面は同じ候補（顔ぶれがズレない）', () => {
    expect(titlesOf(R.queryEntries('風景', INLINE_POSTS), 'tag')).toEqual(titlesOf(R.queryEntries('風景', PALETTE), 'tag'));
  });
});

describe('語彙は見ているビューのもの（#148）', () => {
  beforeEach(() => {
    mode = 'posters';
  });

  test('投稿者ビューでは投稿側のタグ・投稿者・フォルダを出さない', () => {
    expect(titlesOf(R.queryEntries('風景', PALETTE), 'tag')).toEqual([]);
    expect(titlesOf(R.queryEntries('アリス', PALETTE), 'user')).toEqual([]);
    expect(titlesOf(R.queryEntries('お気に入り', PALETTE), 'folder')).toEqual([]);
  });

  test('投稿者ビューのタグは投稿者側の語彙から出て、投稿者のクエリへ入る', () => {
    const tags = itemsOf(R.queryEntries('常連', INLINE_POSTERS), 'tag');
    expect(tags.map((e) => e.title)).toEqual(['常連']);
    expect(tags[0]).toMatchObject({ hint: '4', weight: 4, filter: { type: 'tag', value: '常連' } });
    tags[0].perform();
    expect(performed).toEqual(['posterAddFilter:tag:常連']);
  });

  test('投稿者ビューのフォルダは択一ファセット＝ここに居たまま入れ替わるので filter を持つ', () => {
    const folders = itemsOf(R.queryEntries('追いかけ', INLINE_POSTERS), 'folder');
    expect(folders[0]).toMatchObject({ title: '追いかけ中', filter: { type: 'folder', value: 'pf1' } });
  });

  test('投稿ビューへ戻れば投稿側の語彙に戻る（provider は出し分けるだけ）', () => {
    mode = 'posts';
    expect(titlesOf(R.queryEntries('風景', PALETTE), 'tag')).toEqual(['風景']);
    expect(titlesOf(R.queryEntries('常連', PALETTE), 'tag')).toEqual([]);
  });
});
