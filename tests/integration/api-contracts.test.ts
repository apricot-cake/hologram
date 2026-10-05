import { afterEach, expect, test, vi } from 'vitest';
import { XPostSchema, PixivIllustSchema, BlueskyPostSchema } from '../../extension/utils/extractor/api-schemas.ts';
import { fetchXTweet } from '../../extension/utils/extractor/x.ts';
import { fetchPixivIllust } from '../../extension/utils/extractor/pixiv.ts';
import { fetchBlueskyPost } from '../../extension/utils/extractor/bluesky.ts';
import { parseHostRequest } from '../../native-host/protocol.mts';

const x = { id_str: '1', lang: 'en', text: 'text', created_at: '2026-01-01T00:00:00Z', user: { id_str: '2', name: 'name', screen_name: 'user', profile_image_url_https: 'https://example.com/avatar.png' }, favorite_count: 0, conversation_count: 0 };
const pixiv = {
  illustType: 0,
  pageCount: 1,
  width: 1,
  height: 1,
  urls: { original: 'https://i.pximg.net/fixture_p0.jpg' },
  tags: { tags: [] },
  createDate: '2026-01-01T00:00:00Z',
  uploadDate: '2026-01-01T00:00:00Z',
  illustId: '1',
  illustTitle: '',
  userId: '2',
  userName: 'name',
  likeCount: 0,
  bookmarkCount: 0,
  viewCount: 0,
  commentCount: 0,
};
const bluesky = { uri: 'at://did:plc:test/app.bsky.feed.post/1', cid: 'cid', indexedAt: '2026-01-01T00:00:00Z', author: { did: 'did:plc:test', handle: 'test.bsky.social' }, record: { text: '', createdAt: '2026-01-01T00:00:00Z' } };
afterEach(() => vi.unstubAllGlobals());

test('Bluesky の省略可能な件数と X の省略可能な sensitive を受け付ける', () => {
  expect(BlueskyPostSchema.safeParse(bluesky).success).toBe(true);
  expect(XPostSchema.safeParse(x).success).toBe(true);
});
test.each([
  [XPostSchema, x, 'favorite_count'],
  [XPostSchema, x, 'conversation_count'],
  [PixivIllustSchema, pixiv, 'likeCount'],
  [PixivIllustSchema, pixiv, 'bookmarkCount'],
  [PixivIllustSchema, pixiv, 'createDate'],
  [PixivIllustSchema, pixiv, 'urls'],
  [BlueskyPostSchema, bluesky, 'record'],
])('必須値が消えた応答を拒否する', (schema, record, key) => {
  const broken = { ...record };
  delete broken[key];
  expect(schema.safeParse(broken).success).toBe(false);
});
test.each([null, '1', -1, 1.5])('任意の件数でも、届いた不正値は拒否する: %p', (likeCount) => {
  expect(BlueskyPostSchema.safeParse({ ...bluesky, likeCount }).success).toBe(false);
});
test('X の件数の契約違反を記録し、正常な本文を保持する', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ ...x, favorite_count: 'broken' }));
  expect((await fetchXTweet({ id: '1', screenName: 'user' }, 'https://x.com/user/status/1')).acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('pixiv の件数欠落を取得不足として記録する', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: false, body: { ...pixiv, likeCount: undefined } }));
  expect((await fetchPixivIllust({ id: '1' }, 'https://www.pixiv.net/artworks/1')).acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('Bluesky の契約違反は部分レコードへのフォールバックにならない', async () => {
  vi.stubGlobal('fetch', async (url) => (String(url).includes('resolveHandle') ? Response.json({ did: 'did:plc:test' }) : Response.json({ thread: { post: { ...bluesky, likeCount: 'broken' } } })));
  expect((await fetchBlueskyPost({ handle: 'test.bsky.social', rkey: '1' }, 'https://bsky.app/profile/test.bsky.social/post/1')).acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('Native Messaging は不正メタデータを保存処理へ渡さず、項目と理由を返す', () => {
  const result = parseHostRequest({ type: 'savePost', captureId: '123-ab', id: 7, metadata: { text: 'private text', likes: 'private bad value' } });
  expect(result).toMatchObject({ ok: false, id: 7, failure: { code: 'malformed-request', error: expect.stringContaining('metadata.likes') } });
  expect(JSON.stringify(result)).not.toContain('private');
});

test('X の壊れた画像を正常な保存と扱わず本文を保持する', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ ...x, mediaDetails: [{ type: 'photo' }] }));
  const result = await fetchXTweet({ id: '1', screenName: 'user' }, 'https://x.com/user/status/1');
  expect(result.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'invalidResponse' });
  expect(result.text).toBe('text');
  expect(result.media).toEqual([]);
});
test('pixiv のページ一覧に壊れた URL があるとメディア取得失敗を返す', async () => {
  vi.stubGlobal('fetch', async (url) => Response.json({ error: false, body: String(url).endsWith('/pages') ? [{ urls: {} }] : { ...pixiv, pageCount: 2 } }));
  expect((await fetchPixivIllust({ id: '1' }, 'https://www.pixiv.net/artworks/1')).acquisitionIssues).toContainEqual({ scope: 'media', reason: 'invalidResponse' });
});
test('Bluesky の画像の必須値欠落は欠損へ変換しない', async () => {
  vi.stubGlobal('fetch', async (url) => (String(url).includes('resolveHandle') ? Response.json({ did: 'did:plc:test' }) : Response.json({ thread: { post: { ...bluesky, embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://example.com/image' }] } } } })));
  expect((await fetchBlueskyPost({ handle: 'test.bsky.social', rkey: '1' }, 'https://bsky.app/profile/test.bsky.social/post/1')).acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});
test('プロフィールの不正な件数を取得失敗として返す', async () => {
  vi.stubGlobal('fetch', async (url) => (String(url).includes('resolveHandle') ? Response.json({ did: 'did:plc:test' }) : String(url).includes('getProfile') ? Response.json({ followersCount: 'bad' }) : Response.json({ thread: { post: bluesky } })));
  expect((await fetchBlueskyPost({ handle: 'test.bsky.social', rkey: '1' }, 'https://bsky.app/profile/test.bsky.social/post/1')).acquisitionIssues).toContainEqual({ scope: 'profile', reason: 'invalidResponse' });
});
