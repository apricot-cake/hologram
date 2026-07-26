'use strict';

// Offline pure-unit test for extension/utils/bulk-capture.ts — the X bookmarks
// chase-mode intake (#362). Runs the BUILT unlisted capture script (capture.js,
// which bundles capture.ts + bulk-capture.ts + site-detect.ts + glass-ui.ts)
// inside jsdom, on a fixture whose URL is /i/bookmarks so capture.ts's branch
// dispatches to startBulkCapture instead of the single-shot click-to-save flow
// (see capture.ts's isXBookmarksPage() check).
//
// What this covers: the model has no auto-scroll (nothing here ever changes
// window.scrollY or dispatches wheel/scroll itself — the test drives "the user
// scrolled" by hand), a post is only captured once it clears the sticky header
// and fits the viewport, the already-saved check goes out in a batch and a
// "saved" answer skips a post without a captureAndSend, a post the fixture
// removes while queued becomes a miss and recovers by URL when the fixture adds
// it back, and the summary text names saved/skipped/missed counts. What this
// CANNOT cover: whether X's own bookmarks page still renders the shapes the
// fixture assumes (same limit as test-overlay-unit.cts / test-content-fixtures;
// the live canary is scripts/e2e-capture-test.cts) and real scroll-cadence
// timing (jsdom has no layout, so "capturable" is entirely decided by the
// data-rect-top/data-rect-size the fixture declares).
//
//   node scripts/test-bulk-capture-unit.cts

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'extension', '.output', 'chrome-mv3');

let pass = 0;
let fail = 0;
const check = (label, cond) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL   ${label}`);
  }
};

// Five bookmarked posts. p1/p2 sit fully below the sticky header and fit the
// viewport (capturable). p3 has no rect yet (below the fold — a real virtual
// list hasn't rendered its layout). p4/p5 are added to the DOM only after the
// test simulates scrolling.
const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
    <article data-testid="tweet" id="p2" data-rect-top="420" data-rect-size="300">
      <a href="/bob/status/222"><time datetime="2026-07-01T00:00:00Z">2h</time></a>
    </article>
    <article data-testid="tweet" id="p3">
      <a href="/carol/status/333"><time datetime="2026-07-01T00:00:00Z">3h</time></a>
    </article>
  </div>
</body></html>`;

const dom = new JSDOM(HTML, { url: 'https://x.com/i/bookmarks', runScripts: 'outside-only' });
const { window } = dom;

// jsdom lays nothing out — capturable() reads getBoundingClientRect(), so the
// fixture declares its own geometry the same way test-overlay-unit.cts does.
// window.innerHeight defaults to 768 in jsdom, well past every rect below.
window.Element.prototype.animate = function () {
  return { cancel() {}, finish() {}, set onfinish(_f) {}, set oncancel(_f) {} };
};
window.Element.prototype.getBoundingClientRect = function () {
  const declared = this.getAttribute?.('data-rect-top');
  if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  const top = Number(declared);
  const size = Number(this.getAttribute('data-rect-size') || 300);
  return { left: 50, top, right: 50 + size, bottom: top + size, width: size, height: size, x: 50, y: top };
};
let nextFrame = 1;
window.requestAnimationFrame = (fn) => {
  // Synchronous-ish: resolve on the next microtask turn rather than a real
  // frame, so the test doesn't need to pump a fake clock through the two
  // rAF hops captureOne() awaits before taking its "screenshot".
  Promise.resolve().then(fn);
  return nextFrame++;
};
window.cancelAnimationFrame = () => {};

// --- chrome API stub ---
const sent: any[] = [];
let savedAnswer: Record<string, string | null> = {};
const saveOutcome: 'success' | 'fail' = 'success';
const runtimeListeners: any[] = [];
window.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    sendMessage: (msg, cb) => {
      sent.push(msg);
      if (msg.type === 'checkSaved') {
        const results = {};
        for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
        cb?.({ ok: true, results });
        return;
      }
      if (msg.type === 'captureAndSend') {
        // The real background asks the content script to crop, THEN notifies
        // success/failure. Drive both through the listeners bulk-capture.ts
        // registered, exactly as background.ts would.
        for (const fn of runtimeListeners) fn({ type: 'cropImage', dataUrl: 'data:image/jpeg;base64,AAAA', rect: msg.rect }, {}, () => {});
        for (const fn of runtimeListeners) fn({ type: 'notify', success: saveOutcome === 'success' }, {}, () => {});
      }
    },
    onMessage: {
      addListener: (fn) => runtimeListeners.push(fn),
      removeListener: (fn) => {
        const i = runtimeListeners.indexOf(fn);
        if (i >= 0) runtimeListeners.splice(i, 1);
      },
    },
  },
} as any;

