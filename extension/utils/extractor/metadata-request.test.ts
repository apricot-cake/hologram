import { afterEach, expect, test, vi } from 'vitest';
import { apiFixture } from '../../../tests/helpers/test-api-fixtures.ts';
import { fetchPostMetadata } from './index.ts';
import { createMetadataRequest } from './metadata-request.ts';
import { METADATA_TIMEOUT_MS } from '../deadline.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('本文の応答待ちも打ち切り、通信を中断する', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      signal = init.signal;
      return { ok: true, status: 200, text: () => new Promise(() => {}) };
    }),
  );
  const request = createMetadataRequest();
  const pending = expect(request('https://example.com')).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
  await pending;
  expect(signal?.aborted).toBe(true);
  await expect(request('https://example.com/next')).rejects.toThrow('timed out');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('Blueskyプロフィールが停止しても投稿の本文と画像を返す', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('getProfile')) return new Promise(() => {});
      const post = { record: { text: '取得済みの本文' }, author: { did: 'did:plc:abc', handle: 'alice.bsky.social', displayName: 'Alice' }, embed: { $type: 'app.bsky.embed.images#view', images: [{ fullsize: 'https://example.com/image.jpg', thumb: 'https://example.com/thumb.jpg', alt: '' }] } };
      return new Response(JSON.stringify(apiFixture(url, { thread: { post } })));
    }),
  );
  const pending = fetchPostMetadata('https://bsky.app/profile/did:plc:abc/post/rk', {});
  await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
  const result = await pending;
  expect(result.text).toBe('取得済みの本文');
  expect(result.media[0]?.url).toBe('https://example.com/image.jpg');
  expect(result.acquisitionIssues).toEqual([{ scope: 'profile', reason: 'fetchFailed' }]);
});

test('pixivのページ取得が停止しても判明済みの原本を残し、推測URLを増やさない', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/pages')) return new Promise(() => {});
      return new Response(JSON.stringify(apiFixture(url, { error: false, body: { id: '123', illustTitle: '作品', userId: '1', userName: '作者', illustType: 0, pageCount: 3, urls: { original: 'https://i.pximg.net/original_p0.jpg' } } })));
    }),
  );
  const pending = fetchPostMetadata('https://www.pixiv.net/artworks/123', {});
  await vi.advanceTimersByTimeAsync(METADATA_TIMEOUT_MS);
  const result = await pending;
  expect(result.title).toBe('作品');
  expect(result.media.map((item) => item.url)).toEqual(['https://i.pximg.net/original_p0.jpg']);
  expect(result.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'fetchFailed' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
