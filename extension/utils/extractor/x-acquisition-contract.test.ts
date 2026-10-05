import { afterEach, expect, test, vi } from 'vitest';
import { fetchXTweet } from './x.ts';

afterEach(() => vi.unstubAllGlobals());

// 埋め込み応答の契約を明示する。取得テスト用の補完処理を通さない。
function post() {
  return {
    id_str: '20',
    text: '保存する本文 #tag https://t.co/link',
    created_at: '2026-10-01T00:00:00.000Z',
    lang: 'ja',
    user: { id_str: '10', name: '投稿者', screen_name: 'author', profile_image_url_https: 'https://pbs.twimg.com/profile_images/avatar_normal.jpg' },
    favorite_count: 2,
    conversation_count: 1,
    entities: { urls: [{ url: 'https://t.co/link', expanded_url: 'https://example.com/article' }] },
    mediaDetails: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/image.jpg', original_info: { width: 10, height: 20 } }],
  };
}

async function capture(body: unknown) {
  const entries: unknown[] = [];
  vi.stubGlobal('fetch', async () => Response.json(body));
  const record = await fetchXTweet({ id: '20', screenName: 'author' }, 'https://x.com/author/status/20', (entry) => entries.push(entry));
  return { record, entries };
}

test('明示した正常応答から本文・画像・投稿者を取得する', async () => {
  const { record } = await capture(post());
  expect(record.text).toBe('保存する本文 #tag https://example.com/article');
  expect(record.avatar).toContain('avatar_400x400.jpg');
  expect(record.media[0]?.url).toBe('https://pbs.twimg.com/media/image.jpg?name=orig');
  expect(record.acquisitionIssues).toEqual([]);
});

test('プロフィール追加情報の不一致で本文・アバター・メディアを落とさない', async () => {
  const input = post();
  const { record, entries } = await capture({ ...input, user: { ...input.user, description: { secret: 'private-value' } } });
  expect(record.text).toContain('保存する本文');
  expect(record.avatar).toContain('avatar_400x400.jpg');
  expect(record.media).toHaveLength(1);
  expect(record.acquisitionIssues).toEqual([{ scope: 'profile', reason: 'invalidResponse' }]);
  expect(entries).toContainEqual(expect.objectContaining({ operation: 'x-profile', reason: 'contract', code: 200, error: 'description' }));
  expect(JSON.stringify(entries)).not.toMatch(/private-value|https:|投稿者/);
});

test('アバターの不一致で有効な本文・投稿者情報・メディアを落とさない', async () => {
  const input = post();
  const { record } = await capture({ ...input, user: { ...input.user, profile_image_url_https: 123, description: '紹介文' } });
  expect(record.text).toContain('保存する本文');
  expect(record.displayName).toBe('投稿者');
  expect(record.bio).toBe('紹介文');
  expect(record.avatar).toBeNull();
  expect(record.media).toHaveLength(1);
  expect(record.acquisitionIssues).toContainEqual({ scope: 'profile', reason: 'invalidResponse' });
});

test.each([
  ['entities', { urls: 'private-url-value' }, 'x-entities'],
  ['favorite_count', 'private-count-value', 'x-counts'],
  ['edit_control', { edit_tweet_ids: 123 }, 'x-edit'],
  ['card', { name: 'summary', binding_values: { card_url: { string_value: 123 } } }, 'x-card'],
  ['quoted_tweet', { text: 123 }, 'x-quote'],
  ['parent', { text: 123 }, 'x-parent'],
])('%s の不一致を明示し、本文と主メディアを保持する', async (field, value, operation) => {
  const { record, entries } = await capture({ ...post(), [field]: value, in_reply_to_screen_name: 'other', in_reply_to_status_id_str: '19' });
  expect(record.text).toContain('保存する本文');
  expect(record.media).toHaveLength(1);
  expect(record.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
  expect(entries).toContainEqual(expect.objectContaining({ operation, reason: 'contract', code: 200 }));
  expect(JSON.stringify(entries)).not.toMatch(/private-|https:/);
});

test('メディア一件の不一致で正常な別画像を落とさない', async () => {
  const input = post();
  const { record } = await capture({ ...input, mediaDetails: [...input.mediaDetails, { type: 'photo', media_url_https: 123 }] });
  expect(record.text).toContain('保存する本文');
  expect(record.media).toHaveLength(1);
  expect(record.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'invalidResponse' });
});

test.each([
  { type: 'future-format', media_url_https: 'https://pbs.twimg.com/media/future.jpg' },
  { type: 'video', media_url_https: 'https://pbs.twimg.com/media/video.jpg', video_info: { variants: [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' }] } },
])('未対応メディアを正常なメディアなしとして扱わない', async (item) => {
  const { record } = await capture({ ...post(), mediaDetails: [item] });
  expect(record.text).toContain('保存する本文');
  expect(record.media).toEqual([]);
  expect(record.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'unavailable' });
});

test.each(['id_str', 'text', 'created_at', 'user'])('必須項目 %s の欠落は本文成功として扱わない', async (field) => {
  const input: Record<string, unknown> = post();
  delete input[field];
  const { record } = await capture(input);
  expect(record.text).toBeNull();
  expect(record.media).toEqual([]);
  expect(record.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
});

test('未知の追加項目と正常な任意項目の省略は拒否しない', async () => {
  const input: Record<string, unknown> = post();
  delete input.entities;
  delete input.mediaDetails;
  const { record } = await capture({ ...input, future_field: { anything: true } });
  expect(record.text).toBe('保存する本文 #tag https://t.co/link');
  expect(record.acquisitionIssues).toEqual([]);
});
