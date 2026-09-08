import { describe, expect, test } from 'vitest';
import { navEntryUrl } from './tab-state.ts';
import { makePostViewRecorder, refreshImageTabTitles } from './image-tab-builder.ts';

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

describe('画像ビューの投稿閲覧記録', () => {
  test('ビューを開くたびに数える', () => {
    const viewed: string[] = [];
    const recorder = makePostViewRecorder((id) => viewed.push(id));

    recorder.enter('p1');
    recorder.enter('p1');

    expect(viewed).toEqual(['p1', 'p1']);
  });

  test('同じ投稿の別画像では増やさず、別投稿へ移った時は増やす', () => {
    const viewed: string[] = [];
    const recorder = makePostViewRecorder((id) => viewed.push(id));

    recorder.enter('p1');
    recorder.move('p1');
    recorder.move('p2');
    recorder.move('p2');
    recorder.move('p1');

    expect(viewed).toEqual(['p1', 'p2', 'p1']);
  });

  test('ビューを離れて同じ投稿を開き直すと新しい閲覧になる', () => {
    const viewed: string[] = [];
    const recorder = makePostViewRecorder((id) => viewed.push(id));

    recorder.enter('p1');
    recorder.leave();
    recorder.enter('p1');

    expect(viewed).toEqual(['p1', 'p1']);
  });
});
