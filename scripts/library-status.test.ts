// Pure unit tests for services/library-status.ts (#682).
//
// There's one core claim = while loading hasn't landed yet (libraryLoaded=false),
// never return an empty state regardless of what postGroups/posterGroups hold.
// #682's actual bug was this guarantee being violated: when
// `hologramIpc.getPrefs().then(...)` resolved before the library itself finished
// loading (loadPosts), renderPosts() would write postGroups=null while allPosts was
// still [], and the "No posts" first-run message would flash briefly right after
// startup (a bootApp/getPrefs race in services/orchestrator.ts).
import { describe, expect, test } from 'vitest';
import { libraryEmptyVariant } from '../app/src/renderer/src/services/library-status';

// Starting from defaults with every field filled in, each test overrides only what differs.
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
