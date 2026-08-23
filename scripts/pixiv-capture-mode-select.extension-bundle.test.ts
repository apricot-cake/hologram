// pixiv のブックマーク一覧で、ビルド済みのキャプチャの入口がどのモードへ入るかを見る、
// オフラインの純粋な単体テスト (#280)。capture-mode-select.extension-bundle.test.ts（X・#362）と対になる。
// Alt+S はブックマーク一覧を含めどこでも「保存したい作品をクリックする」の意味のままで
// なければならず、Alt+Shift+S が自動取り込みのモードへ入るのは見ている本人のブックマーク
// 一覧だけ＝pixiv は誰の公開ブックマークにも同じ形の URL を出すので、入口は動く前に
// /ajax/settings/self で本人かどうかを確かめる必要がある
// （isPixivOwnBookmarksPage・extension/utils/extractor/pixiv.ts）。
//
// 自動モード自身の振る舞い（収集・capturedVia・進捗の分母）は pixiv-bulk-capture.extension-bundle.test.ts が
// 覆う。ここでは分岐だけを見る。
//
// 前提: 拡張機能のテスト用出力（extension/.output/chrome-mv3-test/capture.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-test', 'capture.js'), 'utf8');

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

// バンドルがページに出した UI を返す＝単発の選択バナーか、自動取り込みのバナーか。
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
  // isPixivOwnBookmarksPage が出す唯一のネットワーク呼び出し。フィクスチャの URL が誰の
  // 一覧を名乗っていようと、cookie の主は SELF_ID とする。
  window.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.includes('/ajax/settings/self')) return jsonRes({ error: false, body: { user_status: { user_id: SELF_ID } } });
    return jsonRes({ error: true });
  }) as any;

  // 2つのモードは startCapture（extension/utils/capture.ts）の排他な枝で、どちらも自分を
  // 名乗る。だから 'none' は「まだ起動中」（createI18n・self-id の取得・最初の収集）を
  // 意味し、どちらにせよ終わりの状態にはならない。名乗るまで待つ。
  const mode = (): 'single' | 'auto' | 'none' => {
    const uiRoot = (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
    if (uiRoot?.querySelector('[data-hologram-bulk-banner]')) return 'auto';
    if ((window as any).__snsPostSaveActive === true) return 'single';
    return 'none';
  };

  if (auto) (window as any).__hologramAutoCapture = true;
  window.eval(BUNDLE);
  await vi.waitFor(() => expect(mode()).not.toBe('none'), { timeout: 5000 });
  return mode();
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
