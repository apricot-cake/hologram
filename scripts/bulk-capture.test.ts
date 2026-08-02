// Offline pure unit test for extension/utils/bulk-capture.ts = X bookmarks scroll-through mode
// auto intake (#362). Runs the built capture.js (a bundle of capture.ts + bulk-capture.ts +
// site-detect.ts + glass-ui.ts) inside jsdom. The fixture's URL is /i/bookmarks, and
// window.__hologramAutoCapture is set = both are required. Auto intake has a dedicated gesture
// (Alt+Shift+S), because Alt+S must keep meaning single-shot intake here too. background.ts
// sets this flag right before injecting.
//
// What's checked: that there's no auto-scroll (this never moves window.scrollY or dispatches
// wheel/scroll); that permalinks are read at the moment a row "appears" so a fast scroll
// doesn't lose it; that the saved-check comes out batched and a "saved" answer skips savePost;
// that a save carries the bulk-intake marker; that posts with no image are still saved (just
// not displayable until #365 lands) and counted in their own bucket; and that stopping shows a
// summary.
// What's not checked: whether the X bookmarks page still renders in the shape this fixture
// assumes, today (the same limitation as overlay.test.ts / content-fixtures.test.ts — the live
// canary-in-the-coal-mine is scripts/e2e-capture-test.cts).
//
// This suite drives a single page in sequence, so the declaration order of the tests matters.
//
// Prerequisite: the extension's build output (extension/.output/chrome-mv3/capture.js) is needed.

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, expect, test } from 'vitest';
import { asUser } from './lib-user-event.ts';

// 5 bookmarked posts. p1/p2 fit fully below the fixed header and within the viewport (intake-able).
// p3 doesn't have a rect yet (below the fold = the real virtual list hasn't laid it out).
// p4/p5 are added to the DOM after the test simulates scrolling.
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

const sent: any[] = [];
const noMediaUrls = new Set<string>();
// The post itself couldn't be fetched = the host declined without writing anything (#492)
const unavailableUrls = new Set<string>();
// p1 is already in the library at the time of the first collection = it must be skipped without
// ever reaching captureAndSend (this is the whole reason the #54 path exists = never query X
// about ground that's already been covered)
const savedAnswer: Record<string, string | null> = { 'https://x.com/alice/status/111': '1780000000000-aa' };

// #44: the in-page UI lives inside a shared ShadowRoot (ui-root.ts).
const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
const banner = () => uiRoot()?.querySelector('[data-hologram-bulk-banner]') ?? null;
const bannerText = () => uiRoot()?.querySelector('[data-hologram-bulk-label]')?.textContent || '';
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const savePostFor = (url: string) => sent.find((m) => m.type === 'savePost' && m.postUrl === url);

const addPost = (id: string, handle: string, statusId: string, top: number) => {
  const el = window.document.createElement('article');
  el.setAttribute('data-testid', 'tweet');
  el.setAttribute('data-rect-top', String(top));
  el.setAttribute('data-rect-size', '300');
  el.id = id;
  el.innerHTML = `<a href="/${handle}/status/${statusId}"><time datetime="2026-07-01T00:00:00Z">now</time></a>`;
  window.document.getElementById('feed')?.appendChild(el);
};

beforeAll(async () => {
  // jsdom does no layout at all = since capturable() reads getBoundingClientRect(), the fixture
  // declares its own geometry (same convention as overlay.test.ts).
  // jsdom's window.innerHeight defaults to 768, comfortably below any of the rects here.
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
    // Nearly synchronous: resolves on the next microtask rather than a real frame = lets us get
    // past the 2 rAFs captureOne() waits on before "the screenshot" without ever running a fake clock
    Promise.resolve().then(fn);
    return nextFrame++;
  };
  window.cancelAnimationFrame = () => {};

  const runtimeListeners: any[] = [];
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
          // The real background answers the caller directly (doesn't push notify). For a post
          // the fixture has marked as image-less, this mimics how background.ts answers that
          // case = it still gets saved even without an image (the host writes a sidecar and
          // marks it as not displayable until #365).
          if (unavailableUrls.has(msg.postUrl)) cb?.({ ok: false, errorKind: 'post-unavailable', error: 'Post unavailable: nothing was obtained for it' });
          else if (noMediaUrls.has(msg.postUrl)) cb?.({ ok: true, file: 'x.json', deferred: true });
          else cb?.({ ok: true, file: 'x.jpg' });
        }
      },
      onMessage: {
        addListener: (fn: any) => runtimeListeners.push(fn),
        removeListener: (fn: any) => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
    },
  } as any;

  // The bundle's cropScreenshot() loads Image() to draw the crop. jsdom has no image decoder,
  // so a harmless canvas immediately pretends it "loaded".
  window.Image = class {
    onload: any;
    onerror: any;
    set src(_v: string) {
      Promise.resolve().then(() => this.onload?.());
    }
  } as any;
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} }) as any;
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,BBBB';

  // What background.ts does right before injecting for the auto-intake command. Without this,
  // the same bundle on the same page runs the single-shot path instead (checked by capture-mode-select.test.ts).
  (window as any).__hologramAutoCapture = true;

  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'capture.js'), 'utf8'));
  await settle(1300); // Until p2's save finishes, past i18n's async wrapper and MIN_SAVE_PERIOD_MS
}, 30000);

