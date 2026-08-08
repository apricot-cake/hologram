// Unit tests for the renderer store's multi-key write (#871) and for the one place
// that needed it: the post grid source combines TWO store keys ('postGroups' and
// 'postSections', where the sections index into the groups) into one model, so a
// reader that wakes up between two separate writes sees a model whose sections
// belong to the previous build. That torn model is what corrupted masonic's
// position cache and crashed the grid with "Invalid value used as weak map key".
//
// #1054 turned the store into a zustand vanilla store, and the tests moved with it.
// What used to be covered here with invented key names ('a1', 'b1', ...) — that the
// notify pass dedupes callbacks, that an unsubscribe mid-pass is safe — was testing a
// hand-written loop that no longer exists; those are the library's contract now. What
// is still OURS is below, and it is written against the real keys, because the typed
// store has no others: a multi-key write is ONE pass with no torn state in it, and a
// same-value write is silent (orchestrator.ts's setBrowseModeLite writes the mode it
// is already on and relies on that silence to not re-enter its own handler).
import { describe, expect, test } from 'vitest';
import { store, subscribeKey, subscribeKeys } from '../app/src/renderer/src/services/store';
import { hologramPostGridSource } from '../app/src/renderer/src/services/grid';
import { makePostGridBuilder } from '../app/src/renderer/src/services/post-grid-builder';
import { stampPost } from '../app/src/renderer/src/services/records';

describe('setState — 複数キーを1パスで', () => {
  test('2つのキーを購読する同じコールバックは1回だけ呼ばれる（#871 の核心）', () => {
    let calls = 0;
    const cb = () => {
      calls++;
    };
    const off = subscribeKeys(['postGroups', 'postSections'], cb);
    store.setState({ postGroups: [{ id: 'g0' }] as any, postSections: [] });
    expect(calls).toBe(1);
    off();
  });

  test('通知の時点で両方のキーが新しい値になっている（裂けた状態を読ませない）', () => {
    const observed: Array<[unknown, unknown]> = [];
    store.setState({ postGroups: null, postSections: null });
    const cb = () => observed.push([store.getState().postGroups, store.getState().postSections]);
    const off = subscribeKeys(['postGroups', 'postSections'], cb);
    const groups = [{ id: 'g0' }] as any;
    const sections = [{ key: '2026-8', startIndex: 0, count: 1 }] as any;
    store.setState({ postGroups: groups, postSections: sections });
    expect(observed).toEqual([[groups, sections]]);
    off();
  });

  test('値が変わらないキーは通知しない（browseMode の同値書き込みが無音である根拠）', () => {
    let calls = 0;
    store.setState({ browseMode: 'posts' });
    const off = subscribeKey('browseMode', () => calls++);
    store.setState({ browseMode: 'posts' });
    expect(calls).toBe(0);
    store.setState({ browseMode: 'posters' });
    expect(calls).toBe(1);
    off();
    store.setState({ browseMode: 'posts' });
  });
});

// The regression this whole change exists for. post-grid-builder pushes both keys
// in ONE setState; here we push them the same way and assert what a subscriber
// actually observes. Before the fix (two single-key writes) the first pass handed out a
// model carrying the NEW items with the PREVIOUS build's section ranges.
describe('post grid source — items と sections は必ず同じビルドで観測される', () => {
  const build = (n: number, sections: Array<{ key: string; startIndex: number; count: number }>) => ({
    groups: Array.from({ length: n }, (_, i) => ({ id: `g${i}` })),
    sections,
  });

  test('ペアで push すると通知は1回、どの観測でも sections が items をはみ出さない', () => {
    hologramPostGridSource.configure({
      modelOf: (item: any) => item,
      keyOf: (item: any) => item.id,
      onAspect: () => {},
    });

    const observed: Array<{ items: number; over: boolean }> = [];
    let notifications = 0;
    hologramPostGridSource.subscribe(() => {
      notifications++;
      const m = hologramPostGridSource.get();
      if (!m) return;
      const items = (m.items as unknown[]) || [];
      const secs = (m.sections as Array<{ startIndex: number; count: number }> | null) || [];
      observed.push({ items: items.length, over: secs.some((s) => s.startIndex + s.count > items.length) });
    });

    // 1回目のビルド: 40件・2セクション
    const first = build(40, [
      { key: '2026-7', startIndex: 0, count: 25 },
      { key: '2026-6', startIndex: 25, count: 15 },
    ]);
    store.setState({ postGroups: first.groups as any, postSections: first.sections as any });
    expect(notifications).toBe(1);

    // 2回目: 検索で絞り込まれて5件・1セクションへ。旧セクションのまま新 items を
    // 読むと startIndex+count が 40 のままで、5件の配列をはみ出す。
    const second = build(5, [{ key: '2026-7', startIndex: 0, count: 5 }]);
    store.setState({ postGroups: second.groups as any, postSections: second.sections as any });
    expect(notifications).toBe(2);

    expect(observed.map((o) => o.items)).toEqual([40, 5]);
    expect(observed.every((o) => !o.over)).toBe(true);
  });

  test('空の結果もペアで落ちる（items=null なら sections も null）', () => {
    const observed: Array<[unknown, unknown]> = [];
    hologramPostGridSource.subscribe(() => {
      observed.push([store.getState().postGroups, store.getState().postSections]);
    });
    store.setState({ postGroups: null, postSections: null });
    expect(observed).toEqual([[null, null]]);
  });
});

