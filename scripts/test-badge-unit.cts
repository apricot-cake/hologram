'use strict';

// Offline pure-unit test for extension/badge.js — the timeline "saved" mark
// (#54). Runs the BUILT content script inside jsdom with the same globals a real
// injection gives it (glass-ui.js and site-detect.js evaluated first, in manifest
// order, into the same window) and a stubbed chrome API.
//
// What this covers is the script's own wiring: which posts get asked about, that
// they are asked in ONE batch, that an answer turns into exactly one mark in the
// overlay layer, that the layer never touches the post's own subtree, and that
// the options switch adds and removes marks live. What it CANNOT cover is
// whether the per-platform selectors still match the real X / Bluesky / pixiv
// DOM — the fixtures are our own markup, so they only ever prove our code reads
// what we wrote (same limit as test-content-fixtures.cts; the live canary is
// scripts/e2e-capture-test.cts).
//
//   node scripts/test-badge-unit.cts

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'extension', 'dist');

let pass = 0;
let fail = 0;
const check = (label, cond) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL   ${label}`);
  }
};

// Two X posts, each with a photo — the shape badge.js's x branch targets.
const X_HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="100"><img src="https://pbs.twimg.com/media/AAA.jpg"></div>
    </article>
    <article data-testid="tweet" id="p2">
      <a href="/bob/status/222"><time datetime="2026-07-01T00:00:00Z">2h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="400"><img src="https://pbs.twimg.com/media/BBB.jpg"></div>
    </article>
  </div>
</body></html>`;

// runScripts:'outside-only' gives the window a real script context for
// window.eval below (the page's own <script>s stay inert — the fixture has none).
const dom = new JSDOM(X_HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
const { window } = dom;

// --- browser bits jsdom doesn't implement, stubbed to the minimum badge.js uses.
// jsdom lays nothing out (every rect is zero, which badge.js correctly reads as
// "too small to mark"), so the fixture declares its own geometry: an element with
// data-rect-top is a 300px media box at that offset, everything else is zero.
window.Element.prototype.animate = () => ({ cancel() {}, finish() {} });
window.Element.prototype.getBoundingClientRect = function () {
  const declared = this.getAttribute?.('data-rect-top');
  if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  const top = Number(declared);
  return { left: 50, top, right: 350, bottom: top + 300, width: 300, height: 300, x: 50, y: top };
};
window.requestAnimationFrame = (fn) => {
  fn(0);
  return 0;
};

// IntersectionObserver: the test drives visibility by hand.
let ioCallback: any = null;
const observed = new Set<any>();
window.IntersectionObserver = class {
  constructor(cb) {
    ioCallback = cb;
  }
  observe(el) {
    observed.add(el);
  }
  unobserve(el) {
    observed.delete(el);
  }
  disconnect() {
    observed.clear();
  }
} as any;
const intersect = (ids, isIntersecting) => ioCallback(ids.map((id) => ({ target: window.document.getElementById(id), isIntersecting })));

// chrome API stub. `sent` records every checkSaved batch so the test can assert
// the debounce actually batched instead of asking once per post.
const sent: any[] = [];
let savedAnswer: Record<string, string | null> = {};
const storage: Record<string, unknown> = {};
const storageListeners: any[] = [];
const runtimeListeners: any[] = [];
window.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    sendMessage: (msg, cb) => {
      sent.push(msg);
      const results = {};
      for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
      cb?.({ ok: true, results });
    },
    onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
  },
  storage: {
    local: {
      get: (key, cb) => cb({ [key]: storage[key] }),
      set: (obj) => Object.assign(storage, obj),
    },
    onChanged: { addListener: (fn) => storageListeners.push(fn) },
  },
} as any;
const setSetting = (key, value) => {
  storage[key] = value;
  for (const fn of storageListeners) fn({ [key]: { newValue: value } }, 'local');
};

// --- inject, in manifest order. Evaluated as ONE program because that is what
// the isolated world gives them: separate files sharing a single scope, which is
// how badge.js reaches site-detect.js's getSiteConfig at all.
window.eval(['glass-ui.js', 'site-detect.js', 'badge.js'].map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n;\n'));

const layerBadges = (): any[] => Array.from(window.document.querySelectorAll('#__hologramSavedLayer > div'));
const settle = () => new Promise((r) => setTimeout(r, 400)); // past the 300ms query debounce

(async () => {
  check('both posts are observed after the initial scan', observed.size === 2);

  // --- only the visible posts are asked about, and in one batch ---
  savedAnswer = { 'https://x.com/alice/status/111': '1780000000000-aa' };
  intersect(['p1', 'p2'], true);
  await settle();
  check('one batched query, not one per post', sent.length === 1);
  check('the batch carried both permalinks', sent[0].urls.length === 2 && sent[0].urls.includes('https://x.com/alice/status/111') && sent[0].urls.includes('https://x.com/bob/status/222'));
  check(
    'the extension sent permalinks, not normalized keys',
    sent[0].urls.every((u) => u.startsWith('https://x.com/')),
  );

  // --- the answer becomes exactly one mark, on the saved post only ---
  check('one mark for the one saved post', layerBadges().length === 1);
  check('the mark sits on the saved post’s photo', layerBadges()[0].style.left === '56px' && layerBadges()[0].style.top === '106px');
  check('the post’s own subtree is untouched', window.document.getElementById('p1').querySelectorAll('div').length === 1);
  check('the overlay layer is inert to pointers', (window.document.getElementById('__hologramSavedLayer') as any).style.pointerEvents === 'none');

  // --- an answered post is not asked about again when it scrolls back ---
  intersect(['p1', 'p2'], false);
  await settle();
  check('marks are dropped when the posts scroll away', layerBadges().length === 0);
  intersect(['p1'], true);
  await settle();
  check('no second query for an already-answered post', sent.length === 1);
  check('the mark comes back from the cached answer', layerBadges().length === 1);

  // --- a save made in this tab lights the mark without another scroll ---
  savedAnswer['https://x.com/bob/status/222'] = '1780000000001-bb';
  intersect(['p2'], true);
  for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/bob/status/222' });
  check('a savedUpdate push marks the post immediately', layerBadges().length === 2);

  // --- the options switch takes effect live, both ways ---
  setSetting('savedBadge', false);
  check('turning the setting off removes every mark', layerBadges().length === 0);
  setSetting('savedBadge', true);
  await settle();
  check('turning it back on restores them', layerBadges().length === 2);

  console.log(fail === 0 ? `PASS test-badge-unit: ${pass} checks` : `FAIL test-badge-unit: ${fail} of ${pass + fail} checks failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
