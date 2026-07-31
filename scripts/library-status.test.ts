// services/library-status.ts の純ユニットテスト（#682）。
//
// 核となる主張は1つ＝「読み込み未着（libraryLoaded=false）」の間は、postGroups/
// posterGroups の値が何であっても空状態を一切返さないこと。#682 の実際のバグは
// これが守られておらず、`hologramIpc.getPrefs().then(...)` がライブラリ本体の
// 読み込み（loadPosts）より先に解決すると、allPosts=[] のまま renderPosts() が
// postGroups=null を書いてしまい、「投稿がありません」の初回案内が起動直後に
// 一瞬表示されていた（services/orchestrator.ts の bootApp/getPrefs 競合）。
import { describe, expect, test } from 'vitest';
import { libraryEmptyVariant } from '../app/src/renderer/src/services/library-status';

// 全フィールドを埋めた既定値から、各テストは違いだけを上書きする。
const base = {
  mode: 'posts',
  libraryLoaded: true,
  postGroups: undefined as unknown[] | null | undefined,
  posterGroups: undefined as unknown[] | undefined,
  allPostsCount: 0,
  allUsersCount: 0,
  query: '',
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
