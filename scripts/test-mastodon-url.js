'use strict';

// Unit test (mocked fetch, no network): the Mastodon record keeps a real
// Mastodon-format canonical URL, but falls back to the captured instance URL for
// posts that federated in from non-Mastodon software (Lemmy/PieFed/...), whose
// canonical URL doesn't open as a status.
//
//   node scripts/test-mastodon-url.js

const { fetchPostMetadata } = require('../extension/dist/metadata');

function mockStatus(statusUrl) {
  global.fetch = async (u) => {
    if (String(u).includes('/api/v1/statuses/')) {
      return {
        ok: true,
        json: async () => ({
          url: statusUrl,
          content: '<p>hi</p>',
          created_at: '2026-01-01T00:00:00Z',
          account: { acct: 'a', username: 'a', id: '1' },
          media_attachments: [],
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };
}

(async () => {
  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + label);
    if (!cond) ok = false;
  };

  const captured = 'https://mastodon.social/@hitstun@feddit.online/113';
  mockStatus('https://feddit.online/c/FloatingIsFun/p/1744781/welcome-to-hell');
  let r = await fetchPostMetadata(captured);
  check('federated Lemmy canonical -> keep captured instance URL', r.url === captured);

  const cap2 = 'https://mastodon.social/@bob/200';
  mockStatus('https://other.example/@bob/999');
  r = await fetchPostMetadata(cap2);
  check('native Mastodon canonical (other home instance) -> keep canonical', r.url === 'https://other.example/@bob/999');

  mockStatus('https://mastodon.social/@bob/200');
  r = await fetchPostMetadata(cap2);
  check('same-instance canonical -> keep canonical', r.url === 'https://mastodon.social/@bob/200');

  console.log('\n' + (ok ? 'MASTODON_URL_TEST_PASS' : 'MASTODON_URL_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
})();
