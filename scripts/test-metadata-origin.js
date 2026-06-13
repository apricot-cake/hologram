'use strict';

// Origin-constraint (SSRF) test for metadata.js#fetchPostMetadata's expectedHost
// option. Misskey/Mastodon derive their API host from the post URL, so a hostile
// page could aim the extension's privileged fetch at an arbitrary host. With
// expectedHost set, a mismatched instance host must NOT be fetched; a matching
// one (and X/Bluesky/pixiv, whose hosts are fixed) must proceed. Mocked fetch,
// no network.
//
//   node scripts/test-metadata-origin.js

const assert = require('assert');
const { fetchPostMetadata } = require('../extension/metadata.js');

const calls = [];
global.fetch = async (url) => {
  calls.push(String(url));
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
const reset = () => { calls.length = 0; };

(async () => {
  // 1. Misskey, mismatched host + expectedHost -> blocked, never fetched.
  reset();
  let r = await fetchPostMetadata('https://evil.example/notes/abc', { expectedHost: 'misskey.io' });
  assert.strictEqual(r.platform, 'misskey', 'still tagged misskey');
  assert.strictEqual(calls.length, 0, 'mismatched misskey host must NOT be fetched');

  // 2. Misskey, matching host -> fetched.
  reset();
  r = await fetchPostMetadata('https://misskey.io/notes/abc', { expectedHost: 'misskey.io' });
  assert.ok(calls.some((u) => u.includes('misskey.io/api/notes/show')), 'matched misskey host is fetched');

  // 3. Misskey, no expectedHost -> unconstrained (backward compatible).
  reset();
  r = await fetchPostMetadata('https://misskey.io/notes/abc');
  assert.ok(calls.length > 0, 'no expectedHost = no constraint');

  // 4. Mastodon, mismatched host -> blocked.
  reset();
  r = await fetchPostMetadata('https://evil.example/@u/12345', { expectedHost: 'mastodon.social' });
  assert.strictEqual(r.platform, 'mastodon', 'still tagged mastodon');
  assert.strictEqual(calls.length, 0, 'mismatched mastodon host must NOT be fetched');

  // 5. Mastodon, matching host -> fetched.
  reset();
  r = await fetchPostMetadata('https://mastodon.social/@u/12345', { expectedHost: 'mastodon.social' });
  assert.ok(calls.some((u) => u.includes('mastodon.social/api/v1/statuses/')), 'matched mastodon host is fetched');

  // 6. X has a FIXED API host -> a mismatched expectedHost must not gate it.
  reset();
  r = await fetchPostMetadata('https://x.com/u/status/123', { expectedHost: 'totally-different.example' });
  assert.ok(calls.length > 0, 'X must not be gated by expectedHost (fixed API host)');

  console.log('PASS test-metadata-origin: cross-host misskey/mastodon refused, matched + fixed-host fetched');
})().catch((e) => { console.error('FAIL test-metadata-origin:', e && e.message ? e.message : e); process.exit(1); });