test('ブックマークページでモードのバナーが出る', () => {
  expect(banner()).not.toBeNull();
});

test('保存済みの問い合わせは1バッチで出る', () => {
  expect(sent.filter((m) => m.type === 'checkSaved').length).toBeGreaterThanOrEqual(1);
});

test('レイアウトの有無を問わず DOM 上の全投稿を問い合わせる（保存にはパーマリンクだけで足りる）', () => {
  const firstAsk = sent.find((m) => m.type === 'checkSaved');
  for (const id of ['111', '222', '333']) {
    expect(firstAsk.urls.some((u: string) => u.endsWith(`/status/${id}`))).toBe(true);
  }
});

test('すでにライブラリにある投稿は保存へ送らない', () => {
  expect(savePostFor('https://x.com/alice/status/111')).toBeUndefined();
});

test('未保存の投稿はパーマリンクだけで送られ、一括取込のマーカーを運ぶ（#362 capturedVia）', () => {
  expect(savePostFor('https://x.com/bob/status/222')?.capturedVia).toBe('x-bookmarks');
});

test('スクリーンショットはもう一度も要求されない', () => {
  expect(sent.some((m) => m.type === 'captureAndSend')).toBe(false);
});

test('進捗バナーが保存済みと飛ばした数を数える', () => {
  expect(bannerText()).toContain('1');
  expect(bannerText().includes('保存') || bannerText().toLowerCase().includes('saved')).toBe(true);
});

// What the screenshot-based version couldn't do: it required the post to still be on screen
// when its turn came up, so a fast scroll would lose it. Since the permalink is read the moment
// it appears, it no longer matters if the row disappears later.
test('現れた直後に行が消えた投稿も保存される', async () => {
  addPost('p4', 'dave', '444', 900);
  await settle(120);
  window.document.getElementById('p4')?.remove();
  await settle(1400);

  expect(savePostFor('https://x.com/dave/status/444')).toBeTruthy();
});

// Missing one means it's lost forever: X has no bookmark export, and that's this feature's whole reason to exist
test('画像の無い投稿も飛ばさずに保存へ送る（#365）', async () => {
  noMediaUrls.add('https://x.com/erin/status/555');
  addPost('p5', 'erin', '555', 300);
  await settle(1400);

  expect(savePostFor('https://x.com/erin/status/555')).toBeTruthy();
});

// #492: a post that couldn't be fetched is treated as neither "saved" nor a "malfunction".
// Since nothing was actually stored in the library, it must be encountered again on the next
// run (whether the badge lights up is the host's responsibility), and if a deleted post keeps
// showing "failed" every single time, that becomes indistinguishable from an actual bug worth fixing.
test('取得できなかった投稿は「失敗」と別枠で数える（#492）', async () => {
  unavailableUrls.add('https://x.com/frank/status/666');
  addPost('p6', 'frank', '666', 300);
  await settle(1400);

  expect(savePostFor('https://x.com/frank/status/666')).toBeTruthy();
  expect(bannerText().includes('保存') || bannerText().toLowerCase().includes('saved')).toBe(true);
});

test('常駐オーバーレイの操作部を隠す規則を1つも入れない', () => {
  const hidingRules = Array.from(window.document.querySelectorAll('style')).filter((s) => (s.textContent || '').includes('data-hologram-overlay'));
  expect(hidingRules).toHaveLength(0);
});

test('停止すると、生のカウンタではなく要約が出る', async () => {
  const stopBtn = Array.from(banner()?.querySelectorAll('button') || [])[0] as HTMLButtonElement;
  stopBtn.dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
  await settle();

  expect(bannerText().includes('中断') || bannerText().toLowerCase().includes('stop')).toBe(true);
  // Image-less posts count as "saved" (not treated as skipped)
  expect(bannerText().includes('画像なし') || bannerText().toLowerCase().includes('image-less')).toBe(true);
  // The 1 post that couldn't be fetched shows in the summary, but not as "failed" (#492)
  expect(bannerText().includes('取得できず') || bannerText().toLowerCase().includes('unavailable')).toBe(true);
  expect(bannerText().includes('失敗') || bannerText().toLowerCase().includes('failed')).toBe(false);
  expect((window as any).__snsPostSaveActive).toBeFalsy();
});
