// services/library-status.ts の純粋な単体テスト(#682)。
//
// 主張は1つ＝読み込みが着地していないうち(libraryLoaded=false)は、
// postGroups/posterGroups が何を持っていようと空状態を返さない。
// #682 の実際の不具合は、この保証が守られなかったもの。`hologramIpc.getPrefs().then(...)`
// がライブラリ自身の読み込み(loadPosts)より先に解決すると、allPosts がまだ []
// のまま renderPosts() が postGroups=null を書き、起動直後に初回向けの
// 「投稿がありません」が一瞬ちらつく(services/orchestrator.ts の bootApp と
// getPrefs の競合)。
import { describe, expect, test } from 'vitest';
import { libraryEmptyVariant } from '../app/src/renderer/src/services/library-status';

// 全ての欄を埋めた既定から始め、テストごとに違う分だけ上書きする。
const base = {
  mode: 'posts',
  libraryLoaded: true,
  postGroups: undefined as unknown[] | null | undefined,
  posterGroups: undefined as unknown[] | undefined,
  allPostsCount: 0,
  allUsersCount: 0,
  query: '',
  extensionContacted: true, // #71: 既存の一式は「コンタクト済み」の側を覆う。ガイドの側は下の専用の describe を見る
};

describe('libraryEmptyVariant: 読み込み未着は「0件」と別物', () => {
  test('未読込＝postGroups が null でも何も返さない（#682 の核心）', () => {
    expect(libraryEmptyVariant({ ...base, libraryLoaded: false, postGroups: null })).toBeNull();
  });

  test('未読込＝allPostsCount が 0 でも firstRun にはならない', () => {
    expect(libraryEmptyVariant({ ...base, libraryLoaded: false, postGroups: null, allPostsCount: 0 })).toBeNull();
  });

  test('未読込＝posters 側も同様', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'posters', libraryLoaded: false, posterGroups: [], allUsersCount: 0 })).toBeNull();
  });

  test('未描画（postGroups が undefined）は読込済みでも何も返さない', () => {
    expect(libraryEmptyVariant({ ...base, libraryLoaded: true, postGroups: undefined })).toBeNull();
  });
});

describe('libraryEmptyVariant: 読み込み済みの確定状態', () => {
  test('読込済み・postGroups=null・allPostsCount=0・検索無し → firstRun', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: null, allPostsCount: 0 })).toBe('firstRun');
  });

  test('読込済み・postGroups=null・allPostsCount>0（フィルタで0件） → filtered', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: null, allPostsCount: 42 })).toBe('filtered');
  });

  test('読込済み・postGroups=null・検索語あり → allPostsCount=0 でも filtered', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: null, allPostsCount: 0, query: 'cat' })).toBe('filtered');
  });

  test('postGroups が中身のある配列 → 何も返さない', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: [{}] })).toBeNull();
  });

  test('posters: 読込済み・posterGroups=[]・allUsersCount=0 → posterFirstRun', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'posters', posterGroups: [], allUsersCount: 0 })).toBe('posterFirstRun');
  });

  test('posters: 読込済み・posterGroups=[]・allUsersCount>0 → filtered', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'posters', posterGroups: [], allUsersCount: 5 })).toBe('filtered');
  });

  test('posters: posterGroups が中身のある配列 → 何も返さない', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'posters', posterGroups: [{}] })).toBeNull();
  });

  test('posters: posterGroups が undefined（未描画） → 読込済みでも何も返さない', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'posters', posterGroups: undefined })).toBeNull();
  });
});

describe('libraryEmptyVariant: trash は対象外', () => {
  test('trash モードは常に null（trash 自身の空状態を持つ）', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'trash', libraryLoaded: false })).toBeNull();
    expect(libraryEmptyVariant({ ...base, mode: 'trash', libraryLoaded: true, postGroups: null, allPostsCount: 0 })).toBeNull();
  });
});

// #71: firstRun/posterFirstRun は、拡張機能が一度でもコンタクトしてきたかで
// さらに分かれる。一度も無いなら、普段の「投稿がありません」ではなく導入の
// ガイドを出す。
describe('libraryEmptyVariant: 拡張ガイド（#71）', () => {
  test('postGroups=null・allPostsCount=0・コンタクト無し → extensionGuide（firstRun ではない）', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: null, allPostsCount: 0, extensionContacted: false })).toBe('extensionGuide');
  });

  test('posters: posterGroups=[]・allUsersCount=0・コンタクト無し → extensionGuide', () => {
    expect(libraryEmptyVariant({ ...base, mode: 'posters', posterGroups: [], allUsersCount: 0, extensionContacted: false })).toBe('extensionGuide');
  });

  test('フィルタで0件（filtered）はコンタクトの有無を見ない', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: null, allPostsCount: 42, extensionContacted: false })).toBe('filtered');
  });

  test('検索語あり（filtered）もコンタクトの有無を見ない', () => {
    expect(libraryEmptyVariant({ ...base, postGroups: null, allPostsCount: 0, query: 'cat', extensionContacted: false })).toBe('filtered');
  });

  test('未読込のうちはコンタクト無しでも何も返さない（#682 の核心と同じ理由）', () => {
    expect(libraryEmptyVariant({ ...base, libraryLoaded: false, postGroups: null, extensionContacted: false })).toBeNull();
  });
});
