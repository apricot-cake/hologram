// node shared/sns-api-client.test.mjs
import assert from 'node:assert/strict';
import {
  parsePostUrl,
  fetchXEngagement,
  fetchBlueskyEngagement,
  fetchPixivEngagement
} from './sns-api-client.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// === parsePostUrl ===

test('parsePostUrl: X', () => {
  assert.deepEqual(
    parsePostUrl('https://x.com/ihana_k/status/2050856947520569743'),
    { platform: 'x', handle: 'ihana_k', postId: '2050856947520569743' }
  );
});

test('parsePostUrl: twitter.com 旧ドメイン', () => {
  assert.equal(parsePostUrl('https://twitter.com/foo/status/123')?.platform, 'x');
});

test('parsePostUrl: Bluesky', () => {
  assert.deepEqual(
    parsePostUrl('https://bsky.app/profile/tkugane353.bsky.social/post/3mkfosw23xc2n'),
    { platform: 'bluesky', handle: 'tkugane353.bsky.social', postId: '3mkfosw23xc2n' }
  );
});

test('parsePostUrl: pixiv', () => {
  assert.deepEqual(
    parsePostUrl('https://www.pixiv.net/artworks/143989694'),
    { platform: 'pixiv', postId: '143989694' }
  );
});

test('parsePostUrl: pixiv 言語サブパス', () => {
  assert.equal(parsePostUrl('https://www.pixiv.net/en/artworks/143989694')?.postId, '143989694');
});

test('parsePostUrl: 不明なドメインは null', () => {
  assert.equal(parsePostUrl('https://example.com/foo'), null);
});

test('parsePostUrl: 空 / 不正 URL は null', () => {
  assert.equal(parsePostUrl(''), null);
  assert.equal(parsePostUrl(null), null);
  assert.equal(parsePostUrl('not a url'), null);
});

// === fetchXEngagement ===

const mockFetch = (responses) => {
  let i = 0;
  return async (url, opts) => {
    const r = responses[i++];
    if (typeof r === 'function') return r(url, opts);
    return r;
  };
};

const mockJsonResponse = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  async json() { return body; }
});

test('fetchXEngagement: 200 で synced + likes/replies', async () => {
  const fetch = mockFetch([
    mockJsonResponse({ favorite_count: 42, conversation_count: 5 })
  ]);
  const result = await fetchXEngagement({ postId: '123', fetch });
  assert.equal(result.status, 'synced');
  assert.deepEqual(result.engagement, { likes: 42, replies: 5 });
});

test('fetchXEngagement: 404 で deleted', async () => {
  const fetch = mockFetch([mockJsonResponse(null, 404)]);
  const result = await fetchXEngagement({ postId: '123', fetch });
  assert.equal(result.status, 'deleted');
});

test('fetchXEngagement: 401/403 で private', async () => {
  for (const code of [401, 403]) {
    const fetch = mockFetch([mockJsonResponse(null, code)]);
    const result = await fetchXEngagement({ postId: '123', fetch });
    assert.equal(result.status, 'private', `code=${code}`);
  }
});

test('fetchXEngagement: その他エラーは throw', async () => {
  const fetch = mockFetch([mockJsonResponse(null, 500)]);
  await assert.rejects(fetchXEngagement({ postId: '123', fetch }), /500/);
});

// === fetchBlueskyEngagement ===

test('fetchBlueskyEngagement: 200 で全 engagement', async () => {
  const fetch = mockFetch([mockJsonResponse({
    thread: {
      post: { likeCount: 10, repostCount: 2, replyCount: 3, quoteCount: 1 }
    }
  })]);
  const result = await fetchBlueskyEngagement({ handle: 'foo.bsky.social', postId: 'abc', fetch });
  assert.equal(result.status, 'synced');
  assert.deepEqual(result.engagement, { likes: 10, reposts: 2, replies: 3, quotes: 1 });
});

test('fetchBlueskyEngagement: 400/404 で deleted', async () => {
  for (const code of [400, 404]) {
    const fetch = mockFetch([mockJsonResponse(null, code)]);
    const result = await fetchBlueskyEngagement({ handle: 'h', postId: 'p', fetch });
    assert.equal(result.status, 'deleted');
  }
});

test('fetchBlueskyEngagement: post 不在で deleted', async () => {
  const fetch = mockFetch([mockJsonResponse({ thread: {} })]);
  const result = await fetchBlueskyEngagement({ handle: 'h', postId: 'p', fetch });
  assert.equal(result.status, 'deleted');
});

// === fetchPixivEngagement ===

test('fetchPixivEngagement: 200 で likes/views/bookmarks/replies', async () => {
  const fetch = mockFetch([mockJsonResponse({
    error: false,
    body: { likeCount: 100, commentCount: 5, viewCount: 5000, bookmarkCount: 200 }
  })]);
  const result = await fetchPixivEngagement({ postId: '42', fetch });
  assert.equal(result.status, 'synced');
  assert.deepEqual(result.engagement, { likes: 100, replies: 5, views: 5000, bookmarks: 200 });
});

test('fetchPixivEngagement: 200 + error:true で private', async () => {
  const fetch = mockFetch([mockJsonResponse({ error: true, message: 'auth required' })]);
  const result = await fetchPixivEngagement({ postId: '42', fetch });
  assert.equal(result.status, 'private');
});

test('fetchPixivEngagement: 404 で deleted', async () => {
  const fetch = mockFetch([mockJsonResponse(null, 404)]);
  const result = await fetchPixivEngagement({ postId: '42', fetch });
  assert.equal(result.status, 'deleted');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  PASS  ${t.name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${t.name}`);
    console.log(`        ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
