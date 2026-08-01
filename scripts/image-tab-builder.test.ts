import { expect, test } from 'vitest';
import { navEntryUrl } from '../app/src/renderer/src/services/tab-state.ts';
import { refreshImageTabTitles } from '../app/src/renderer/src/services/image-tab-builder.ts';

const imageEntry = (recs: string[]) => JSON.stringify({ u: navEntryUrl('image', { recs, idx: 0 }), kind: 'image', state: { recs, idx: 0 } });

test('削除した投稿を開く全タブは中立名になり、復元で名前を戻す', () => {
  const tabs: HologramTab[] = [
    { id: 'active', pinned: false, title: '古い名前', _autoTitle: true, state: null, _navHist: [imageEntry(['cap-1'])], _navIdx: 0 },
    { id: 'other', pinned: false, title: '古い名前', _autoTitle: true, state: null, _navHist: [imageEntry(['cap-1'])], _navIdx: 0 },
  ];
  const active = JSON.parse(imageEntry(['cap-1'])) as HologramNavEntry;
  let posts: HologramPost[] = [];
  const getPostById = (id: string) => posts.find((post) => post.captureId === id);

  expect(refreshImageTabTitles(tabs, 'active', active, getPostById, '画像')).toBe(true);
  expect(tabs.map((tab) => tab.title)).toEqual(['画像', '画像']);
  expect(tabs.every((tab) => tab._autoTitle)).toBe(true);

  posts = [{ captureId: 'cap-1', text: '復元した投稿' } as HologramPost];
  expect(refreshImageTabTitles(tabs, 'active', active, getPostById, '画像')).toBe(true);
  expect(tabs.map((tab) => tab.title)).toEqual(['復元した投稿', '復元した投稿']);
});
