// ビルド済みの capture のエントリポイントがどのモードへ入るか（#362）を、オフラインで見る
// 純粋な単体テスト。自動取り込みには専用の操作がある（Alt+Shift+S → background.ts が注入の
// 前に window.__hologramAutoCapture を立てる）。素の Alt+S は「今いるページで、保存したい
// 投稿をクリックする」という意味を保たなければならない＝ブックマーク一覧でも同じ。以前の
// ビルドは URL だけからモードを決めていて、ブックマークのページで普通の単発保存を丸ごと
// 奪っていた（実使用からの報告、2026-07-26）。
//
// 自動モード自身の挙動は bulk-capture.extension-bundle.test.ts が見る。ここで見るのは分岐だけ。
//
// 前提: 拡張機能のテスト用出力（extension/.output/chrome-mv3-test/capture.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-test', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

// バンドルがページ上に出した UI を返す＝単発のピッカーのバナーか、自動取り込みのバナーか。
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
      // 自動モードを先へ進めるために checkSaved にだけ答え、他はすべて飲み込む
      //（この一式は取り込みを最後まで走らせない）
      sendMessage: (msg, cb) => cb?.({ ok: true, results: Object.fromEntries((msg.urls || []).map((u: string) => [u, null])) }),
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
  } as any;

  // 2つのモードは startCapture（extension/utils/capture.ts）の排他の分岐で、それぞれ自分から
  // 名乗る。だから 'none' は「まだ起動中」（createI18n、最初の収集）を意味し、どちらの側でも
  // 終わりの状態にはならない。どれだけ掛かるかを当てずに、名乗るのを待つ。
  const mode = (): 'single' | 'auto' | 'none' => {
    const uiRoot = (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
    if (uiRoot?.querySelector('[data-hologram-bulk-banner]')) return 'auto';
    // 単発の経路はこのグローバルで自分に印を付ける（自前のバナーにはデータ属性が無い）
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
