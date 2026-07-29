// extension/utils/capture.ts（Alt+S 単発キャプチャ: 投稿のハイライト矩形とバナーの状態
// 遷移）の、オフライン純ユニットテスト。capture-mode-select.test.ts と同じ据え方＝ビルド
// 済みの capture.js を jsdom の中で走らせ、本物の mousemove/click/keydown/runtime メッセージ
// で駆動する。
//
// capture-mode-select.test.ts が見るのは Alt+S と Alt+Shift+S のどちらのモードに入るかの
// 分岐だけ。ここが見るのは単発モードに入った後: ハイライト枠が投稿を追い、選択後に
// バナーが busy → ok/partial/fail のどれへ転ぶか、テキストは何を出すか、Esc/右クリックで
// 何も保存せずに片付くか。
//
// 前提: extension のビルド成果物（extension/.output/chrome-mv3/capture.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, test } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="post1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
    <article data-testid="tweet" id="post2" data-rect-top="500" data-rect-size="200">
      <div data-testid="tweetText">no permalink anchor rendered</div>
    </article>
  </div>
</body></html>`;

interface Ctx {
  window: any;
  sent: any[];
  notify: (msg: any) => void;
  banner: () => any;
  bannerLabel: () => any;
  bannerButtons: () => any[];
  highlight: () => any;
  settle: (ms?: number) => Promise<void>;
  // #34 の重複照会にホストが何と答えるか。setup() 直後は「重複なし」＝従来どおり撮る。
  setDuplicate: (answer: any) => void;
}

// 新しい jsdom + バンドルを毎回作り直す（capture-mode-select.test.ts の runOn と同じ理由:
// バナー/ハイライトの状態遷移テストは、前のシナリオの後始末に依存させたくない）。
async function setup(): Promise<Ctx> {
  const dom = new JSDOM(HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
  const { window } = dom;

  // dismissBanner は onfinish の中でしか banner.remove() しない（実ブラウザではアニメ
  // 終了イベント）。onfinish は代入された次のティックで呼ぶ — capture-mode-select.test.ts
  // の「呼ばない」スタブだとバナーの片付き（cleanup/dismissBanner）を検証できない。
  window.Element.prototype.animate = function () {
    let onfinish: (() => void) | null = null;
    let cancelled = false;
    const handle: any = {
      cancel() {
        cancelled = true;
      },
      finish() {},
    };
    Object.defineProperty(handle, 'onfinish', {
      get: () => onfinish,
      set: (fn) => {
        onfinish = fn;
        setTimeout(() => {
          if (!cancelled) onfinish?.();
        }, 0);
      },
    });
    Object.defineProperty(handle, 'oncancel', { get: () => null, set: () => {} });
    return handle;
  };
  window.Element.prototype.getBoundingClientRect = function () {
    const declared = this.getAttribute?.('data-rect-top');
    if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    const top = Number(declared);
    const size = Number(this.getAttribute('data-rect-size') || 300);
    return { left: 50, top, right: 50 + size, bottom: top + size, width: size, height: size, x: 50, y: top };
  };
  window.Element.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  window.scrollBy = () => {};
  window.requestAnimationFrame = (fn: any) => {
    Promise.resolve().then(fn);
    return 1;
  };
  window.cancelAnimationFrame = () => {};

  const sent: any[] = [];
  let listener: any = null;
  // #34: capturePost は撮る前に checkDuplicate を1往復する。既定は「重複なし」で、
  // 3択バナーのシナリオだけ setDuplicate() で答えを差し替える。
  let duplicateAnswer: any = { ok: true, duplicate: false };
  window.chrome = {
    storage: { local: { get: (_keys: any, cb: any) => cb({}) } },
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb?: any) => {
        sent.push(msg);
        if (msg.type === 'checkDuplicate') cb?.(duplicateAnswer);
      },
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
        removeListener: (fn: any) => {
          if (listener === fn) listener = null;
        },
      },
    },
  } as any;

  window.eval(BUNDLE);
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  await settle(); // createI18n() とリスナー登録が終わるまで

  // capture.ts のバナー/ハイライトは data 属性を持たない（overlay.ts と違う）ので、
  // border-radius の形（ピル状バナー vs 角丸ハイライト枠）で見分ける。
  const findDiv = (pred: (el: any) => boolean) => Array.from(window.document.body.querySelectorAll('div')).find(pred);
  const banner = () => findDiv((el) => el.style.borderRadius === '999px');
  const highlight = () => findDiv((el) => el.style.borderRadius === 'var(--hologram-radius)');

  return {
    window,
    sent,
    notify: (msg: any) => listener?.(msg, {}, () => {}),
    banner,
    // 子は [badge, label] 固定で、#34 の 3択だけが3つ目として後ろに付く — label は
    // 常に2つ目なので、lastElementChild ではなく位置で拾う。
    bannerLabel: () => banner()?.children[1],
    bannerButtons: () => Array.from(banner()?.querySelectorAll('button') || []),
    highlight,
    settle,
    setDuplicate: (answer: any) => {
      duplicateAnswer = answer;
    },
  };
}

describe('ハイライト枠は mousemove でホバーした投稿を追う', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
  });

  test('投稿の内側の要素をホバーすると、投稿全体を囲む枠が出る（4px の余白付き）', () => {
    const time = ctx.window.document.querySelector('#post1 time');
    time.dispatchEvent(new ctx.window.Event('mousemove', { bubbles: true }));

    const hl = ctx.highlight();
    expect(hl.style.display).toBe('block');
    expect(hl.style.top).toBe('96px'); // rect.top(100) + scrollY(0) - 4
    expect(hl.style.left).toBe('46px'); // rect.left(50) - 4
    expect(hl.style.width).toBe('308px'); // rect.width(300) + 8
    expect(hl.style.height).toBe('308px');
  });

  test('投稿の外へ出ると隠れる', () => {
    ctx.window.document.getElementById('feed').dispatchEvent(new ctx.window.Event('mousemove', { bubbles: true }));

    expect(ctx.highlight().style.display).toBe('none');
  });
});

describe('投稿をクリックすると busy バナーになり captureAndSend を送る', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
    const time = ctx.window.document.querySelector('#post1 time');
    time.dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100); // 二重 requestAnimationFrame を越える
  });

  test('選択した投稿の rect と permalink を送る', () => {
    const msg = ctx.sent.at(-1);
    expect(msg).toMatchObject({ type: 'captureAndSend', postUrl: 'https://x.com/alice/status/111', platform: 'x' });
    expect(msg.rect).toMatchObject({ x: 50, y: 100, width: 300, height: 300 });
  });

  test('バナーは保存中の文面のまま出ている', () => {
    expect(ctx.banner().style.display).toBe('flex');
    expect(ctx.bannerLabel().textContent).toBe('Saving...');
  });

  test('選び終えたのでハイライト枠は隠れる', () => {
    expect(ctx.highlight().style.display).toBe('none');
  });
});

// #34: 保存済みの投稿を Alt+S で撮ろうとすると、撮る前に3択を出す。撮影そのものを
// 止めるのが要点＝スキップを選んだら captureAndSend は一度も飛ばない。
describe('重複保存の警告（保存前の3択）', () => {
  let ctx: Ctx;

  async function clickPostWithDuplicate(answer: any = { ok: true, duplicate: true, captureId: 'cap-old' }) {
    ctx = await setup();
    ctx.setDuplicate(answer);
    ctx.window.document.querySelector('#post1 time').dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
  }

  test('重複なら3択バナーになり、まだ撮っていない', async () => {
    await clickPostWithDuplicate();
    expect(ctx.bannerLabel().textContent).toBe('This post is already saved');
    expect(ctx.bannerButtons().map((b: any) => b.textContent)).toEqual(['Copy', 'Replace', 'Skip']);
    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
  });

  test('スキップ: 保存せずに片付く', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[2].dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
    expect(ctx.bannerLabel().textContent).toBe('Not saved');
  });

  test('コピー: 置換の印なしで撮る', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[0].dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
    expect(ctx.sent.at(-1)).toMatchObject({ type: 'captureAndSend', replaces: null });
  });

  test('置換: 置き換える相手の captureId を載せて撮る', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[1].dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
    expect(ctx.sent.at(-1)).toMatchObject({ type: 'captureAndSend', replaces: 'cap-old' });
  });

  test('置換のあとの成功表示は「置き換えました」', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[1].dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
    ctx.notify({ type: 'notify', success: true, metaOk: true, grouped: 1 });
    expect(ctx.bannerLabel().textContent).toBe('Replaced (the earlier save goes to the trash)');
  });

  test('ホストが答えられない（ok:false）ときは聞かずに撮る＝保存を止めない', async () => {
    await clickPostWithDuplicate({ ok: false });
    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  });
});

describe('notify: 成功', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
    ctx.window.document.querySelector('#post1 time').dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
    ctx.notify({ type: 'notify', success: true });
  });

  test('ok 状態の文面', () => {
    expect(ctx.bannerLabel().textContent).toBe('Image saved');
  });

  test('しばらくすると片付く（バナーが消え、再開可能になる）', async () => {
    await ctx.settle(1700); // 成功の滞留 1500ms を越える

    expect(ctx.window.document.body.contains(ctx.banner())).toBe(false);
    expect(ctx.window.__snsPostSaveActive).toBe(false);
  });
});

describe('notify: 部分成功・グループ化・失敗', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
    ctx.window.document.querySelector('#post1 time').dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(100);
  });

  test('メタデータ取得失敗は理由付きの partial 文面', () => {
    ctx.notify({ type: 'notify', success: true, metaOk: false, metaReason: 'ageRestricted' });

    expect(ctx.bannerLabel().textContent).toBe('Saved (post info unavailable: age-restricted post)');
  });

  test('同じ投稿の2枚目はグループ化された枚数を出す', () => {
    ctx.notify({ type: 'notify', success: true, grouped: 1 });

    expect(ctx.bannerLabel().textContent).toBe('Saved — grouped with your earlier image (2 of this post)');
  });

  test('失敗は復旧案内の文面で、生のエラーは出さない', async () => {
    ctx.notify({ type: 'notify', success: false, errorKind: 'host-unavailable', error: 'raw diagnostic detail' });

    expect(ctx.bannerLabel().textContent).toBe("Hologram's saver could not start. Open the diagnostics page from the extension settings.");
    expect(ctx.bannerLabel().textContent).not.toContain('raw diagnostic');
  });

  test('失敗は成功より長く滞留する', async () => {
    ctx.notify({ type: 'notify', success: false, errorKind: 'host-unavailable' });
    await ctx.settle(1600); // 成功の滞留(1500ms)は越えたが失敗の滞留(2800ms)にはまだ届かない

    expect(ctx.window.document.body.contains(ctx.banner())).toBe(true);
  });
});

describe('パーマリンクが無い投稿は選ぶと即座に失敗する', () => {
  test('理由付きの fail 文面で、保存メッセージは送らない', async () => {
    const ctx = await setup();
    ctx.window.document.querySelector('#post2 [data-testid="tweetText"]').dispatchEvent(new ctx.window.Event('click', { bubbles: true, cancelable: true }));
    await ctx.settle(50);

    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
    expect(ctx.bannerLabel().textContent).toBe('Save failed: could not find the post link');
  });
});

describe('Escape / 右クリックでキャンセル', () => {
  test('Escape は何も送らずに片付く', async () => {
    const ctx = await setup();
    ctx.window.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await ctx.settle(50);

    expect(ctx.sent).toHaveLength(0);
    expect(ctx.window.document.body.contains(ctx.banner())).toBe(false);
    expect(ctx.window.__snsPostSaveActive).toBe(false);
  });

  test('右クリックも何も送らずに片付く', async () => {
    const ctx = await setup();
    ctx.window.document.dispatchEvent(new ctx.window.Event('contextmenu', { bubbles: true, cancelable: true }));
    await ctx.settle(50);

    expect(ctx.sent).toHaveLength(0);
    expect(ctx.window.document.body.contains(ctx.banner())).toBe(false);
  });
});
