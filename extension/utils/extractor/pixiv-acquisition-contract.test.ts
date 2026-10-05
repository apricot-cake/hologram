import { afterEach, expect, test, vi } from 'vitest';
import { fetchPostMetadata } from './index.ts';

const body = {
  illustId: '12345',
  illustType: 0,
  pageCount: 1,
  width: 100,
  height: 80,
  urls: { original: 'https://i.pximg.net/12345_p0.jpg' },
  illustTitle: '作品',
  userId: '42',
  userName: '作者',
  illustComment: '本文',
  likeCount: 1,
  bookmarkCount: 2,
  viewCount: 3,
  commentCount: 0,
  tags: { tags: [{ tag: '作品' }] },
  createDate: '2026-10-01T00:00:00Z',
  uploadDate: '2026-10-01T00:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());
function responses(post: unknown, profile: unknown = { imageBig: 'https://i.pximg.net/avatar.jpg', comment: '紹介', social: [] }) {
  const fetch = vi.fn(async (url: string) => Response.json({ error: false, body: String(url).includes('/ajax/user/') ? profile : post }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
test('補完しない正常な応答から本文・画像・プロフィールを取得する', async () => {
  responses(body);
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.text).toBe('本文');
  expect(result.media).toHaveLength(1);
  expect(result.bio).toBe('紹介');
  expect(result.acquisitionIssues).toEqual([]);
});
test.each(['likeCount', 'tags', 'seriesNavData'])('%s の型変化で正常な本文と画像を捨てない', async (field) => {
  responses({ ...body, [field]: '不正な型' });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.text).toBe('本文');
  expect(result.media).toHaveLength(1);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('リンクの契約違反でも正常なアバターと紹介を取得する', async () => {
  responses(body, { imageBig: 'https://i.pximg.net/avatar.jpg', comment: '紹介', social: { account: 42 } });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.avatar).toBe('https://i.pximg.net/avatar.jpg');
  expect(result.bio).toBe('紹介');
  expect(result.acquisitionIssues).toContainEqual({ scope: 'profile', reason: 'invalidResponse' });
});
test('必須の投稿識別情報が不正ならメディアを保存対象にしない', async () => {
  responses({ ...body, userId: 42 });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.media).toEqual([]);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('未知の作品形式を静止画や複数ページとして扱わない', async () => {
  const fetch = responses({ ...body, illustType: 99, pageCount: 2 });
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {});
  expect(result.media).toEqual([]);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'unavailable' });
  expect(fetch.mock.calls.some(([url]) => url.includes('/pages'))).toBe(false);
});
