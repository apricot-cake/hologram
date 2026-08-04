// Unit tests for the renderer store's batched write (#871) and for the one place
// that needed it: the post grid source combines TWO store keys ('postGroups' and
// 'postSections', where the sections index into the groups) into one model, so a
// reader that wakes up between two separate writes sees a model whose sections
// belong to the previous build. That torn model is what corrupted masonic's
// position cache and crashed the grid with "Invalid value used as weak map key".
//
// The store is a module singleton, so every test below uses its own key names.
import { describe, expect, test } from 'vitest';
import { get, set, setMany, subscribe } from '../app/src/renderer/src/services/store';
import { hologramPostGridSource } from '../app/src/renderer/src/services/grid';
import { makePostGridBuilder } from '../app/src/renderer/src/services/post-grid-builder';
import { stampPost } from '../app/src/renderer/src/services/records';

describe('setMany', () => {
  test('書いたキーの購読者を呼ぶ／触っていないキーの購読者は呼ばない', () => {
    const seen: string[] = [];
    subscribe('a1', () => seen.push('a1'));
    subscribe('b1', () => seen.push('b1'));
    subscribe('c1', () => seen.push('c1'));
    setMany({ a1: 1, b1: 2 });
    expect(seen.sort()).toEqual(['a1', 'b1']);
    expect(get('a1')).toBe(1);
    expect(get('b1')).toBe(2);
  });

  test('2つのキーを購読する同じコールバックは1回だけ呼ばれる（#871 の核心）', () => {
    let calls = 0;
    const cb = () => {
      calls++;
    };
    subscribe('a2', cb);
    subscribe('b2', cb);
    setMany({ a2: 1, b2: 2 });
    expect(calls).toBe(1);
  });

  test('通知の時点で両方のキーが新しい値になっている（裂けた状態を読ませない）', () => {
    const observed: Array<[unknown, unknown]> = [];
    const cb = () => observed.push([get('a3'), get('b3')]);
    set('a3', 'old-a');
    set('b3', 'old-b');
    subscribe('a3', cb);
    subscribe('b3', cb);
    setMany({ a3: 'new-a', b3: 'new-b' });
    expect(observed).toEqual([['new-a', 'new-b']]);
  });

  test('値が変わらないキーは通知しない／全部同値ならパスごと走らない', () => {
    let calls = 0;
    set('a4', 1);
    set('b4', 2);
    subscribe('a4', () => calls++);
    subscribe('b4', () => calls++);
    setMany({ a4: 1, b4: 2 });
    expect(calls).toBe(0);
    setMany({ a4: 1, b4: 99 }); // b4 だけ変わる
    expect(calls).toBe(1);
  });

  test('全変更購読（キーなし subscribe）も1バッチにつき1回', () => {
    let calls = 0;
    subscribe(() => calls++);
    setMany({ a5: 1, b5: 2, c5: 3 });
    expect(calls).toBe(1);
  });

  // 購読者はパスの開始時点で固定される（Redux の dispatch と同じ契約）＝途中の
  // 解除は「そのパスには効かないが次からは効く」。呼び出し中に Set を書き換えて
  // 走査が壊れるのを避けるためで、set() の [...s] スナップショットからの引き継ぎ。
  test('パスの途中で解除しても落ちない（そのパスには効かず、次のパスから効く）', () => {
    const seen: string[] = [];
    const offB = subscribe('b6', () => seen.push('b6'));
    subscribe('a6', () => {
      seen.push('a6');
      offB();
    });
    setMany({ a6: 1, b6: 2 });
    expect(seen).toEqual(['a6', 'b6']);
    seen.length = 0;
    setMany({ a6: 10, b6: 20 });
    expect(seen).toEqual(['a6']);
  });

  test('set() は1キーの setMany と同じ（通知1回・値が入る）', () => {
    let calls = 0;
    subscribe('a7', () => calls++);
    set('a7', 'x');
    expect(get('a7')).toBe('x');
    expect(calls).toBe(1);
    set('a7', 'x'); // 同値は通知しない（従来どおり）
    expect(calls).toBe(1);
  });
});

// The regression this whole change exists for. post-grid-builder pushes both keys
// with ONE setMany; here we push them the same way and assert what a subscriber
// actually observes. Before the fix (two set() calls) the first pass handed out a
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
    setMany({ postGroups: first.groups, postSections: first.sections });
    expect(notifications).toBe(1);

    // 2回目: 検索で絞り込まれて5件・1セクションへ。旧セクションのまま新 items を
    // 読むと startIndex+count が 40 のままで、5件の配列をはみ出す。
    const second = build(5, [{ key: '2026-7', startIndex: 0, count: 5 }]);
    setMany({ postGroups: second.groups, postSections: second.sections });
    expect(notifications).toBe(2);

    expect(observed.map((o) => o.items)).toEqual([40, 5]);
    expect(observed.every((o) => !o.over)).toBe(true);
  });

  test('空の結果もペアで落ちる（items=null なら sections も null）', () => {
    const observed: Array<[unknown, unknown]> = [];
    hologramPostGridSource.subscribe(() => {
      observed.push([get('postGroups'), get('postSections')]);
    });
    setMany({ postGroups: null, postSections: null });
    expect(observed).toEqual([[null, null]]);
  });
});

// The same invariant driven through the real writer, so splitting the push back
// into two storeSet calls fails here rather than only in the running app.
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
      const items = (get('postGroups') as unknown[] | null) || [];
      const secs = (get('postSections') as Array<{ startIndex: number; count: number }> | null) || [];
      observed.push({ items: items.length, sections: secs.length, over: secs.some((s) => s.startIndex + s.count > items.length) });
    };
    subscribe('postGroups', record);
    subscribe('postSections', record);

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
