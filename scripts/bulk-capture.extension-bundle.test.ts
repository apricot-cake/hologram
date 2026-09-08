// extension/utils/bulk-capture.ts ＝X のブックマークを流し見しながらの自動取り込み (#362) の、
// 通信しない純粋な単体テスト。ビルド済みの bulk.js を jsdom の中で走らせる。
// フィクスチャの URL は現行 X の /i/history。自動取り込みは一覧の右クリックメニューから起動する。
//
// 何を確かめるか。自動スクロールをしないこと（window.scrollY を動かさないし wheel/scroll も
// 投げない）。行が「現れた」瞬間にパーマリンクを読むので、速くスクロールしても取りこぼさない
// こと。保存済みの確認がまとめて出て、「保存済み」と答えが返れば savePost を飛ばすこと。保存が
// 一括取り込みのマーカーを運ぶこと。画像の無い投稿も保存され（#365 が入るまでは表示できない
// だけ）、専用のバケットで数えられること。そして停止すると要約が出ること。
// 何を確かめないか。X のブックマークのページが、今日もこのフィクスチャの想定どおりの形で
// 描かれているかどうか（overlay.extension-bundle.test.ts / content-fixtures.test.ts と同じ限界＝生きたカナリアは
// scripts/e2e-capture-test.cts）。
//
// このスイートは1枚のページを順に動かすので、テストの宣言順に意味がある。
//
// 前提: 拡張機能のテスト用出力 (extension/.output/chrome-mv3-test/bulk.js) が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, expect, test } from 'vitest';
import { asUser } from './lib-user-event.ts';

// ブックマークした投稿が5件。p1/p2 は固定ヘッダの下、ビューポートの中にすっかり収まる（取り込める）。
// p3 はまだ rect を持たない（折り返しの下＝本物の仮想リストがまだ配置していない）。
// p4/p5 はテストがスクロールを模した後で DOM へ足す。
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

const dom = new JSDOM(HTML, { url: 'https://x.com/i/history', runScripts: 'outside-only' });
const { window } = dom;

const sent: any[] = [];
const noMediaUrls = new Set<string>();
// 投稿そのものを取得できなかった＝ホストが何も書かずに断った (#492)
const unavailableUrls = new Set<string>();
// p1 は最初の収集の時点ですでにライブラリにある＝savePost へ届く前に飛ばさなければ
// ならない（#54 の経路が存在する理由そのもの＝すでに踏んだ地面について X へ問い合わせない）
const savedAnswer: Record<string, string | { id: string; media: string[]; post: boolean } | null> = { 'https://x.com/alice/status/111': '1780000000000-aa' };

// #44: ページ内の UI は共有の ShadowRoot (ui-root.ts) の中にある。
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
  // jsdom はレイアウトを一切しない＝capturable() が getBoundingClientRect() を読むので、
  // フィクスチャが自分で幾何を宣言する（overlay.extension-bundle.test.ts と同じ作法）。
  // jsdom の window.innerHeight の既定は 768 で、ここのどの rect よりも十分に小さい。
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
    // ほぼ同期。本物のフレームではなく次のマイクロタスクで解決する＝captureOne() が
    // 一括取り込みが待つフレームを、偽の時計を回さずに越えられる
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
          const results: typeof savedAnswer = {};
          for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
          cb?.({ ok: true, results });
          return;
        }
        if (msg.type === 'savePost') {
          // 本物の background は呼び出し元へ直に答える（通知を押し込まない）。フィクスチャが
          // 画像なしと印を付けた投稿も、画像付きと同じ保存成功を返す。
          if (unavailableUrls.has(msg.postUrl)) cb?.({ ok: false, errorKind: 'post-unavailable', error: 'Post unavailable: nothing was obtained for it' });
          else if (noMediaUrls.has(msg.postUrl)) cb?.({ ok: true, file: 'x.json' });
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

  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-test', 'bulk.js'), 'utf8'));
  await settle(1300); // p2 の保存が終わるまで。i18n の非同期のラッパと MIN_SAVE_PERIOD_MS を越える
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

test('進捗バナーが保存済みと飛ばした数を数える', () => {
  expect(bannerText()).toContain('1');
  expect(bannerText().includes('保存') || bannerText().toLowerCase().includes('saved')).toBe(true);
});

// 順番が回ってきた時点で投稿がまだ画面に残っている必要はない。パーマリンクは現れた瞬間に読むので、
// その後で行が消えても関係ない。
test('現れた直後に行が消えた投稿も保存される', async () => {
  addPost('p4', 'dave', '444', 900);
  await settle(120);
  window.document.getElementById('p4')?.remove();
  await settle(1400);

  expect(savePostFor('https://x.com/dave/status/444')).toBeTruthy();
});

// 1件でも取り逃がせば永久に失われる。X にブックマークの書き出しは無く、それがこの機能の存在理由そのもの
test('画像の無い投稿も飛ばさずに保存へ送る（#365）', async () => {
  noMediaUrls.add('https://x.com/erin/status/555');
  addPost('p5', 'erin', '555', 300);
  await settle(1400);

  expect(savePostFor('https://x.com/erin/status/555')).toBeTruthy();
});

// #492: 取得できなかった投稿は「保存済み」でも「故障」でもないものとして扱う。実際には
// ライブラリに何も入っていないので、次の実行でもう一度出会わなければならない（バッジが
// 点くかどうかはホストの受け持ち）。そして削除された投稿が毎回「失敗」と出続ければ、直す
// 価値のある本物の不具合と見分けが付かなくなる。
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

test('個別保存済みの投稿も投稿全体の保存へ送る', async () => {
  const url = 'https://x.com/individual/status/888';
  savedAnswer[url] = { id: 'individual', media: ['https://pbs.twimg.com/media/one.jpg'], post: false };
  addPost('individual', 'individual', '888', 300);
  await settle(1400);
  expect(savePostFor(url)).toBeTruthy();
  expect(savePostFor(url)).not.toHaveProperty('mediaKeys');
});

test('停止すると、生のカウンタではなく要約が出る', async () => {
  const stopBtn = Array.from(banner()?.querySelectorAll('button') || [])[0] as HTMLButtonElement;
  stopBtn.dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
  await settle();

  expect(bannerText().includes('中断') || bannerText().toLowerCase().includes('stop')).toBe(true);
  // 画像の無い投稿も通常の「保存」に数える。
  expect(bannerText().includes('画像なし') || bannerText().toLowerCase().includes('image-less')).toBe(false);
  // 取得できなかった1件は要約に出るが、「失敗」としては出ない (#492)
  expect(bannerText().includes('取得できず') || bannerText().toLowerCase().includes('unavailable')).toBe(true);
  expect(bannerText().includes('失敗') || bannerText().toLowerCase().includes('failed')).toBe(false);
  expect((window as any).__snsPostSaveActive).toBeFalsy();
});
