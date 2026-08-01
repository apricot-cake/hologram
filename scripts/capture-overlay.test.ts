// Offline pure unit test for extension/utils/capture.ts (Alt+S single-shot capture: the post
// highlight rect and the banner's state transitions). Set up the same way as
// capture-mode-select.test.ts = runs the built capture.js inside jsdom, driven by real
// mousemove/click/keydown/runtime messages.
//
// capture-mode-select.test.ts only checks the branching between Alt+S and Alt+Shift+S modes.
// This checks what happens after entering single-shot mode: whether the highlight box follows
// the post, which of busy -> ok/partial/fail the banner lands on after selection, what text it
// shows, and whether Esc/right-click dismisses it cleanly without saving anything.
//
// Prerequisite: the extension's build output (extension/.output/chrome-mv3/capture.js) is needed.

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

// #323: the click that selects a post, the answer buttons, Esc, and right-click only pass
// through as user events. The version a page can dispatch (synthetic events) is the pageEvent
// side, used only by the guard's own tests.
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
  // What the host answers to #34's duplicate check. Right after setup() it's "no duplicate" = captures as before.
  setDuplicate: (answer: any) => void;
}

// Rebuild a fresh jsdom + bundle each time (same reason as runOn in capture-mode-select.test.ts:
// banner/highlight state-transition tests shouldn't depend on the previous scenario's cleanup).
async function setup(): Promise<Ctx> {
  const dom = new JSDOM(HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
  const { window } = dom;

  // dismissBanner only calls banner.remove() from inside onfinish (in a real browser, that's
  // the animation-end event). onfinish fires on the tick after it's assigned — with the "never
  // call it" stub from capture-mode-select.test.ts, we couldn't verify the banner's cleanup
  // (cleanup/dismissBanner).
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
  // Hold multiple = matches Chrome. Back when this was a single slot, the moment the save
  // watchdog (save-deadline.ts) added its own listener it overwrote the capture body's
  // listener, and notify stopped reaching anyone.
  const listeners: any[] = [];
  // #34: capturePost makes one round trip to checkDuplicate before capturing. Defaults to "no
  // duplicate"; only the three-way-banner scenarios override the answer via setDuplicate().
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
        addListener: (fn: any) => listeners.push(fn),
        removeListener: (fn: any) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  } as any;

  window.eval(BUNDLE);
  const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
  await settle(); // Until createI18n() and listener registration finish

  // #44: the in-page UI lives inside a shared ShadowRoot (ui-root.ts). Appearance is owned by
  // components.css, so all the tests check now is the class and data-state = just "which state".
  const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
  const banner = () => uiRoot()?.querySelector('[data-hologram-capture-banner]');
  const highlight = () => uiRoot()?.querySelector('.highlight');

  return {
    window,
    sent,
    notify: (msg: any) => {
      for (const fn of [...listeners]) fn(msg, {}, () => {});
    },
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
    await ctx.settle(100); // Past the double requestAnimationFrame
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

// #34: trying to capture an already-saved post with Alt+S shows a three-way choice before
// capturing. The key point is stopping the capture itself = choosing Skip means captureAndSend
// is never sent.
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

  // #158: a post whose actual record is still sitting in the trash. Same container (the
  // ask-before-save banner), but only two choices = there's no library record to replace.
  describe('ゴミ箱にある投稿の告知', () => {
    const TRASHED = { ok: true, duplicate: false, trashed: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } };

    test('告知バナーになり、選択肢は2つ（置換を出さない）', async () => {
      await clickPostWithDuplicate(TRASHED);
      // The date's formatting varies by the environment's locale/timezone, so only pin down the first half.
      // The date's formatting varies by the environment's locale/timezone, so pin down before/after
      // it. The trailing "can restore" is the wording's whole point = if it only said "where it
      // is" without saying how to restore, restoring is an in-app action with no entry point
      // showing anywhere (the banner can't have a button).
      expect(ctx.bannerLabel().textContent).toMatch(/^This post is in the trash \(deleted .+\)\. You can restore it in Hologram$/);
      expect(ctx.bannerButtons().map((b: any) => b.textContent)).toEqual(['Copy', 'Skip']);
      expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
    });

    // The button label is the same "Copy" as the duplicate case, so **only the helper text**
    // tells the two scenarios apart. Getting this mixed up means the trash scenario shows text
    // readable as "another copy of something already in the library" = a test that only looks
    // at the label would never catch that, so this checks the helper text directly.
    test('「コピー」の補助文はゴミ箱用（ゴミ箱の分が残ることまで言う）', async () => {
      await clickPostWithDuplicate(TRASHED);
      expect(ctx.bannerButtons()[0].title).toBe('Save a new record, leaving the trashed one alone');
    });

    test('重複の場面の補助文はライブラリ用のまま', async () => {
      await clickPostWithDuplicate();
      expect(ctx.bannerButtons()[0].title).toBe('Save it again as a second record');
    });

    test('削除日時が無い記録なら日付を省いた文言', async () => {
      await clickPostWithDuplicate({ ok: true, duplicate: false, trashed: { id: 'cap-gone', deletedAt: null } });
      expect(ctx.bannerLabel().textContent).toBe('This post is in the trash. You can restore it in Hologram');
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
    expect(ctx.bannerLabel().textContent).toBe('Post saved');
  });

  test('しばらくすると片付く（バナーが消え、再開可能になる）', async () => {
    await ctx.settle(1700); // Past the 1500ms success dwell time

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
    await ctx.settle(1600); // Past the success dwell time (1500ms) but not yet reaching the failure dwell time (2800ms)

    expect(ctx.banner()?.isConnected ?? false).toBe(true);
  });

  // #205: the extension and app versions have drifted apart. The save itself succeeded, so it
  // could just show a green "saved", but letting that through as-is means nobody notices an
  // update is needed = fall to the partial (amber) side instead, and show it before the other
  // success text.
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

    expect(ctx.bannerLabel().textContent).toBe('Post saved');
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

// #323: while a capture session is open, the page-side script shares the event path = a
// synthetic click was also reaching this handler. Both outcomes of that were serious =
// (1) a save could complete without any user click, and (2) a click that doesn't resolve to a
// post emitted a failure-log line each time, and each one of those lines spun up a native host
// process. Both are stopped right here.
describe('#323 ページ由来の合成イベントではセッションが動かない', () => {
  test('合成クリックは保存も失敗ログも起こさない（セッションは開いたまま）', async () => {
    const ctx = await setup();

    // On a post: a click that would start a save if it were real.
    ctx.window.document.querySelector('#post1 time').dispatchEvent(pageEvent(ctx, 'click'));
    // Somewhere that doesn't resolve to a post: a click that would produce a select/fail line if real (the path that spins up the host).
    ctx.window.document.getElementById('feed').dispatchEvent(pageEvent(ctx, 'click'));
    await ctx.settle(50);

    expect(ctx.sent).toEqual([]); // Not a single save or diagnostic log came out
    expect(ctx.bannerState()).toBe('active'); // Still waiting on "click a post"
    expect(ctx.window.__snsPostSaveActive).toBe(true);
  });

  test('合成の Esc / 右クリックではセッションを畳まない', async () => {
    const ctx = await setup();

    ctx.window.document.dispatchEvent(pageKey(ctx, 'Escape'));
    ctx.window.document.dispatchEvent(pageEvent(ctx, 'contextmenu'));
    await ctx.settle(50);

    expect(ctx.banner()?.isConnected).toBe(true);
    expect(ctx.sent).toEqual([]); // Not even a cancel line = it hasn't even been dismissed
  });

  test('ユーザーのクリックはそのまま通る（ガードが本物まで止めていないこと）', async () => {
    const ctx = await setup();

    ctx.window.document.querySelector('#post1 time').dispatchEvent(userEvent(ctx, 'click'));
    await ctx.settle(50);

    expect(ctx.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  });
});

// #519 added exactly one thing here = **a line recording that it was cancelled**. Of course a
// save isn't sent, but "sends nothing at all" is silence, and it would leave the same record as
// a frozen save (that was the cause of 3 separate misdiagnoses). The content of the line is checked by save-log.test.ts.
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