// The bundle's cropScreenshot() loads an Image() to draw the crop — jsdom has
// no image decoder, so let it "load" immediately with a harmless canvas.
window.Image = class {
  onload: any;
  onerror: any;
  set src(_v: string) {
    Promise.resolve().then(() => this.onload?.());
  }
} as any;
window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} }) as any;
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,BBBB';

const feed = () => window.document.getElementById('feed') as HTMLElement;
const addPost = (id: string, handle: string, statusId: string, top: number) => {
  const el = window.document.createElement('article');
  el.setAttribute('data-testid', 'tweet');
  el.setAttribute('data-rect-top', String(top));
  el.setAttribute('data-rect-size', '300');
  el.id = id;
  el.innerHTML = `<a href="/${handle}/status/${statusId}"><time datetime="2026-07-01T00:00:00Z">now</time></a>`;
  feed().appendChild(el);
};
const removePost = (id: string) => window.document.getElementById(id)?.remove();
const scroll = () => window.dispatchEvent(new window.Event('scroll', { bubbles: true }));

const banner = () => window.document.querySelector('[data-hologram-bulk-banner]');
const bannerText = () => window.document.querySelector('[data-hologram-bulk-label]')?.textContent || '';

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// p1 is already in the library going into the very first harvest: it must be
// skipped without ever reaching captureAndSend (the whole point of the #54
// route — no request to X at all for ground already covered).
savedAnswer = { 'https://x.com/alice/status/111': '1780000000000-aa' };

const captureReady = Promise.resolve(window.eval(fs.readFileSync(path.join(DIST, 'capture.js'), 'utf8')));

(async () => {
  await captureReady;
  await settle(1300); // past the harvest debounce, i18n's async wrapper, and MIN_CAPTURE_PERIOD_MS so p2's capture completes

  check('the mode banner mounts on the bookmarks page', banner() !== null);
  check('p1/p2 are asked about in one batch (p3 has no rect yet, so it is not counted as a post to ask about via captureAndSend, but IS harvested)', sent.filter((m) => m.type === 'checkSaved').length >= 1);
  const firstAsk = sent.find((m) => m.type === 'checkSaved');
  check('the batch asked about both capturable posts', firstAsk && firstAsk.urls.includes('https://x.com/alice/status/111') && firstAsk.urls.includes('https://x.com/bob/status/222'));

  check(
    'a saved post never triggers a screenshot',
    sent.every((m) => !(m.type === 'captureAndSend' && m.postUrl === 'https://x.com/alice/status/111')),
  );
  check(
    'the unsaved post was captured',
    sent.some((m) => m.type === 'captureAndSend' && m.postUrl === 'https://x.com/bob/status/222'),
  );
  check('the capture carries the bulk-intake marker (#362 capturedVia)', sent.find((m) => m.type === 'captureAndSend' && m.postUrl === 'https://x.com/bob/status/222')?.capturedVia === 'x-bookmarks');
  check('progress banner shows 1 saved, 1 skipped', bannerText().includes('1') && (bannerText().includes('保存') || bannerText().toLowerCase().includes('saved')));

  // --- miss + recovery ---
  addPost('p4', 'dave', '444', 900);
  scroll();
  await settle(300);
  // Scrolled past before its turn came up: the virtual list drops it.
  removePost('p4');
  scroll();
  await settle(300);
  check('a post dropped from the DOM before capture counts as missed', bannerText().includes('見送り') || bannerText().toLowerCase().includes('missed'));

  // Scrolling back re-adds the same URL: it recovers, not double-counts.
  addPost('p4', 'dave', '444', 200);
  scroll();
  await settle(1300);
  check(
    'scrolling back over a missed post recovers and captures it',
    sent.some((m) => m.type === 'captureAndSend' && m.postUrl === 'https://x.com/dave/status/444'),
  );
  check('a recovered post is no longer counted as missed', !bannerText().includes('見送り') && !bannerText().toLowerCase().includes('missed'));

  // --- stop ---
  const stopBtn = Array.from(banner()?.querySelectorAll('button') || [])[0] as HTMLButtonElement;
  stopBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  check('stopping shows a finished/stopped summary rather than the live counter', bannerText().includes('中断') || bannerText().toLowerCase().includes('stop'));
  check('a second Alt+S toggle target is cleared on stop', typeof (window as any).__snsPostSaveActive === 'undefined' || (window as any).__snsPostSaveActive === false);

  console.log(`${fail === 0 ? 'PASS' : 'FAIL'} test-bulk-capture-unit: ${pass} checks passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
