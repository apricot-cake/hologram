// Offline pure unit test for extension/utils/bulk-capture.ts run on pixiv's bookmark list (#280).
// Runs the built capture.js (a bundle of capture.ts + bulk-capture.ts + site-detect.ts +
// glass-ui.ts) inside jsdom, mirroring bulk-capture.test.ts's approach for X (#362). The fixture's
// URL is the viewer's own bookmark list (/users/<id>/bookmarks/artworks with a matching
// /ajax/settings/self answer) and window.__hologramAutoCapture is set — both are required.
//
// What's specific to pixiv here (the rest — permalink-on-mount harvesting, the #54 saved-check
// batching, the bulk-intake marker, no screenshot, a stop summary — is the shared flow already
// covered by bulk-capture.test.ts and isn't re-asserted): a card carries TWO /artworks/ anchors
// (thumbnail + title) that must dedupe to one save; capturedVia is 'pixiv-bookmarks', not
// 'x-bookmarks'; and the list being fully in the DOM from the start lets the banner show a total
// (bulkKnowsTotal), which X's virtual list cannot.
//
// What's not checked: whether pixiv's real bookmark list page still renders in the shape this
// fixture assumes. The card shape (two /artworks/ anchors) comes from Issue #280's 2026-08-02
// real-capture note; the /ajax/settings/self response shape comes from third-party documentation
// of that endpoint, not a live capture — see the Issue's own "残る不確定" note. The live
// canary-in-the-coal-mine, if one is ever added for this page, would be the place that catches
// drift.
//
// Prerequisite: the extension's build output (extension/.output/chrome-mv3/capture.js) is needed.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, expect, test } from 'vitest';
import { asUser } from './lib-user-event.ts';

const SELF_ID = '999';
const BOOKMARKS_URL = `https://www.pixiv.net/users/${SELF_ID}/bookmarks/artworks`;

// Two anchors per card (thumbnail + title), exactly as the real page does (Issue #280's
// 2026-08-02 real-capture note). p1 is already saved; p2 is not.
const HTML = `<!doctype html><html><body>
  <ul id="list">
    <li id="card1">
      <a href="/artworks/111"><img src="https://i.pximg.net/c/250x250/img-master/img/2026/01/01/00/00/00/111_p0_master1200.jpg"></a>
      <a href="/artworks/111">Title 1</a>
    </li>
    <li id="card2">
      <a href="/artworks/222"><img src="https://i.pximg.net/c/250x250/img-master/img/2026/01/01/00/00/00/222_p0_master1200.jpg"></a>
      <a href="/artworks/222">Title 2</a>
    </li>
  </ul>
</body></html>`;

const dom = new JSDOM(HTML, { url: BOOKMARKS_URL, runScripts: 'outside-only' });
const { window } = dom;

const sent: any[] = [];
const savedAnswer: Record<string, string | null> = { 'https://www.pixiv.net/artworks/111': '1780000000000-aa' };

const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
const banner = () => uiRoot()?.querySelector('[data-hologram-bulk-banner]') ?? null;
const bannerText = () => uiRoot()?.querySelector('[data-hologram-bulk-label]')?.textContent || '';
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const savePostFor = (url: string) => sent.find((m) => m.type === 'savePost' && m.postUrl === url);

function jsonRes(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeAll(async () => {
  window.Element.prototype.animate = function () {
    return { cancel() {}, finish() {}, set onfinish(_f) {}, set oncancel(_f) {} };
  };
  window.Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 };
  };
  let nextFrame = 1;
  window.requestAnimationFrame = (fn) => {
    Promise.resolve().then(fn);
    return nextFrame++;
  };
  window.cancelAnimationFrame = () => {};

  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb: any) => {
        sent.push(msg);
        if (msg.type === 'checkSaved') {
          const results: Record<string, string | null> = {};
          for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
          cb?.({ ok: true, results });
          return;
        }
        if (msg.type === 'savePost') {
          cb?.({ ok: true, file: 'pixiv.jpg' });
        }
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
  } as any;

  // isPixivOwnBookmarksPage's one network call, and the only fetch this run should ever make —
  // the intake pipeline itself (fetchPixivIllust) is entirely mocked out through chrome.runtime
  // above, so a second real fetch here would mean a site-knowledge boundary got crossed.
  window.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.includes('/ajax/settings/self')) return jsonRes({ error: false, body: { user_status: { user_id: SELF_ID } } });
    throw new Error(`unexpected fetch in pixiv bulk-capture test: ${u}`);
  }) as any;

  window.Image = class {
    onload: any;
    onerror: any;
    set src(_v: string) {
      Promise.resolve().then(() => this.onload?.());
    }
  } as any;
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} }) as any;
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,BBBB';

  (window as any).__hologramAutoCapture = true;

  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'capture.js'), 'utf8'));
  await settle(1300); // Until the self-id fetch, i18n, and both saves settle (MIN_SAVE_PERIOD_MS apart)
}, 30000);

test('自分のブックマーク一覧でモードのバナーが出る', () => {
  expect(banner()).not.toBeNull();
});

test('カード1枚の2本の /artworks/ アンカー（サムネ＋タイトル）は1件に束ねられる', () => {
  const firstAsk = sent.find((m) => m.type === 'checkSaved');
  const urls111 = firstAsk.urls.filter((u: string) => u === 'https://www.pixiv.net/artworks/111');
  expect(urls111).toHaveLength(1);
});

test('すでにライブラリにある作品は保存へ送らない', () => {
  expect(savePostFor('https://www.pixiv.net/artworks/111')).toBeUndefined();
});

test('未保存の作品は一括取込のマーカーを運ぶ（#280 capturedVia = pixiv-bookmarks、x-bookmarks ではない）', () => {
  const msg = savePostFor('https://www.pixiv.net/artworks/222');
  expect(msg?.capturedVia).toBe('pixiv-bookmarks');
});

test('スクリーンショットは要求されない', () => {
  expect(sent.some((m) => m.type === 'captureAndSend')).toBe(false);
});

test('一覧が最初から全件 DOM にあるサイトは分母つきの進捗を出す（#280、X にはできない表示）', () => {
  // 2 known, 1 already-processed as skipped at minimum by the time saves have settled.
  expect(bannerText()).toMatch(/2/);
  expect(bannerText().includes('対象') || bannerText().toLowerCase().includes('of')).toBe(true);
});

test('停止すると要約が出る', async () => {
  const stopBtn = Array.from(banner()?.querySelectorAll('button') || [])[0] as HTMLButtonElement;
  stopBtn.dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
  await settle();

  expect(bannerText().includes('中断') || bannerText().toLowerCase().includes('stop')).toBe(true);
  expect((window as any).__snsPostSaveActive).toBeFalsy();
});
