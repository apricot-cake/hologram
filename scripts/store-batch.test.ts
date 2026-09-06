import { describe, expect, test } from 'vitest';
import { store, subscribeKey, subscribeKeys } from '../app/src/renderer/src/services/store';

describe('setState — 複数キーを1パスで', () => {
  test('2つのキーを購読する同じコールバックは1回だけ呼ばれる（#871 の核心）', () => {
    let calls = 0;
    const cb = () => {
      calls++;
    };
    const off = subscribeKeys(['postGroups', 'searchQuery'], cb);
    store.setState({ postGroups: [{ id: 'g0' }] as any, searchQuery: '' });
    expect(calls).toBe(1);
    off();
  });

  test('通知の時点で両方のキーが新しい値になっている（裂けた状態を読ませない）', () => {
    const observed: Array<[unknown, unknown]> = [];
    store.setState({ postGroups: null, searchQuery: '' });
    const cb = () => observed.push([store.getState().postGroups, store.getState().searchQuery]);
    const off = subscribeKeys(['postGroups', 'searchQuery'], cb);
    const groups = [{ id: 'g0' }] as any;
    const sections = '猫';
    store.setState({ postGroups: groups, searchQuery: sections });
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
