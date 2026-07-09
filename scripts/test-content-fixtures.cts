'use strict';

// Offline pure-unit tests for extension/site-detect.js's DOM-reading platform
// detection / post-element / permalink extraction functions, run under jsdom
// against hand-authored HTML fixtures (scripts/fixtures/content/*.html).
//
// These fixtures are NOT literal scraped captures of X/Bluesky/Misskey/
// Mastodon/pixiv (those all require an authenticated live session, which this
// suite deliberately avoids) — they're minimal reproductions of the real
// selector/testid shape the code targets, built to cover the audit-fixed edge
// cases (quote-vs-quoted, reply-vs-parent, grid-neighbor, avatar-vs-artwork;
// see the "(audit 2026-06-11)" comments in extension/site-detect.ts). This
// catches "my code change broke the parsing logic" regressions; it can't
// catch "the site changed its DOM" — that's what the live e2e suite
// (scripts/e2e-capture-test.cts) is for. See BACKLOG "拡張キャプチャの fixture
// テスト化".
//
// Capture-rect functions (getMisskeyCaptureRect / getPixivCaptureRect) aren't
// covered here: they depend on getBoundingClientRect, which jsdom doesn't lay
// out (always zero-rect) — real layout is only exercised by the live suite.
//
//   node scripts/test-content-fixtures.cts

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const siteDetect = require('../extension/dist/site-detect.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'content');

let pass = 0;
let fail = 0;

function check(label, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL   ${label}`);
  }
}

// Installs the fixture's DOM as the global browser environment (window,
// document, location, …) — the same globals a real content-script execution
// context provides — for the duration of `fn`, then restores whatever was
// there before. site-detect.js's functions read these off the global object
// at call time (no module-load-time DOM access), so swapping per fixture is safe.
function withFixture(fixtureFile, url, fn) {
  const html = fs.readFileSync(path.join(FIXTURES_DIR, fixtureFile), 'utf8');
  const dom = new JSDOM(html, { url });

  const keys = ['window', 'document', 'location', 'getComputedStyle', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'HTMLImageElement', 'Node'];
  const saved: Record<string, any> = {};
  for (const k of keys) saved[k] = global[k];
  for (const k of keys) global[k] = dom.window[k];

  try {
    fn(dom);
  } finally {
    for (const k of keys) global[k] = saved[k];
  }
}

// Re-points the fixture's location without reloading the document, so one
// fixture document can stand in for multiple same-platform page loads.
function setLocation(dom, url) {
  dom.reconfigure({ url });
  global.location = dom.window.location;
}

// === X (Twitter) ===
withFixture('x.html', 'https://x.com/home', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  check('x: platform detected', config?.platform === 'x');

  check('x: normal permalink (A-1b/A-1c/A-1h)', config.getPermalink(document.getElementById('tweetNormal')) === 'https://x.com/alice/status/111');
  check('x: quote picks the quoting tweet, not the quoted card (A-1e)', config.getPermalink(document.getElementById('tweetQuote')) === 'https://x.com/bob/status/222');
  check('x: retweet ignores the sibling social-context link (A-1d)', config.getPermalink(document.getElementById('tweetRetweet')) === 'https://x.com/erin/status/444');

  setLocation(dom, 'https://x.com/frank/status/555');
  check('x: falls back to location.href with no in-article link (A-1b/A-1c)', config.getPermalink(document.getElementById('tweetNoLink')) === 'https://x.com/frank/status/555');
});

// === Bluesky ===
withFixture('bluesky.html', 'https://bsky.app/home', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  check('bluesky: platform detected', config?.platform === 'bluesky');

  check('bluesky: own permalink wins over an in-text same-author decoy (A-2a)', config.getPermalink(document.getElementById('bskyNormal')) === 'https://bsky.app/profile/alice.bsky.social/post/3kabc');
  check('bluesky: individual thread-item permalink (A-2b)', config.getPermalink(document.getElementById('bskyIndividual')) === 'https://bsky.app/profile/bob.bsky.social/post/xyz789');

  setLocation(dom, 'https://bsky.app/profile/mallory.bsky.social/post/mainpost');
  check('bluesky: quote detail page ignores the embedded quote link, falls back to location (A-2f)', config.getPermalink(document.getElementById('bskyQuote')) === 'https://bsky.app/profile/mallory.bsky.social/post/mainpost');
});

// === Misskey ===
withFixture('misskey.html', 'https://misskey.io/', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  check('misskey: platform detected via --MI_THEME-accent + note shape', config?.platform === 'misskey');

  check('misskey: normal note permalink (A-3a)', config.getPermalink(document.getElementById('noteNormal')) === 'https://misskey.io/notes/9normal');

  const replyNote = document.getElementById('noteReply');
  const parentPreviewLink = replyNote.querySelector('.reply-parent-preview a');
  check('misskey: click inside the parent preview resolves to the reply note, not the preview (A-3e)', siteDetect.findMisskeyPostElement(parentPreviewLink) === replyNote);
  check("misskey: reply permalink is its own, not the parent note's (A-3e)", config.getPermalink(replyNote) === 'https://misskey.io/notes/9reply');

  setLocation(dom, 'https://misskey.io/notes/9fallback');
  check('misskey: falls back to location.href when the article has no link (A-3b)', config.getPermalink(document.getElementById('noteFallback')) === 'https://misskey.io/notes/9fallback');
});

// === Mastodon ===
withFixture('mastodon.html', 'https://mastodon.social/@alice', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  check('mastodon: platform detected via meta[application-name] (A-4a/A-4b)', config?.platform === 'mastodon');

  check('mastodon: normal status permalink', config.getPermalink(document.getElementById('statusNormal')) === 'https://mastodon.social/@alice/109252111');

  const quotingStatus = document.getElementById('statusQuote');
  const quotedContent = document.querySelector('#statusQuoteInner .status__content');
  check('mastodon: click inside the quote preview resolves to the quoting status, not the quoted one (A-4f)', siteDetect.findMastodonPostElement(quotedContent) === quotingStatus);
  check("mastodon: quoting status permalink is its own, not the quoted post's (A-4f)", config.getPermalink(quotingStatus) === 'https://mastodon.social/@bob/2001');
});

// === pixiv ===
withFixture('pixiv.html', 'https://www.pixiv.net/tags/foo', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  check('pixiv: platform detected', config?.platform === 'pixiv');

  const imgB = document.getElementById('pxImgB');
  check("pixiv: grid click resolves its own image, not the neighbor's (A-5c)", config.getPermalink(config.findPostElement(imgB)) === 'https://www.pixiv.net/artworks/1002');
});

withFixture('pixiv-artwork.html', 'https://www.pixiv.net/artworks/2001', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  const mainFigure = document.getElementById('mainFigure');
  check('pixiv: clicking the figure falls back to its own image (A-5a)', config.getPermalink(config.findPostElement(mainFigure)) === 'https://www.pixiv.net/artworks/2001');
});

withFixture('pixiv-artwork-comments.html', 'https://www.pixiv.net/artworks/3001', (dom) => {
  const { document } = dom.window;
  const config = siteDetect.getSiteConfig();
  const avatarImg = document.getElementById('avatarImg');
  const resolved = config.findPostElement(avatarImg);
  check('pixiv: comment-avatar click resolves to the artwork figure, not the avatar (A-5e)', resolved?.id === 'mainFigure2');
  check("pixiv: permalink from an avatar click is the artwork's, not fabricated from the avatar (A-5e)", config.getPermalink(resolved) === 'https://www.pixiv.net/artworks/3001');
});

console.log(`content-fixtures: ${pass} passed, ${fail} failed`);
console.log(fail === 0 ? 'CONTENT_FIXTURES_TEST_PASS' : 'CONTENT_FIXTURES_TEST_FAIL');
process.exit(fail === 0 ? 0 : 1);
