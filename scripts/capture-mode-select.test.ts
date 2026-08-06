// Offline pure unit test for which mode the built capture entry point enters (#362). Auto
// intake has a dedicated gesture (Alt+Shift+S -> background.ts sets window.__hologramAutoCapture
// before injecting). Plain Alt+S must keep meaning "click the post you want to save, on
// whatever page you're on" — including the bookmarks list. An earlier build inferred the mode
// from the URL alone, which entirely took away normal single-post save on the bookmarks page
// (reported from real usage, 2026-07-26).
//
// Auto mode's own behavior is covered by bulk-capture.test.ts. This only checks the branching.
//
// Prerequisite: the extension's build output (extension/.output/chrome-mv3/capture.js) is needed.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

// Returns the UI the bundle exposed on the page = the single-shot picker banner, or the auto-intake banner.
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
      // Only answers checkSaved to let auto mode proceed, and swallows everything else
      // (this suite doesn't run intake all the way through)
      sendMessage: (msg, cb) => cb?.({ ok: true, results: Object.fromEntries((msg.urls || []).map((u: string) => [u, null])) }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
  } as any;

  // The two modes are exclusive branches of startCapture (extension/utils/capture.ts) and each
  // announces itself, so 'none' means "still starting up" (createI18n, the first collection) —
  // never an end state either way. Poll for the announcement instead of guessing how long it takes.
  const mode = (): 'single' | 'auto' | 'none' => {
    const uiRoot = (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
    if (uiRoot?.querySelector('[data-hologram-bulk-banner]')) return 'auto';
    // The single-shot path marks itself via this global (its own banner has no data attribute)
    if ((window as any).__snsPostSaveActive === true) return 'single';
    return 'none';
  };

  if (auto) (window as any).__hologramAutoCapture = true;
  window.eval(BUNDLE);
  await vi.waitFor(() => expect(mode()).not.toBe('none'), { timeout: 5000 });
  return mode();
}

test('Alt+S は普通のタイムラインで単発のまま', async () => {
  expect(await runOn('https://x.com/home', false)).toBe('single');
});

test('Alt+S はブックマーク一覧でも単発のまま（これが守りたい退行）', async () => {
  expect(await runOn('https://x.com/i/bookmarks', false)).toBe('single');
});

test('Alt+Shift+S はブックマーク一覧で自動取り込みへ入る', async () => {
  expect(await runOn('https://x.com/i/bookmarks', true)).toBe('auto');
});

test('Alt+Shift+S は自動取り込みが対応しないページでは単発へ落ちる', async () => {
  expect(await runOn('https://x.com/home', true)).toBe('single');
});

test('Alt+Shift+S はブックマークのフォルダ内でも自動取り込みへ入る', async () => {
  expect(await runOn('https://x.com/i/bookmarks/1234567890', true)).toBe('auto');
});
