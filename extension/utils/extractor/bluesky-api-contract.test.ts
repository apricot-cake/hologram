import { afterEach, describe, expect, test, vi } from 'vitest';
import { BlueskyPostSchema, BlueskyProfileSchema } from './bluesky-api-schemas.ts';
import { fetchBlueskyPost } from './bluesky.ts';

const did = 'did:plc:abc';
const post = () => ({ uri: `at://${did}/app.bsky.feed.post/rk`, cid: 'cid', indexedAt: '2026-10-05T00:00:00Z', author: { did, handle: 'alice.bsky.social' }, record: { $type: 'app.bsky.feed.post', text: '本文', createdAt: '2026-10-05T00:00:00Z' } });
const parsed = { platform: 'bluesky', handle: did, rkey: 'rk' };
const url = 'https://bsky.app/profile/alice.bsky.social/post/rk';
function responses(p: unknown, profile: unknown = { did, handle: 'alice.bsky.social' }) {
  vi.stubGlobal('fetch', async (input: unknown) => new Response(JSON.stringify(String(input).includes('getProfile') ? profile : { thread: { $type: 'app.bsky.feed.defs#threadViewPost', post: p } }), { headers: { 'content-type': 'application/json' } }));
}
afterEach(() => vi.unstubAllGlobals());
describe('Bluesky の外部応答契約（不足項目の自動補完なし）', () => {
  test('省略可能なプロフィール項目と追加項目を受け入れる', () => {
    expect(BlueskyProfileSchema.parse({ did, handle: 'alice.bsky.social', future: [] })).toHaveProperty('future');
    expect(BlueskyPostSchema.safeParse(post()).success).toBe(true);
  });
  test('未知の union の同名 images フィールドを検証も解釈もしない', async () => {
    const p = { ...post(), embed: { $type: 'example.embed.images#view', images: 'unknown representation' } };
    expect(BlueskyPostSchema.safeParse(p).success).toBe(true);
    responses(p);
    const result = await fetchBlueskyPost(parsed, url);
    expect(result.text).toBe('本文');
    expect(result.media).toEqual([]);
    expect(result.mediaType).toBeNull();
    expect(result.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'invalidResponse' });
  });
  test('既知の images 型の不正な項目を未知型として通さない', () => {
    expect(BlueskyPostSchema.safeParse({ ...post(), embed: { $type: 'app.bsky.embed.images#view', images: 'bad' } }).success).toBe(false);
  });
  test('既知の投稿の不正な本文を通さない', async () => {
    responses({ ...post(), record: { ...post().record, text: 1 } });
    const result = await fetchBlueskyPost(parsed, url);
    expect(result.text).toBeNull();
    expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
  });
  test('負の件数は保存契約のエラーとして報告し、0に補正しない', async () => {
    responses({ ...post(), likeCount: -1 });
    const result = await fetchBlueskyPost(parsed, url);
    expect(result.likes).toBeNull();
    expect(result.acquisitionIssues).toContainEqual({ scope: 'post', reason: 'invalidResponse' });
  });
  test('未知の引用 value は投稿本文として取り込まない', async () => {
    responses({
      ...post(),
      embed: { $type: 'app.bsky.embed.record#view', record: { $type: 'app.bsky.embed.record#viewRecord', uri: `at://${did}/app.bsky.feed.post/quoted`, author: { did, handle: 'alice.bsky.social' }, value: { $type: 'example.future.record', text: '投稿ではない', createdAt: '2026-10-05T00:00:00Z' } } },
    });
    const result = await fetchBlueskyPost(parsed, url);
    expect(result.text).toBe('本文');
    expect(result.quotedPost).toBeNull();
    expect(result.acquisitionIssues).toContainEqual({ scope: 'media', reason: 'invalidResponse' });
  });
});
