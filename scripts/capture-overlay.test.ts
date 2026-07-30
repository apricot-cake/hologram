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
import { asUser } from './lib-user-event.ts';

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

// #323: 投稿を選ぶクリック・答えのボタン・Esc・右クリックは、ユーザーのイベントで
// しか通らない。ページが投げられる版（合成イベント）は pageEvent 側で、そちらは
// ガード自身のテストだけが使う。
const pageEvent = (ctx: Ctx, type: string) => new ctx.window.Event(type, { bubbles: true, cancelable: true });
const userEvent = (ctx: Ctx, type: string) => asUser(pageEvent(ctx, type));
const pageKey = (ctx: Ctx, key: string) => new ctx.window.KeyboardEvent('keydown', { key, bubbles: true });
const userKey = (ctx: Ctx, key: string) => asUser(pageKey(ctx, key));

interface Ctx {
  window: any;
  sent: any[];
  notify: (msg: any) => void;
  banner: () => any;
  bannerState: () => string | null;
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

  // #44: ページ内 UI は共有の ShadowRoot の中（ui-root.ts）。見た目は components.css が
  // 持つので、テストが見るのはクラスと data-state＝「どの状態か」だけになった。
  const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
  const banner = () => uiRoot()?.querySelector('[data-hologram-capture-banner]');
  const highlight = () => uiRoot()?.querySelector('.highlight');

  return {
    window,
    sent,
    notify: (msg: any) => listener?.(msg, {}, () => {}),
    banner,
    bannerState: () => banner()?.dataset.state ?? null,
    bannerLabel: () => banner()?.querySelector('.label'),
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
    time.dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(100); // 二重 requestAnimationFrame を越える
  });

  test('選択した投稿の rect と permalink を送る', () => {
    const msg = ctx.sent.at(-1);
    expect(msg).toMatchObject({ type: 'captureAndSend', postUrl: 'https://x.com/alice/status/111', platform: 'x' });
    expect(msg.rect).toMatchObject({ x: 50, y: 100, width: 300, height: 300 });
  });

  test('バナーは保存中の文面のまま出ている', () => {
    expect(ctx.banner().style.display).not.toBe('none');
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
    ctx.window.document.querySelector('#post1 time').dispatchEvent(userEvent(ctx, 'click'));
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
    ctx.bannerButtons()[2].dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(100);
    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
    expect(ctx.bannerLabel().textContent).toBe('Not saved');
  });

  test('コピー: 置換の印なしで撮る', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[0].dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(100);
    expect(ctx.sent.at(-1)).toMatchObject({ type: 'captureAndSend', replaces: null });
  });

  test('置換: 置き換える相手の captureId を載せて撮る', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[1].dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(100);
    expect(ctx.sent.at(-1)).toMatchObject({ type: 'captureAndSend', replaces: 'cap-old' });
  });

  test('置換のあとの成功表示は「置き換えました」', async () => {
    await clickPostWithDuplicate();
    ctx.bannerButtons()[1].dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(100);
    ctx.notify({ type: 'notify', success: true, metaOk: true, grouped: 1 });
    expect(ctx.bannerLabel().textContent).toBe('Replaced (the earlier save goes to the trash)');
  });

  test('ホストが答えられない（ok:false）ときは聞かずに撮る＝保存を止めない', async () => {
    await clickPostWithDuplicate({ ok: false });
    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  });

  // #158: ゴミ箱に現物が残っている投稿。同じ器（保存前に聞くバナー）だが選択肢は2つ＝
  // 置換する相手のレコードがライブラリに無い。
  describe('ゴミ箱にある投稿の告知', () => {
    const TRASHED = { ok: true, duplicate: false, trashed: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } };

    test('告知バナーになり、選択肢は2つ（置換を出さない）', async () => {
      await clickPostWithDuplicate(TRASHED);
      // 日付は環境のロケール・時間帯で表記が変わるので、前半だけを固定して見る。
      expect(ctx.bannerLabel().textContent).toMatch(/^This post is in the trash \(deleted .+\)$/);
      expect(ctx.bannerButtons().map((b: any) => b.textContent)).toEqual(['Copy', 'Skip']);
      expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
    });

    test('削除日時が無い記録なら日付を省いた文言', async () => {
      await clickPostWithDuplicate({ ok: true, duplicate: false, trashed: { id: 'cap-gone', deletedAt: null } });
      expect(ctx.bannerLabel().textContent).toBe('This post is in the trash');
    });

    test('コピー: 置換の印なしで撮る（新しい1件になる）', async () => {
      await clickPostWithDuplicate(TRASHED);
      ctx.bannerButtons()[0].dispatchEvent(userEvent(ctx, 'click'));
      await ctx.settle(100);
      expect(ctx.sent.at(-1)).toMatchObject({ type: 'captureAndSend', replaces: null });
    });

    test('スキップ: 保存しない', async () => {
      await clickPostWithDuplicate(TRASHED);
      ctx.bannerButtons()[1].dispatchEvent(userEvent(ctx, 'click'));
      await ctx.settle(100);
      expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
      expect(ctx.bannerLabel().textContent).toBe('Not saved');
    });

    test('告知が無ければ何も聞かずに撮る', async () => {
      await clickPostWithDuplicate({ ok: true, duplicate: false });
      expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
    });
  });
});

describe('notify: 成功', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
    ctx.window.document.querySelector('#post1 time').dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(100);
    ctx.notify({ type: 'notify', success: true });
  });

  test('ok 状態の文面', () => {
    expect(ctx.bannerLabel().textContent).toBe('Image saved');
  });

  test('しばらくすると片付く（バナーが消え、再開可能になる）', async () => {
    await ctx.settle(1700); // 成功の滞留 1500ms を越える

    expect(ctx.banner()?.isConnected ?? false).toBe(false);
    expect(ctx.window.__snsPostSaveActive).toBe(false);
  });
});

