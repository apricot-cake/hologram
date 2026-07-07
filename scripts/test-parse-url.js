'use strict';

// Regression test for parsePostUrl (metadata.js): post URL → platform identity.
// This is the first thing that runs on every capture and the first thing a
// platform URL-scheme change breaks. It's a pure function (no DOM, no network),
// so it runs under plain node.
//
//   node scripts/test-parse-url.js

const assert = require('node:assert');
const { parsePostUrl } = require('../extension/dist/metadata.js');

const cases = [
  // X / Twitter, incl. the subdomains content.js accepts (pro./mobile.).
  ['https://x.com/alice/status/123', { platform: 'x', id: '123', screenName: 'alice' }],
  ['https://twitter.com/bob/status/456', { platform: 'x', id: '456', screenName: 'bob' }],
  ['https://pro.x.com/carol/status/789', { platform: 'x', id: '789', screenName: 'carol' }],
  ['https://mobile.twitter.com/dave/status/111', { platform: 'x', id: '111', screenName: 'dave' }],
  ['https://x.com/alice/status/123/photo/1', { platform: 'x', id: '123', screenName: 'alice' }],

  // Bluesky.
  ['https://bsky.app/profile/alice.bsky.social/post/3kabc', { platform: 'bluesky', handle: 'alice.bsky.social', rkey: '3kabc' }],
  ['https://bsky.app/profile/alice.bsky.social/post/3kabc?ref=x', { platform: 'bluesky', handle: 'alice.bsky.social', rkey: '3kabc' }],
  // The media tab is a profile sub-page, NOT a post — must not parse as one.
  ['https://bsky.app/profile/alice.bsky.social/media', null],
  ['https://bsky.app/profile/alice.bsky.social', null],

  // Mastodon status (/@user/<numericId>) vs profile sub-pages (/@user/media).
  ['https://mastodon.social/@alice/109252111', { platform: 'mastodon', host: 'mastodon.social', id: '109252111' }],
  ['https://mastodon.social/@alice/media', null],
  ['https://mastodon.social/@alice', null],

  // Misskey note.
  ['https://misskey.io/notes/9abcdef', { platform: 'misskey', host: 'misskey.io', noteId: '9abcdef' }],

  // pixiv artwork, with and without a locale prefix.
  ['https://www.pixiv.net/artworks/12345', { platform: 'pixiv', id: '12345' }],
  ['https://www.pixiv.net/en/artworks/67890', { platform: 'pixiv', id: '67890' }],
  ['https://pixiv.net/artworks/24680', { platform: 'pixiv', id: '24680' }],

  // Non-posts / garbage → null (a null record saves as platform:null, hidden in
  // the viewer — content.js bails before that, but the parser must say null).
  ['https://example.com/foo', null],
  ['https://x.com/alice', null],
  ['not a url', null],
  ['', null],
  [null, null],
];

let pass = 0;
let fail = 0;
for (const [url, expected] of cases) {
  let actual;
  try {
    actual = parsePostUrl(url);
  } catch (e) {
    console.error(`THREW  ${JSON.stringify(url)}: ${e.message}`);
    fail++;
    continue;
  }
  try {
    assert.deepStrictEqual(actual, expected);
    pass++;
  } catch {
    fail++;
    console.error(`FAIL   ${JSON.stringify(url)}`);
    console.error(`         expected ${JSON.stringify(expected)}`);
    console.error(`         actual   ${JSON.stringify(actual)}`);
  }
}

console.log(`parse-url: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'PARSE_URL_TEST_PASS' : 'PARSE_URL_TEST_FAIL');
process.exit(fail === 0 ? 0 : 1);
