// extension/utils/bulk-capture.ts＝X ブックマークの追い込みモード自動取り込み（#362）の
// オフライン純ユニットテスト。ビルド済みの capture.js（capture.ts + bulk-capture.ts +
// site-detect.ts + glass-ui.ts を束ねたもの）を jsdom の中で走らせる。フィクスチャの URL は
// /i/bookmarks で、かつ window.__hologramAutoCapture が立っている＝両方が要る。自動取り込みは
// 専用のジェスチャ（Alt+Shift+S）を持ち、Alt+S はここでも単発取り込みの意味のままでなければ
// ならないから。background.ts が注入直前にこのフラグを立てる。
//
// 見るもの: 自動スクロールを持たないこと（ここでは window.scrollY を動かしも wheel/scroll を
// 投げもしない）・パーマリンクは行が「現れた時」に読むので速いスクロールでも失わないこと・
// 保存済み確認がバッチで出て「保存済み」の答えは savePost 無しで飛ばすこと・保存が一括取込の
// マーカーを運ぶこと・画像の無い投稿も保存され（#365 が入るまで表示できないだけ）別枠で
// 数えられること・停止すると要約が出ること。
// 見られないもの: X のブックマークページがこのフィクスチャの想定する形を today も描いているか
// （overlay.test.ts / content-fixtures.test.ts と同じ限界。生きた炭鉱のカナリアは
// scripts/e2e-capture-test.cts）。
//
// このスイートは1つのページを順に動かすので、テストの宣言順に意味がある。
//
// 前提: extension のビルド成果物（extension/.output/chrome-mv3/capture.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, expect, test } from 'vitest';

// ブックマーク済みの投稿5件。p1/p2 は固定ヘッダの下に完全に収まり、ビューポートにも収まる
// （取り込み可能）。p3 はまだ矩形を持たない（折り返しの下＝実際の仮想リストがレイアウトを
// 作っていない）。p4/p5 はテストがスクロールを模した後に DOM へ足す。
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
// 投稿そのものが取得できなかった＝ホストが何も書かずに断った答え（#492）
const unavailableUrls = new Set<string>();
// p1 は最初の収集の時点ですでにライブラリにある＝captureAndSend に一度も届かずに飛ばされ
// なければならない（#54 経路の存在理由＝踏破済みの土地について X へ一切問い合わせない）
const savedAnswer: Record<string, string | null> = { 'https://x.com/alice/status/111': '1780000000000-aa' };

// #44: ページ内 UI は共有の ShadowRoot の中（ui-root.ts）。
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
  // jsdom は何もレイアウトしない＝capturable() は getBoundingClientRect() を読むので、
  // フィクスチャが自分で幾何を宣言する（overlay.test.ts と同じ流儀）。
  // jsdom の window.innerHeight は既定 768 で、下のどの矩形よりも十分下。
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
    // ほぼ同期: 実フレームでなく次のマイクロタスクで解決する＝captureOne() が
    // 「スクリーンショット」の前に待つ2回の rAF を、偽の時計を回さずに越えられる
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
          // 本物の background は呼び出し元へ直接答える（notify は押さない）。フィクスチャが
          // 画像なしと印した投稿は background.ts のその場合の答え方を模す＝画像なしでも
          // 保存はされる（ホストが sidecar を書き、#365 まで表示できない印を付ける）。
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

  // バンドルの cropScreenshot() は Image() を読んで切り抜きを描く。jsdom に画像デコーダは
  // 無いので、無害な canvas で即座に「読み込めた」ことにする。
  window.Image = class {
    onload: any;
    onerror: any;
    set src(_v: string) {
      Promise.resolve().then(() => this.onload?.());
    }
  } as any;
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} }) as any;
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,BBBB';

  // background.ts が自動取り込みのコマンドで注入する直前にやること。これが無いと、同じ
  // バンドルは同じページで単発の経路を走る（capture-mode-select.test.ts が検査している）。
  (window as any).__hologramAutoCapture = true;

  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'capture.js'), 'utf8'));
  await settle(1300); // i18n の非同期ラッパと MIN_SAVE_PERIOD_MS を越えて p2 の保存が終わるまで
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

// スクリーンショット版にできなかったこと: 順番が回ってきた時に画面上に居る必要があり、
// 速くスクロールすると取り逃していた。現れた時点でパーマリンクを読むので、行が後で
// 消えても関係なくなる。
test('現れた直後に行が消えた投稿も保存される', async () => {
  addPost('p4', 'dave', '444', 900);
  await settle(120);
  window.document.getElementById('p4')?.remove();
  await settle(1400);

  expect(savePostFor('https://x.com/dave/status/444')).toBeTruthy();
});

// 取り逃すと永久に失われる: X にブックマークの書き出しは無く、それがこの機能の存在理由
test('画像の無い投稿も飛ばさずに保存へ送る（#365）', async () => {
  noMediaUrls.add('https://x.com/erin/status/555');
  addPost('p5', 'erin', '555', 300);
  await settle(1400);

  expect(savePostFor('https://x.com/erin/status/555')).toBeTruthy();
});

// #492: 取得できなかった投稿は「保存済み」にも「不具合」にもしない。ライブラリに何も
// 入っていないのだから次の走行でもう一度出会えなければならず（バッジが点かないのは
// ホスト側の責務）、かつ削除済みの投稿が毎回「失敗」と出続けると、直すもののある故障と
// 見分けが付かなくなる。
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
  stopBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle();

  expect(bannerText().includes('中断') || bannerText().toLowerCase().includes('stop')).toBe(true);
  // 画像なしは「保存済み」として数える（飛ばした扱いにしない）
  expect(bannerText().includes('画像なし') || bannerText().toLowerCase().includes('image-less')).toBe(true);
  // 取得できなかった1件は要約に出るが、「失敗」ではない（#492）
  expect(bannerText().includes('取得できず') || bannerText().toLowerCase().includes('unavailable')).toBe(true);
  expect(bannerText().includes('失敗') || bannerText().toLowerCase().includes('failed')).toBe(false);
  expect((window as any).__snsPostSaveActive).toBeFalsy();
});
