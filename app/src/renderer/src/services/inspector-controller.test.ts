import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const signals = vi.hoisted(() => ({
  panelOpen: true,
  panel: new Set<() => void>(),
  posts: new Set<() => void>(),
  trash: new Set<() => void>(),
  trashState: { groups: [] as HologramPostGroup[], selected: new Set<string>() },
  image: null as { items: { postId: string }[]; idx: number } | null,
}));
vi.mock('./inspector-panel.ts', () => ({
  isOpen: () => signals.panelOpen,
  isVisible: () => signals.panelOpen,
  subscribe: (fn: () => void) => {
    signals.panel.add(fn);
    return () => signals.panel.delete(fn);
  },
}));
vi.mock('./posts-data.ts', () => ({
  subscribe: (fn: () => void) => {
    signals.posts.add(fn);
    return () => signals.posts.delete(fn);
  },
}));
vi.mock('./trash-view.ts', () => ({
  getSnapshot: () => signals.trashState,
  subscribe: (fn: () => void) => {
    signals.trash.add(fn);
    return () => signals.trash.delete(fn);
  },
}));
vi.mock('./image-tab.ts', () => ({ hologramImageTabSource: { get: () => signals.image } }));

import { connectInspector, requestDetailOptions } from './inspector-controller.ts';
import { get, close } from './inspector.ts';
import { store } from './store.ts';

const p1 = { captureId: 'a', image: 'a.png' } as HologramPost;
const p2 = { captureId: 'b', image: 'b.png' } as HologramPost;
const group = (post: HologramPost) => ({ key: post.captureId, rep: post, records: [post], files: [post.image] }) as HologramPostGroup;
let posts: HologramPost[];
let dispose: () => void;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const emit = (listeners: Set<() => void>) => listeners.forEach((fn) => fn());

beforeEach(async () => {
  posts = [p1, p2];
  signals.panelOpen = true;
  signals.image = null;
  signals.trashState = { groups: [], selected: new Set() };
  store.setState({ browseMode: 'posts', activeImageTab: null, selectedSet: new Set(), selectedPosterKey: null, inspectedKey: null, postGroups: posts.map(group) });
  dispose = connectInspector({
    getPostById: (id) => posts.find((post) => post.captureId === id),
    buildUsers: () => [{ key: 'author' } as HologramUserAgg],
    postModel: (g, options) => ({ kind: 'post', bodyText: g.rep.captureId, ...options }),
    posterModel: (u, options) => ({ kind: 'poster', name: u.key, ...options }),
    recordView: vi.fn(),
  });
  await flush();
});
afterEach(() => {
  dispose();
  close();
});

test('単独選択・複数選択・解除から詳細を導出する', async () => {
  store.setState({ selectedSet: new Set(['a']) });
  await flush();
  expect(get()?.bodyText).toBe('a');
  store.setState({ selectedSet: new Set(['a', 'b']) });
  await flush();
  expect(get()).toBeNull();
  store.setState({ selectedSet: new Set(['b']) });
  await flush();
  expect(get()?.bodyText).toBe('b');
  store.setState({ selectedSet: new Set() });
  await flush();
  expect(get()).toBeNull();
});

test('ビューアーの現在位置を優先し、閉じるだけで一覧の選択へ戻る', async () => {
  store.setState({ selectedSet: new Set(['a']) });
  await flush();
  signals.image = { items: [{ postId: 'a' }, { postId: 'b' }], idx: 1 };
  store.setState({ activeImageTab: { id: 'tab', recs: ['a', 'b'], idx: 1 } });
  await flush();
  expect(get()?.bodyText).toBe('b');
  store.setState({ activeImageTab: null });
  await flush();
  expect(get()?.bodyText).toBe('a');
});

test('パネルを閉じても選択を保持し、再表示時に復元する', async () => {
  store.setState({ selectedSet: new Set(['a']) });
  await flush();
  signals.panelOpen = false;
  emit(signals.panel);
  await flush();
  expect(get()).toBeNull();
  expect(store.getState().selectedSet.has('a')).toBe(true);
  signals.panelOpen = true;
  emit(signals.panel);
  await flush();
  expect(get()?.bodyText).toBe('a');
});

test('選択キーが残っていても削除された投稿は表示しない', async () => {
  store.setState({ selectedSet: new Set(['a']) });
  await flush();
  posts = [p2];
  emit(signals.posts);
  await flush();
  expect(get()).toBeNull();
  expect(store.getState().inspectedKey).toBeNull();
});

test('投稿者とゴミ箱はそれぞれの選択を使う', async () => {
  store.setState({ browseMode: 'posters', selectedPosterKey: 'author', selectedSet: new Set(['a']) });
  await flush();
  expect(get()?.name).toBe('author');
  signals.trashState = { groups: [group(p2)], selected: new Set(['b']) };
  store.setState({ browseMode: 'trash' });
  await flush();
  expect(get()?.bodyText).toBe('b');
  signals.trashState.selected = new Set();
  emit(signals.trash);
  await flush();
  expect(get()).toBeNull();
});

test('同じ対象の更新では入力欄を再マウントせず、タグ編集要求も反映する', async () => {
  store.setState({ selectedSet: new Set(['a']) });
  requestDetailOptions({ focusTags: true });
  await flush();
  const openId = get()?.openId;
  expect(get()?.focusTags).toBe(true);
  emit(signals.posts);
  await flush();
  expect(get()?.openId).toBe(openId);
  store.setState({ selectedSet: new Set(['b']) });
  await flush();
  expect(get()?.focusTags).not.toBe(true);
});