// The same invariant driven through the real writer, so splitting the push back
// into two single-key writes fails here rather than only in the running app.
describe('post-grid-builder — renderPosts は2つのキーを1パスで押す', () => {
  const post = (id: string, iso: string) => stampPost({ url: `https://x.com/u/status/${id}`, date: iso, image: `${id}.jpg`, captureId: id });

  // Only what renderPosts itself reaches on the path to the push; the rest of the
  // builder's deps are never called here.
  const makeBuilder = (filtered: () => any[]) =>
    makePostGridBuilder({
      t: (key: string) => key,
      smokeCapture: false,
      fileSrc: (f: string) => f,
      shape: () => ({}) as any,
      multiOnly: () => false,
      gridThumbW: () => 280,
      listThumbW: () => 88,
      sortValue: () => 'date-desc', // 日付軸あり = sections が作られる
      postShadow: () => [],
      getFilteredPosts: filtered,
      buildUsers: () => [],
      resolve: (k: string) => k,
      snapshotState: () => ({}),
      syncTitleAndPersist: () => {},
      getBrowseMode: () => 'posts',
      renderPosters: () => {},
      onPostsLoaded: () => {},
      showDetail: () => {},
      jumpToPoster: () => {},
      addImageTab: () => {},
      selectionMenu: { items: () => [], pick: () => false },
    } as any);

  test('絞り込みで件数が減っても、どの通知でも sections が items をはみ出さない', () => {
    let filtered = [post('1', '2026-07-20T00:00:00Z'), post('2', '2026-07-10T00:00:00Z'), post('3', '2026-06-20T00:00:00Z'), post('4', '2026-06-10T00:00:00Z')];
    const builder = makeBuilder(() => filtered);

    const observed: Array<{ items: number; over: boolean; sections: number }> = [];
    const record = () => {
      const items = (store.getState().postGroups as unknown[] | null) || [];
      const secs = (store.getState().postSections as Array<{ startIndex: number; count: number }> | null) || [];
      observed.push({ items: items.length, sections: secs.length, over: secs.some((s) => s.startIndex + s.count > items.length) });
    };
    subscribeKeys(['postGroups', 'postSections'], record);

    builder.renderPosts();
    // 検索が効いて7月の1件だけになる = セクションは2つ→1つ、範囲も縮む
    filtered = [post('1', '2026-07-20T00:00:00Z')];
    builder.renderPosts();
    // 0件（該当なし）
    filtered = [];
    builder.renderPosts();

    // 本体の不具合そのもの: 前のビルドのセクション範囲で新しい items を読む状態が
    // 一度でも観測されたら、masonic の位置キャッシュはそこで壊れる。
    expect(observed.filter((o) => o.over)).toEqual([]);
    // 同じコールバックが両キーに載っているので、押し方が2回に割れていれば通知も
    // 倍になる = 裂けた状態が「たまたま」無害だった時も件数で捕まえる。
    expect(observed).toHaveLength(3);
    expect(observed.map((o) => [o.items, o.sections])).toEqual([
      [4, 2],
      [1, 1],
      [0, 0],
    ]);
  });
});
