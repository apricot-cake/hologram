// レンダラーのストアの複数キー書き込み（#871）と、それを必要とした唯一の場所の単体テスト。
// 投稿グリッドの source はストアの2つのキー（'postGroups' と 'postSections'。sections は
// groups への添字を持つ）を1つのモデルへまとめる。だから、別々の2回の書き込みの間で目を
// 覚ました読み出し側には、sections が前のビルドのものであるモデルが見える。この裂けたモデルが
// masonic の位置キャッシュを壊し、グリッドを「Invalid value used as weak map key」で
// 落としていた。
//
// #1054 でストアは zustand の vanilla ストアになり、テストもそれに合わせて移った。ここで
// 作り物のキー名（'a1'・'b1' …）を使って見ていたもの＝通知の1パスがコールバックを重複除去
// すること、パスの途中で購読を切っても安全なことは、もう存在しない手書きのループを見ていた。
// 今はライブラリ側の約束事だ。こちらの持ち物として残るのは以下で、型付きのストアにそれ以外の
// キーが無いので実在のキーで書いてある。複数キーの書き込みは1パスで、その中に裂けた状態は
// 無い。そして同じ値の書き込みは黙る（orchestrator.ts の setBrowseModeLite は今いるモードを
// そのまま書き、自分のハンドラへ再入しないためにこの沈黙に頼っている）。
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

  test('値が変わらないキーは通知しない（キー単位購読の等値判定そのもの）', () => {
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

// この変更がそもそも在る理由になった回帰。post-grid-builder は両方のキーを1回の setState で
// 押す。ここでも同じ押し方をして、購読側が実際に何を観測するかを確かめる。直す前（キーを1つ
// ずつ書く2回の書き込み）は、最初のパスが新しい items を前のビルドのセクション範囲と一緒に
// 手渡していた。
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

// 同じ不変条件を実際の書き手の側から駆動する。押し方をキー1つずつの2回へ戻したら、動いて
// いるアプリでだけでなくここで落ちる。
describe('post-grid-builder — renderPosts は2つのキーを1パスで押す', () => {
  const post = (id: string, iso: string) => stampPost({ url: `https://x.com/u/status/${id}`, date: iso, image: `${id}.jpg`, captureId: id });

  // renderPosts 自身が押すまでの道筋で触るものだけ。builder の残りの依存はここでは一度も
  // 呼ばれない。
  const makeBuilder = (filtered: () => any[]) =>
    makePostGridBuilder({
      t: (key: string) => key,
      smokeCapture: false,
      fileSrc: (f: string) => f,
      shape: () => ({}) as any,
      gridThumbW: () => 280,
      listThumbW: () => 88,
      sortValue: () => 'date-desc', // 日付軸あり = sections が作られる
      postShadow: () => [],
      getFilteredPosts: filtered,
      buildUsers: () => [],
      resolve: (k: string) => k,
      snapshotState: () => ({}),
      syncTitleAndPersist: () => {},
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
