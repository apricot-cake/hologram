'use strict';

// Correctness tests for three metadata.js edge cases (mocked fetch, no network):
//   - X: a quoted_tweet whose user has no screen_name must NOT build a
//     .../undefined/status/<id> quotedUrl.
//   - Bluesky: embed.record wraps lists / feeds / starter packs too — only a
//     quoted POST (feed.post uri) is a quote.
//   - Misskey: rec.url is the bare https://<instance>/notes/<id> permalink with
//     any query/hash from the saved URL stripped.
//
//   node scripts/test-metadata-correctness.cts

const assert = require('node:assert');
const { fetchXTweet, fetchBlueskyPost, fetchMisskeyNote, fetchPixivIllust, fetchPostMetadata } = require('../extension/utils/metadata.ts');

function mockFetch(routes) {
  global.fetch = async (url) => {
    const u = String(url);
    for (const [frag, body] of routes) {
      if (u.includes(frag)) return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
}

(async () => {
  // === X: quoted_tweet without screen_name ===
  mockFetch([
    [
      'cdn.syndication.twimg.com',
      {
        text: 'hi',
        mediaDetails: [],
        user: { name: 'Alice', screen_name: 'alice', id_str: '1' },
        quoted_tweet: { id_str: '999', user: { name: 'NoHandle' } }, // user present, no screen_name
      },
    ],
  ]);
  let r = await fetchXTweet({ platform: 'x', id: '123', screenName: 'alice' }, 'https://x.com/alice/status/123');
  assert.strictEqual(r.isQuote, true, 'X: quote still flagged');
  assert.strictEqual(r.quotedUrl, null, 'X: no quotedUrl when quoted user has no screen_name (not .../undefined/...)');

  mockFetch([
    [
      'cdn.syndication.twimg.com',
      {
        text: 'hi',
        mediaDetails: [],
        user: { screen_name: 'alice', id_str: '1' },
        quoted_tweet: { id_str: '999', user: { screen_name: 'bob' } },
      },
    ],
  ]);
  r = await fetchXTweet({ platform: 'x', id: '123', screenName: 'alice' }, 'https://x.com/alice/status/123');
  assert.strictEqual(r.quotedUrl, 'https://x.com/bob/status/999', 'X: quotedUrl built when screen_name present');

  // === Bluesky: list embed is NOT a quote; post embed IS ===
  const did = 'did:plc:abc';
  const post = (embedRecord) => ({
    author: { handle: 'alice.bsky.social', did, displayName: 'Alice' },
    record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
    embed: { $type: 'app.bsky.embed.record#view', record: embedRecord },
  });

  mockFetch([
    ['resolveHandle', { did }],
    ['getPostThread', { thread: { post: post({ uri: `at://${did}/app.bsky.graph.list/xyz` }) } }],
  ]);
  r = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
  assert.ok(!r.isQuote, 'Bluesky: a list embed is NOT a quote');
  assert.strictEqual(r.quotedUrl, null, 'Bluesky: list embed leaves quotedUrl null');

  mockFetch([
    ['resolveHandle', { did }],
    ['getPostThread', { thread: { post: post({ uri: 'at://did:plc:zzz/app.bsky.feed.post/qpost', author: { handle: 'quoted.bsky.social' } }) } }],
  ]);
  r = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
  assert.strictEqual(r.isQuote, true, 'Bluesky: a post embed IS a quote');
  assert.strictEqual(r.quotedUrl, 'https://bsky.app/profile/quoted.bsky.social/post/qpost', 'Bluesky: quotedUrl built for post embed');

  // === Misskey: rec.url is the bare permalink, query/hash stripped ===
  mockFetch([['/api/notes/show', { text: 'hi', user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z' }]]);
  r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'abc123' }, 'https://misskey.io/notes/abc123?foo=bar#frag');
  assert.strictEqual(r.url, 'https://misskey.io/notes/abc123', 'Misskey: rec.url is the bare permalink');

  // === Author profile: avatar (all PFs) + followers/createdAt (where exposed) ===

  // X: avatar from syndication user, _normal upscaled to _400x400. No public
  // follower count / account-creation date → both stay null (graceful hide).
  mockFetch([
    [
      'cdn.syndication.twimg.com',
      {
        text: 'hi',
        mediaDetails: [],
        user: { name: 'Alice', screen_name: 'alice', id_str: '1', profile_image_url_https: 'https://pbs.twimg.com/profile_images/9/abc_normal.jpg' },
      },
    ],
  ]);
  r = await fetchXTweet({ platform: 'x', id: '123', screenName: 'alice' }, 'https://x.com/alice/status/123');
  assert.strictEqual(r.avatar, 'https://pbs.twimg.com/profile_images/9/abc_400x400.jpg', 'X: avatar _normal upscaled to _400x400');
  assert.strictEqual(r.followers, null, 'X: followers stays null (not exposed)');
  assert.strictEqual(r.authorCreatedAt, null, 'X: account created date stays null');

  // Bluesky: avatar from the author view, followers + createdAt from getProfile
  // (which also overrides the avatar with the full-profile one).
  mockFetch([
    ['resolveHandle', { did }],
    [
      'getPostThread',
      {
        thread: {
          post: {
            author: { handle: 'alice.bsky.social', did, displayName: 'Alice', avatar: 'https://cdn.bsky/basic.jpg' },
            record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
          },
        },
      },
    ],
    ['getProfile', { followersCount: 4242, createdAt: '2023-05-06T07:08:09.000Z', avatar: 'https://cdn.bsky/full.jpg' }],
  ]);
  r = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
  assert.strictEqual(r.avatar, 'https://cdn.bsky/full.jpg', 'Bluesky: avatar from getProfile overrides author view');
  assert.strictEqual(r.followers, 4242, 'Bluesky: followers from getProfile');
  assert.strictEqual(r.authorCreatedAt, '2023-05-06T07:08:09.000Z', 'Bluesky: account created date');

  // Bluesky: getProfile failing (404) keeps the author-view avatar, nulls the rest.
  mockFetch([
    ['resolveHandle', { did }],
    [
      'getPostThread',
      {
        thread: {
          post: {
            author: { handle: 'alice.bsky.social', did, avatar: 'https://cdn.bsky/basic.jpg' },
            record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
          },
        },
      },
    ],
    // no getProfile route → 404
  ]);
  r = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
  assert.strictEqual(r.avatar, 'https://cdn.bsky/basic.jpg', 'Bluesky: getProfile failure keeps author-view avatar');
  assert.strictEqual(r.followers, null, 'Bluesky: followers null when getProfile fails');

  // Misskey: avatar from note.user, followers + createdAt from users/show.
  mockFetch([
    ['/api/notes/show', { text: 'hi', user: { id: 'u1', username: 'alice', avatarUrl: 'https://mi/lite.png' }, createdAt: '2026-01-01T00:00:00Z' }],
    ['/api/users/show', { followersCount: 99, createdAt: '2022-02-02T00:00:00.000Z', avatarUrl: 'https://mi/full.png' }],
  ]);
  r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'abc' }, 'https://misskey.io/notes/abc');
  assert.strictEqual(r.avatar, 'https://mi/full.png', 'Misskey: avatar from users/show');
  assert.strictEqual(r.followers, 99, 'Misskey: followers from users/show');
  assert.strictEqual(r.authorCreatedAt, '2022-02-02T00:00:00.000Z', 'Misskey: account created date');

  // Mastodon: avatar / followers / createdAt all inline on the status account.
  mockFetch([
    [
      '/api/v1/statuses/',
      {
        content: '<p>hi</p>',
        created_at: '2026-01-01T00:00:00Z',
        account: { id: '7', acct: 'alice', username: 'alice', display_name: 'Alice', avatar: 'https://m/av.png', followers_count: 1234, created_at: '2021-03-04T05:06:07.000Z' },
      },
    ],
  ]);
  r = await fetchPostMetadata('https://mastodon.social/@alice/123');
  assert.strictEqual(r.avatar, 'https://m/av.png', 'Mastodon: avatar from account');
  assert.strictEqual(r.followers, 1234, 'Mastodon: followers_count from account');
  assert.strictEqual(r.authorCreatedAt, '2021-03-04T05:06:07.000Z', 'Mastodon: account created date');

  // pixiv: avatar from /ajax/user (imageBig). No public follower count / creation
  // date → both null (graceful hide, like X).
  mockFetch([
    ['/ajax/illust/', { error: false, body: { illustTitle: 'T', userName: 'P', userId: '42', pageCount: 1, urls: { original: 'https://i.pximg/p0.jpg' }, tags: { tags: [] } } }],
    ['/ajax/user/', { error: false, body: { userId: '42', name: 'P', image: 'https://i.pximg/small.jpg', imageBig: 'https://i.pximg/big.jpg' } }],
  ]);
  r = await fetchPixivIllust({ platform: 'pixiv', id: '555' }, 'https://www.pixiv.net/artworks/555');
  assert.strictEqual(r.avatar, 'https://i.pximg/big.jpg', 'pixiv: avatar imageBig from user ajax');
  assert.strictEqual(r.followers, null, 'pixiv: followers null (not exposed)');
  assert.strictEqual(r.authorCreatedAt, null, 'pixiv: account created date null (not exposed)');

  console.log('PASS test-metadata-correctness: X undefined-guard, Bluesky quote gating, Misskey permalink, author profile (avatar/followers/createdAt)');
})().catch((e) => {
  console.error('FAIL test-metadata-correctness:', e && e.message ? e.message : e);
  process.exit(1);
});
