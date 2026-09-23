// pixiv のブックマーク一覧で走らせる extension/utils/bulk-capture.ts の、通信しない純粋な
// 単体テスト（#280）。ビルド済みの bulk.js を jsdom の中で走らせる。
// X 向けの bulk-capture.extension-bundle.test.ts（#362）
// と同じやり方。フィクスチャの URL は見ている本人のブックマーク一覧
// （/users/<id>/bookmarks/artworks と、それに合う /ajax/settings/self の応答）である。
//
// ここで pixiv 固有なのは次の3点（残り＝載った時点でのパーマリンクの刈り取り、#54 の保存
// 済み確認のまとめ送り、一括取込のマーカー、停止時の
// 要約は共通の流れで、bulk-capture.extension-bundle.test.ts がすでに見ているので改めて確かめない）。カード
// 1枚が /artworks/ のアンカーを2本（サムネ＋タイトル）持ち、保存1件に束ねなければならない
// こと。capturedVia が 'x-bookmarks' ではなく 'pixiv-bookmarks' であること。一覧が最初から
// 全件 DOM にあるので、バナーが分母を出せること（bulkKnowsTotal）＝X の仮想リストにはできない。
//
// 確かめないこと: pixiv の実際のブックマーク一覧が、今もこのフィクスチャの想定する形で
// 描かれているか。カードの形（/artworks/ のアンカー2本）は Issue #280 の 2026-08-02 の実取得
// メモから取った。/ajax/settings/self の応答の形は、実際の取得ではなくその口に関する第三者の
// 文書から取った＝Issue 自身の「残る不確定」を参照。ずれを捕まえるのは、このページ向けに
// 実通信の確認は、必要になった時点で手動で行う。
//
// 前提: 拡張機能のテスト用出力（extension/.output/chrome-mv3-test/bulk.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, expect, test } from 'vitest';
import { asUser } from '../helpers/lib-user-event.ts';

const SELF_ID = '999';
const BOOKMARKS_URL = `https://www.pixiv.net/users/${SELF_ID}/bookmarks/artworks`;

// カード1枚につきアンカー2本（サムネ＋タイトル）＝実際のページのとおり（Issue #280 の
// 2026-08-02 の実取得メモ）。p1 は保存済み、p2 は未保存。
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

  // isPixivOwnBookmarksPage が出す唯一の通信で、この実行で起きてよい fetch もこれだけ＝
  // 取り込みの本体（fetchPixivIllust）は上の chrome.runtime を通して丸ごとモックしてある。
  // だからここで2本目の実 fetch が出たら、サイト知識の境界を越えたということ。
  window.fetch = (async (input: unknown) => {
    const u = String(input);
    if (u.includes('/ajax/settings/self')) return jsonRes({ error: false, body: { user_status: { user_id: SELF_ID } } });
    throw new Error(`pixiv の一括取込テストで想定外の fetch: ${u}`);
  }) as any;

  window.eval(fs.readFileSync(path.join(import.meta.dirname, '../../extension/.output/chrome-mv3-test/bulk.js'), 'utf8'));
  await settle(1300); // 自分の id の取得、i18n、2件の保存（MIN_SAVE_PERIOD_MS 間隔）が落ち着くまで
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

test('一覧が最初から全件 DOM にあるサイトは分母つきの進捗を出す（#280、X にはできない表示）', () => {
  // 保存が落ち着いた時点で、少なくとも既知2件・処理済み（飛ばした）1件になっている。
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
