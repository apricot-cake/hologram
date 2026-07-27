// pixiv の決定的ユニットテスト（ネットワーク非使用）。parsePostUrl・複数ページの
// media[] 導出・fetchPixivIllust のフィールド対応を、fetch を差し替えて検証する。
// 実際の fetch は拡張の service worker がユーザーの pixiv Cookie ＋ host_permission
// 付きで走らせるもので、Node からの実 fetch は代表性が無い＝ajax 応答を模す。

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchPixivIllust, parsePostUrl, pixivMedia } from '../extension/utils/metadata';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parsePostUrl', () => {
  test('/en/artworks/<id>', () => {
    expect(parsePostUrl('https://www.pixiv.net/en/artworks/12345')?.id).toBe('12345');
  });

  test('/artworks は platform=pixiv', () => {
    expect(parsePostUrl('https://www.pixiv.net/artworks/999')?.platform).toBe('pixiv');
  });

  test('www なしホスト', () => {
    expect(parsePostUrl('https://pixiv.net/artworks/42')?.id).toBe('42');
  });

  test('作品でない（/users）は null', () => {
    expect(parsePostUrl('https://www.pixiv.net/users/1')).toBeNull();
  });
});

describe('pixivMedia（複数ページの導出）', () => {
  const media = pixivMedia({
    pageCount: 2,
    width: 10,
    height: 20,
    urls: { original: 'https://i.pximg.net/img-original/img/2021/01/01/00/00/00/100_p0.jpg' },
  });

  test('_p0 から _p1 を導出', () => {
    expect(media).toHaveLength(2);
    expect(media[1].url).toMatch(/100_p1\.jpg$/);
  });

  test('全エントリが pixiv の Referer を持つ', () => {
    expect(media.every((x) => x.referer === 'https://www.pixiv.net/')).toBe(true);
  });

  test('先頭ページだけ寸法を持ち、2枚目以降は null', () => {
    expect(media[0].width).toBe(10);
    expect(media[1].width).toBeNull();
  });
});

describe('fetchPixivIllust', () => {
  const body = {
    illustTitle: 'My Art',
    userId: '77',
    userName: 'Artist',
    likeCount: 10,
    bookmarkCount: 20,
    viewCount: 300,
    commentCount: 4,
    createDate: '2021-05-06T07:08:09+09:00',
    pageCount: 3,
    width: 1000,
    height: 1500,
    tags: { tags: [{ tag: 'foo' }, { tag: 'bar' }] },
    urls: { original: 'https://i.pximg.net/img-original/img/2021/05/06/07/08/09/555_p0.png' },
  };

  test('成功応答のフィールド対応', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ error: false, body }) }));
    const rec = await fetchPixivIllust({ id: '555' }, 'https://www.pixiv.net/artworks/555');

    expect(rec.platform).toBe('pixiv');
    expect(rec.title).toBe('My Art'); // ← illustTitle
    expect({ displayName: rec.displayName, screenName: rec.screenName, userId: rec.userId }).toEqual({ displayName: 'Artist', screenName: '77', userId: '77' });
    expect({ likes: rec.likes, bookmarks: rec.bookmarks, views: rec.views, replies: rec.replies }).toEqual({ likes: 10, bookmarks: 20, views: 300, replies: 4 });
    expect(rec.hashtags).toEqual(['foo', 'bar']); // ← tags.tags
    expect(rec.media).toHaveLength(3);
    expect(rec.media[2].url.endsWith('555_p2.png')).toBe(true);
    expect(rec.media[0].referer).toBe('https://www.pixiv.net/');
    expect(rec.mediaType).toBe('image');
  });

  // 削除済み・非公開・R-18 のログアウト時は 200 + {error:true} で返る
  test('エラー body は空レコード（throw しない）', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ error: true, message: 'not found' }) }));
    const rec = await fetchPixivIllust({ id: '1' }, 'https://www.pixiv.net/artworks/1');

    expect(rec.platform).toBe('pixiv');
    expect(rec.title).toBeNull();
    expect(rec.media).toHaveLength(0);
  });

  test('HTTP エラーは空レコード', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }));
    const rec = await fetchPixivIllust({ id: '2' }, 'u');

    expect(rec.media).toHaveLength(0);
    expect(rec.likes).toBeNull();
  });
});
