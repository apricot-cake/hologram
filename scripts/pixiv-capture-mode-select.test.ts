// Offline pure unit test for which mode the built capture entry point enters on pixiv's
// bookmark list (#280). Mirrors capture-mode-select.test.ts (X, #362): Alt+S must keep meaning
// "click the artwork I want to save" everywhere, including the bookmark list, and Alt+Shift+S
// only enters the auto-intake mode on the viewer's OWN bookmark list — pixiv serves the same
// URL shape for any user's public bookmarks, so entry has to confirm ownership via
// /ajax/settings/self before acting (isPixivOwnBookmarksPage, extension/utils/extractor/pixiv.ts).
//
// Auto mode's own behavior (harvesting, capturedVia, the progress denominator) is covered by
// pixiv-bulk-capture.test.ts. This only checks the branching.
//
// Prerequisite: the extension's build output (extension/.output/chrome-mv3/capture.js) is needed.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <ul id="list">
    <li>
      <a href="/artworks/111"><img src="https://i.pximg.net/c/250x250/img-master/img/2026/01/01/00/00/00/111_p0_master1200.jpg"></a>
      <a href="/artworks/111">Title 1</a>
    </li>
  </ul>
</body></html>`;

const SELF_ID = '999';

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Returns the UI the bundle exposed on the page = the single-shot picker banner, or the auto-intake banner.
async function runOn(url: string, auto: boolean): Promise<'single' | 'auto' | 'none'> {
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only' });
  const { window } = dom;

  window.Element.prototype.animate = function () {
    return { cancel() {}, finish() {}, set onfinish(_f) {}, set oncancel(_f) {} };
  };
  window.Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 };
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
      sendMessage: (msg, cb) => cb?.({ ok: true, results: Object.fromEntries((msg.urls || []).map((u: string) => [u, null])) }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
  } as any;
  // isPixivOwnBookmarksPage's one network call: whoever's cookies are attached owns SELF_ID,
  // regardless of which user's list the fixture's URL claims to show.
  window.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.includes('/ajax/settings/self')) return jsonRes({ error: false, body: { user_status: { user_id: SELF_ID } } });
    return jsonRes({ error: true });
  }) as any;

  if (auto) (window as any).__hologramAutoCapture = true;
  window.eval(BUNDLE);
  await new Promise((r) => setTimeout(r, 300)); // Until createI18n(), the self-id fetch, and the first collection finish

  const uiRoot = (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
  if (uiRoot?.querySelector('[data-hologram-bulk-banner]')) return 'auto';
  if ((window as any).__snsPostSaveActive === true) return 'single';
  return 'none';
}

test('Alt+S は自分のブックマーク一覧でも単発のまま（これが守りたい退行）', async () => {
  expect(await runOn(`https://www.pixiv.net/users/${SELF_ID}/bookmarks/artworks`, false)).toBe('single');
});

test('Alt+Shift+S は自分のブックマーク一覧で自動取り込みへ入る', async () => {
  expect(await runOn(`https://www.pixiv.net/users/${SELF_ID}/bookmarks/artworks`, true)).toBe('auto');
});

test('Alt+Shift+S は他人のブックマーク一覧では起動しない（#280 受け入れ条件）', async () => {
  expect(await runOn('https://www.pixiv.net/users/1234567/bookmarks/artworks', true)).toBe('single');
});

test('Alt+Shift+S はタグ絞り込み中の自分の一覧でも自動取り込みへ入る', async () => {
  expect(await runOn(`https://www.pixiv.net/users/${SELF_ID}/bookmarks/artworks?tag=%E9%A2%A8%E6%99%AF`, true)).toBe('auto');
});

test('Alt+Shift+S は自動取り込みが対応しないページ（作品ページ）では単発へ落ちる', async () => {
  expect(await runOn('https://www.pixiv.net/artworks/111', true)).toBe('single');
});
