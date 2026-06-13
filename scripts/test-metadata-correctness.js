'use strict';

// Correctness tests for three metadata.js edge cases (mocked fetch, no network):
//   - X: a quoted_tweet whose user has no screen_name must NOT build a
//     .../undefined/status/<id> quotedUrl.
//   - Bluesky: embed.record wraps lists / feeds / starter packs too — only a
//     quoted POST (feed.post uri) is a quote.
//   - Misskey: rec.url is the bare https://<instance>/notes/<id> permalink with
//     any query/hash from the saved URL stripped.
//
//   node scripts/test-metadata-correctness.js

const assert = require('assert');
const { fetchXTweet, fetchBlueskyPost, fetchMisskeyNote } = require('../extension/metadata.js');

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
  mockFetch([['cdn.syndication.twimg.com', {
    text: 'hi', mediaDetails: [], user: { name: 'Alice', screen_name: 'alice', id_str: '1' },
    quoted_tweet: { id_str: '999', user: { name: 'NoHandle' } }   // user present, no screen_name
  }]]);
  let r = await fetchXTweet({ platform: 'x', id: '123', screenName: 'alice' }, 'https://x.com/alice/status/123');
  assert.strictEqual(r.isQuote, true, 'X: quote still flagged');
  assert.strictEqual(r.quotedUrl, null, 'X: no quotedUrl when quoted user has no screen_name (not .../undefined/...)');

  mockFetch([['cdn.syndication.twimg.com', {
    text: 'hi', mediaDetails: [], user: { screen_name: 'alice', id_str: '1' },
    quoted_tweet: { id_str: '999', user: { screen_name: 'bob' } }
  }]]);
  r = await fetchXTweet({ platform: 'x', id: '123', screenName: 'alice' }, 'https://x.com/alice/status/123');
  assert.strictEqual(r.quotedUrl, 'https://x.com/bob/status/999', 'X: quotedUrl built when screen_name present');

  // === Bluesky: list embed is NOT a quote; post embed IS ===
  const did = 'did:plc:abc';
  const post = (embedRecord) => ({
    author: { handle: 'alice.bsky.social', did, displayName: 'Alice' },
    record: { text: 'hi', createdAt: '2026-01-01T00:00:00Z' },
    embed: { $type: 'app.bsky.embed.record#view', record: embedRecord }
  });

  mockFetch([
    ['resolveHandle', { did }],
    ['getPostThread', { thread: { post: post({ uri: `at://${did}/app.bsky.graph.list/xyz` }) } }]
  ]);
  r = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
  assert.ok(!r.isQuote, 'Bluesky: a list embed is NOT a quote');
  assert.strictEqual(r.quotedUrl, null, 'Bluesky: list embed leaves quotedUrl null');

  mockFetch([
    ['resolveHandle', { did }],
    ['getPostThread', { thread: { post: post({ uri: 'at://did:plc:zzz/app.bsky.feed.post/qpost', author: { handle: 'quoted.bsky.social' } }) } }]
  ]);
  r = await fetchBlueskyPost({ platform: 'bluesky', handle: 'alice.bsky.social', rkey: 'rk' }, 'https://bsky.app/profile/alice.bsky.social/post/rk');
  assert.strictEqual(r.isQuote, true, 'Bluesky: a post embed IS a quote');
  assert.strictEqual(r.quotedUrl, 'https://bsky.app/profile/quoted.bsky.social/post/qpost', 'Bluesky: quotedUrl built for post embed');

  // === Misskey: rec.url is the bare permalink, query/hash stripped ===
  mockFetch([['/api/notes/show', { text: 'hi', user: { username: 'alice' }, createdAt: '2026-01-01T00:00:00Z' }]]);
  r = await fetchMisskeyNote({ platform: 'misskey', host: 'misskey.io', noteId: 'abc123' }, 'https://misskey.io/notes/abc123?foo=bar#frag');
  assert.strictEqual(r.url, 'https://misskey.io/notes/abc123', 'Misskey: rec.url is the bare permalink');

  console.log('PASS test-metadata-correctness: X undefined-guard, Bluesky quote gating, Misskey permalink');
})().catch((e) => { console.error('FAIL test-metadata-correctness:', e && e.message ? e.message : e); process.exit(1); });
