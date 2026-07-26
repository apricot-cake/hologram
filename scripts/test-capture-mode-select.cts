'use strict';

// Offline pure-unit test for which mode the built capture entrypoint enters
// (#362). Auto capture has its OWN gesture (Alt+Shift+S → background.ts sets
// window.__hologramAutoCapture, then injects); a plain Alt+S must still mean
// "click the post you want to save" on EVERY page — the bookmarks list
// included. An earlier build inferred the mode from the URL alone, which took
// the ordinary single-post save away from the bookmarks page entirely
// (reported from real use, 2026-07-26).
//
// The sibling suite test-bulk-capture-unit.cts covers the auto mode's own
// behaviour; this one only covers the fork.
//
//   node scripts/test-capture-mode-select.cts

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'extension', '.output', 'chrome-mv3');
const BUNDLE = fs.readFileSync(path.join(DIST, 'capture.js'), 'utf8');

let pass = 0;
let fail = 0;
const check = (label, cond) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL   ${label}`);
  }
};

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

// Returns which UI the bundle put on the page: the single-shot picker banner
// (no auto-capture marker) or the auto-capture banner.
async function runOn(url: string, auto: boolean): Promise<'single' | 'auto' | 'none'> {
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only' });
  const { window } = dom;
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
  window.requestAnimationFrame = (fn) => {
    Promise.resolve().then(fn);
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      // Answer checkSaved so the auto mode can proceed; swallow everything else
      // (this suite never lets a capture complete).
      sendMessage: (msg, cb) => cb?.({ ok: true, results: Object.fromEntries((msg.urls || []).map((u) => [u, null])) }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
  } as any;

  if (auto) (window as any).__hologramAutoCapture = true;
  window.eval(BUNDLE);
  await new Promise((r) => setTimeout(r, 300)); // past createI18n() + the first harvest

  if (window.document.querySelector('[data-hologram-bulk-banner]')) return 'auto';
  // The single-shot flow marks itself with this global and mounts a banner of
  // its own (which carries no data attribute — hence the global as the tell).
  if ((window as any).__snsPostSaveActive === true) return 'single';
  return 'none';
}

(async () => {
  check('Alt+S on an ordinary timeline stays single-shot', (await runOn('https://x.com/home', false)) === 'single');
  check('Alt+S on the BOOKMARKS list stays single-shot (the regression this guards)', (await runOn('https://x.com/i/bookmarks', false)) === 'single');
  check('Alt+Shift+S on the bookmarks list enters auto capture', (await runOn('https://x.com/i/bookmarks', true)) === 'auto');
  check('Alt+Shift+S on a page auto capture does not cover falls back to single-shot', (await runOn('https://x.com/home', true)) === 'single');
  check('Alt+Shift+S inside a bookmark FOLDER also enters auto capture', (await runOn('https://x.com/i/bookmarks/1234567890', true)) === 'auto');

  console.log(`${fail === 0 ? 'PASS' : 'FAIL'} test-capture-mode-select: ${pass} checks passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
