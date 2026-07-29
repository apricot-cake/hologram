// ビルド済みの capture エントリポイントがどちらのモードへ入るかの、オフライン純ユニット
// テスト（#362）。自動取り込みは専用のジェスチャを持つ（Alt+Shift+S → background.ts が
// window.__hologramAutoCapture を立ててから注入する）。素の Alt+S は、ブックマーク一覧を
// 含めた「どのページでも」保存したい投稿をクリックする意味のままでなければならない。
// 以前のビルドは URL だけからモードを推測しており、ブックマークページから通常の
// 単発保存を丸ごと奪っていた（実利用からの報告・2026-07-26）。
//
// 自動モード自体の振る舞いは bulk-capture.test.ts が見る。ここは分岐だけ。
//
// 前提: extension のビルド成果物（extension/.output/chrome-mv3/capture.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

// バンドルがページへ出した UI を返す＝単発のピッカーのバナーか、自動取り込みのバナーか。
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
      // checkSaved にだけ答えて自動モードを進ませ、他は握り潰す
      // （このスイートは取り込みを最後まで走らせない）
      sendMessage: (msg, cb) => cb?.({ ok: true, results: Object.fromEntries((msg.urls || []).map((u: string) => [u, null])) }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
  } as any;

  if (auto) (window as any).__hologramAutoCapture = true;
  window.eval(BUNDLE);
  await new Promise((r) => setTimeout(r, 300)); // createI18n() と最初の収集が終わるまで

  const uiRoot = (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
  if (uiRoot?.querySelector('[data-hologram-bulk-banner]')) return 'auto';
  // 単発の経路はこのグローバルで自分を印す（自前のバナーは data 属性を持たない）
  if ((window as any).__snsPostSaveActive === true) return 'single';
  return 'none';
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
