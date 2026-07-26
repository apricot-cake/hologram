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

  // === #119 St1: video/gif direct-URL extraction (X / Misskey / Mastodon) ===

  // X: animated_gif picks its sole mp4 variant; video picks the HIGHEST-bitrate
  // mp4 variant (ignoring the non-mp4 HLS playlist entry); poster is the same
  // still-image URL a photo would use (?name=orig appended).
  mockFetch([
    [
      'cdn.syndication.twimg.com',
      {
        text: 'hi',
        user: { screen_name: 'alice', id_str: '1' },
        mediaDetails: [
          {
            type: 'video',
            media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/abc.jpg',
            video_info: {
              variants: [
                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
                { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
                { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
              ],
            },
          },
        ],
      },
    ],
  ]);
  r = await fetchXTweet({ platform: 'x', id: '1', screenName: 'alice' }, 'https://x.com/alice/status/1');
  assert.strictEqual(r.media.length, 1, 'X: video tweet yields one media entry');
  assert.strictEqual(r.media[0].type, 'video', 'X: entry type is video');
  assert.strictEqual(r.media[0].url, 'https://video.twimg.com/high.mp4', 'X: highest-bitrate mp4 variant chosen');
  assert.strictEqual(r.media[0].poster, 'https://pbs.twimg.com/tweet_video_thumb/abc.jpg?name=orig', 'X: poster is the still image at ?name=orig');

  mockFetch([
    [
      'cdn.syndication.twimg.com',
      {
        text: 'hi',
        user: { screen_name: 'alice', id_str: '1' },
        mediaDetails: [{ type: 'animated_gif', media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg', video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4' }] } }],
      },
    ],
  ]);
  r = await fetchXTweet({ platform: 'x', id: '2', screenName: 'alice' }, 'https://x.com/alice/status/2');
  assert.strictEqual(r.media[0].type, 'gif', 'X: animated_gif maps to type gif');
  assert.strictEqual(r.media[0].url, 'https://video.twimg.com/g.mp4', 'X: animated_gif uses its sole mp4 variant');

  // Misskey: DriveFile exposes a direct url for video files; thumbnailUrl is the poster.
  mockFetch([
    [
      '/api/notes/show',
      {
        text: 'hi',
        user: { username: 'alice' },
        createdAt: '2026-01-01T00:00:00Z',
        files: [{ type: 'video/mp4', url: 'https://mi/clip.mp4', thumbnailUrl: 'https://mi/clip-thumb.jpg', comment: null }],
      },
    ],
  ]);
  r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'v1' }, 'https://misskey.io/notes/v1');
  assert.strictEqual(r.media.length, 1, 'Misskey: video note yields one media entry');
  assert.strictEqual(r.media[0].type, 'video', 'Misskey: entry type is video');
  assert.strictEqual(r.media[0].url, 'https://mi/clip.mp4', 'Misskey: url is the DriveFile direct url');
  assert.strictEqual(r.media[0].poster, 'https://mi/clip-thumb.jpg', 'Misskey: poster is thumbnailUrl');

  // Misskey: a REAL image/gif is a still transport (unlike X/Mastodon's mp4-
  // backed "gif" types) — its per-item download `type` must stay undefined so
  // the native host fetches it as a still (MEDIA_MIME_EXT already handles
  // image/gif), not the video path.
  mockFetch([
    [
      '/api/notes/show',
      {
        text: 'hi',
        user: { username: 'alice' },
        createdAt: '2026-01-01T00:00:00Z',
        files: [{ type: 'image/gif', url: 'https://mi/anim.gif', thumbnailUrl: 'https://mi/anim-thumb.jpg', comment: null }],
      },
    ],
  ]);
  r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'v2' }, 'https://misskey.io/notes/v2');
  assert.strictEqual(r.mediaType, 'gif', 'Misskey: note-level mediaType is still gif (UI label unaffected)');
  assert.strictEqual(r.media.length, 1, 'Misskey: real gif note yields one media entry');
  assert.strictEqual(r.media[0].url, 'https://mi/anim.gif', 'Misskey: url is the real gif file');
  assert.strictEqual(r.media[0].type, undefined, 'Misskey: real image/gif has no download type (still-image path)');
  assert.strictEqual(r.media[0].poster, undefined, 'Misskey: real image/gif carries no poster (not needed for a still)');

  // Mastodon: gifv is an mp4 loop (type 'gif'); preview_url is the poster.
  mockFetch([
    [
      '/api/v1/statuses/',
      {
        content: '<p>hi</p>',
        created_at: '2026-01-01T00:00:00Z',
        account: { acct: 'alice', username: 'alice' },
        media_attachments: [{ type: 'gifv', url: 'https://m/loop.mp4', preview_url: 'https://m/loop-preview.jpg', description: null }],
      },
    ],
  ]);
  r = await fetchPostMetadata('https://mastodon.social/@alice/456');
  assert.strictEqual(r.media.length, 1, 'Mastodon: gifv status yields one media entry');
  assert.strictEqual(r.media[0].type, 'gif', 'Mastodon: gifv maps to type gif');
  assert.strictEqual(r.media[0].url, 'https://m/loop.mp4', 'Mastodon: url is the attachment url (the mp4 itself)');
  assert.strictEqual(r.media[0].poster, 'https://m/loop-preview.jpg', 'Mastodon: poster is preview_url');

  console.log('PASS test-metadata-correctness: X undefined-guard, Bluesky quote gating, Misskey permalink, author profile (avatar/followers/createdAt), #119 video/gif extraction');
})().catch((e) => {
  console.error('FAIL test-metadata-correctness:', e && e.message ? e.message : e);
  process.exit(1);
});
