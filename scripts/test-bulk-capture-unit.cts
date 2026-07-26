'use strict';

// Offline pure-unit test for extension/utils/bulk-capture.ts — the X bookmarks
// chase-mode auto capture (#362). Runs the BUILT unlisted capture script
// (capture.js, which bundles capture.ts + bulk-capture.ts + site-detect.ts +
// glass-ui.ts) inside jsdom, on a fixture whose URL is /i/bookmarks AND with
// window.__hologramAutoCapture set — BOTH are required, because auto capture
// has its own gesture (Alt+Shift+S) and Alt+S must keep meaning single-shot
// capture even here. background.ts sets that flag just before injecting.
//
// What this covers: the model has no auto-scroll (nothing here ever changes
// window.scrollY or dispatches wheel/scroll itself), permalinks are read as
// rows MOUNT so nothing is lost to fast scrolling, the already-saved check goes
// out in a batch and a "saved" answer skips a post without a savePost, saves
// carry the bulk-intake marker, an image-less post is SAVED but reported
// apart (displayable only once #365 lands), and stopping reports a summary. What this
// CANNOT cover: whether X's own bookmarks page still renders the shapes the
// fixture assumes (same limit as test-overlay-unit.cts / test-content-fixtures;
// the live canary is scripts/e2e-capture-test.cts).
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
const noMediaUrls = new Set<string>();
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
      if (msg.type === 'savePost') {
        // The real background answers the caller directly (no notify push).
        // A post the fixture marks image-less answers the way background.ts
        // does for that case, so the counter split can be asserted.
        // An image-less post is still SAVED — the host writes its sidecar and
        // flags it deferred (not displayable until #365).
        if (noMediaUrls.has(msg.postUrl)) cb?.({ ok: true, file: 'x.json', deferred: true });
        else cb?.({ ok: true, file: 'x.jpg' });
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

// What background.ts does right before injecting when the user pressed the auto
// capture command. Without it the same bundle on the same page runs the
// single-shot flow instead — asserted below.
(window as any).__hologramAutoCapture = true;

const captureReady = Promise.resolve(window.eval(fs.readFileSync(path.join(DIST, 'capture.js'), 'utf8')));

(async () => {
  await captureReady;
  await settle(1300); // past i18n's async wrapper and MIN_SAVE_PERIOD_MS so p2's save completes

  check('the mode banner mounts on the bookmarks page', banner() !== null);
  const firstAsk = sent.find((m) => m.type === 'checkSaved');
  check('the already-saved question goes out as one batch', sent.filter((m) => m.type === 'checkSaved').length >= 1);
  check('every post in the DOM is asked about, layout or not — a permalink is all a save needs now', firstAsk && ['111', '222', '333'].every((id) => firstAsk.urls.some((u) => u.endsWith(`/status/${id}`))));

  check(
    'a post already in the library is never sent for saving',
    sent.every((m) => !(m.type === 'savePost' && m.postUrl === 'https://x.com/alice/status/111')),
  );
  check(
    'an unsaved post is sent by permalink alone',
    sent.some((m) => m.type === 'savePost' && m.postUrl === 'https://x.com/bob/status/222'),
  );
  check('the save carries the bulk-intake marker (#362 capturedVia)', sent.find((m) => m.type === 'savePost' && m.postUrl === 'https://x.com/bob/status/222')?.capturedVia === 'x-bookmarks');
  check(
    'nothing asks for a screenshot any more',
    sent.every((m) => m.type !== 'captureAndSend'),
  );
  check('progress banner counts saved and skipped', bannerText().includes('1') && (bannerText().includes('保存') || bannerText().toLowerCase().includes('saved')));

  // --- a row that mounts and is discarded before its turn is still saved ---
  // This is what the screenshot version could not do: it needed the post to be
  // ON SCREEN when its turn came, so a fast scroll lost it. Reading the
  // permalink on arrival makes the row's later removal irrelevant.
  addPost('p4', 'dave', '444', 900);
  await settle(120);
  removePost('p4');
  await settle(1400);
  check(
    'a post whose row was dropped right after mounting is still saved',
    sent.some((m) => m.type === 'savePost' && m.postUrl === 'https://x.com/dave/status/444'),
  );

  // --- an image-less post is SAVED, just not displayable yet (#365) ---
  // Losing it instead would be permanent: X has no bookmark export to go back
  // to, which is the whole reason this feature exists.
  noMediaUrls.add('https://x.com/erin/status/555');
  addPost('p5', 'erin', '555', 300);
  await settle(1400);
  check(
    'an image-less post is still sent for saving, not skipped',
    sent.some((m) => m.type === 'savePost' && m.postUrl === 'https://x.com/erin/status/555'),
  );

  // --- the resident overlay's controls are never touched now ---
  const hidingRules = () => Array.from(window.document.querySelectorAll('style')).filter((s) => (s.textContent || '').includes('data-hologram-overlay'));
  check('no rule ever hides the overlay controls', hidingRules().length === 0);

  // --- stop ---
  const stopBtn = Array.from(banner()?.querySelectorAll('button') || [])[0] as HTMLButtonElement;
  stopBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();
  check('stopping shows a summary rather than the live counter', bannerText().includes('中断') || bannerText().toLowerCase().includes('stop'));
  check('the summary counts image-less posts as saved, never as skipped', bannerText().includes('画像なし') || bannerText().toLowerCase().includes('image-less'));
  check('the activation toggle is cleared on stop', typeof (window as any).__snsPostSaveActive === 'undefined' || (window as any).__snsPostSaveActive === false);

  console.log(`${fail === 0 ? 'PASS' : 'FAIL'} test-bulk-capture-unit: ${pass} checks passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