describe('notify: 部分成功・グループ化・失敗', () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await setup();
    ctx.window.document.querySelector('#post1 time').dispatchEvent(userEvent(ctx, 'click'));
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

    expect(ctx.banner()?.isConnected ?? false).toBe(true);
  });

  // #205: 拡張とアプリの版がずれている。保存は成功しているので緑の「保存しました」に
  // なりうるが、そのまま流すと更新が要ることに誰も気付かない＝partial（琥珀）の側へ
  // 倒して、他の成功文面より前に出す。
  test('版のずれは、保存できたことと更新の要求を同時に出す', () => {
    ctx.notify({ type: 'notify', success: true, metaOk: true, grouped: 0, hostSkew: 'host-old' });

    expect(ctx.bannerLabel().textContent).toBe('Saved — please update the Hologram app (it no longer matches this extension)');
    expect(ctx.bannerState()).toBe('partial');
  });

  test('版のずれは、グループ化の知らせより前に出る', () => {
    ctx.notify({ type: 'notify', success: true, metaOk: true, grouped: 1, hostSkew: 'host-new' });

    expect(ctx.bannerLabel().textContent).toBe('Saved — please update the extension (it no longer matches the Hologram app)');
  });

  test('ずれていなければ普段どおりの成功', () => {
    ctx.notify({ type: 'notify', success: true, metaOk: true, grouped: 0, hostSkew: null });

    expect(ctx.bannerLabel().textContent).toBe('Image saved');
    expect(ctx.bannerState()).toBe('success');
  });
});

describe('パーマリンクが無い投稿は選ぶと即座に失敗する', () => {
  test('理由付きの fail 文面で、保存メッセージは送らない', async () => {
    const ctx = await setup();
    ctx.window.document.querySelector('#post2 [data-testid="tweetText"]').dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(50);

    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
    expect(ctx.bannerLabel().textContent).toBe('Save failed: could not find the post link');
  });
});

// #323: キャプチャセッションが開いている間、ページ側スクリプトはイベント経路を共有して
// いる＝合成クリックがこのハンドラにも届いていた。届いた結果は2つとも重い＝①ユーザーの
// クリック無しに保存が成立する ②投稿に解決しないクリックが失敗ログを1行ずつ出し、その
// 1行ごとにネイティブホストのプロセスが起動する。どちらもここで止める。
describe('#323 ページ由来の合成イベントではセッションが動かない', () => {
  test('合成クリックは保存も失敗ログも起こさない（セッションは開いたまま）', async () => {
    const ctx = await setup();

    // 投稿の上：本物なら保存が始まるクリック。
    ctx.window.document.querySelector('#post1 time').dispatchEvent(pageEvent(ctx, 'click'));
    // 投稿に解決しない場所：本物なら select/fail の行が出るクリック（ホスト起動の経路）。
    ctx.window.document.getElementById('feed').dispatchEvent(pageEvent(ctx, 'click'));
    await ctx.settle(50);

    expect(ctx.sent).toEqual([]); // 保存も診断ログも1件も出ない
    expect(ctx.bannerState()).toBe('active'); // まだ「投稿をクリック」を待っている
    expect(ctx.window.__snsPostSaveActive).toBe(true);
  });

  test('合成の Esc / 右クリックではセッションを畳まない', async () => {
    const ctx = await setup();

    ctx.window.document.dispatchEvent(pageKey(ctx, 'Escape'));
    ctx.window.document.dispatchEvent(pageEvent(ctx, 'contextmenu'));
    await ctx.settle(50);

    expect(ctx.banner()?.isConnected).toBe(true);
    expect(ctx.sent).toEqual([]); // cancel の行も出ない＝やめてすらいない
  });

  test('ユーザーのクリックはそのまま通る（ガードが本物まで止めていないこと）', async () => {
    const ctx = await setup();

    ctx.window.document.querySelector('#post1 time').dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(50);

    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  });
});

// #519 でここは1つだけ増えた＝**やめたことを記録する1行**。保存は当然送らないが、
// 「何も送らない」だと沈黙になり、固まった保存と同じ記録になってしまう（それが3回の
// 誤診の原因）。行の中身は save-log.test.ts が見る。
describe('Escape / 右クリックでキャンセル', () => {
  const saveMessages = (ctx: any) => ctx.sent.filter((m: any) => m.type !== 'logCapture');

  test('Escape は保存を送らずに片付き、やめたことだけ記録する', async () => {
    const ctx = await setup();
    ctx.window.document.dispatchEvent(userKey(ctx, 'Escape'));
    await ctx.settle(50);

    expect(saveMessages(ctx)).toHaveLength(0);
    expect(ctx.sent).toEqual([{ type: 'logCapture', entry: expect.objectContaining({ stage: 'select', phase: 'cancel' }) }]);
    expect(ctx.banner()?.isConnected ?? false).toBe(false);
    expect(ctx.window.__snsPostSaveActive).toBe(false);
  });

  test('右クリックも同じ（保存は送らない・やめたことは残る）', async () => {
    const ctx = await setup();
    ctx.window.document.dispatchEvent(userEvent(ctx, 'contextmenu'));
    await ctx.settle(50);

    expect(saveMessages(ctx)).toHaveLength(0);
    expect(ctx.sent).toEqual([{ type: 'logCapture', entry: expect.objectContaining({ stage: 'select', phase: 'cancel' }) }]);
    expect(ctx.banner()?.isConnected ?? false).toBe(false);
  });
});
