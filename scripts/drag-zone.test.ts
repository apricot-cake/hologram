// Offline pure unit test for extension/utils/drag.ts (the drag-save drop zone).
// Same setup as overlay.test.ts = runs the resident bundle (resident.js,
// bundling overlay.ts + drag.ts as the same content script) inside jsdom, under
// the same globals as the real injection, driven by real
// dragstart/dragenter/dragover/dragleave/drop/dragend events.
//
// What's checked: that the drop zone's state transitions (idle -> active ->
// busy -> success/partial/error) actually happen; that an image that can't be
// identified with a post (an avatar, etc.) never shows the zone in the first
// place (media-identity.test.ts checks extractIdentity's own correctness —
// this checks how drag.ts uses that result); and that the message sent is the
// drag path (imageDragged).
//
// Prerequisite: needs the extension's build artifact
// (extension/.output/chrome-mv3/content-scripts/resident.js).

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';
import { asUser } from './lib-user-event.ts';

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
      <div data-testid="tweetPhoto"><img id="img1" src="https://pbs.twimg.com/media/AAA.jpg"></div>
    </article>
  </div>
  <img id="imgAvatar" src="https://pbs.twimg.com/profile_images/BBB.jpg">
</body></html>`;

const dom = new JSDOM(HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
const { window } = dom;

const sent: any[] = [];
let sendReply: any = { ok: true, metaOk: true };
// #34: onDrop makes one round trip to checkDuplicate before saving. The
// default is "no duplicate", and only the 3-choice scenarios swap it out.
let duplicateAnswer: any = { ok: true, duplicate: false };

// The animate() call itself can be ignored, but hideOverlay only restores
// display from inside onfinish (the animation-end event on a real browser).
// Here, onfinish is called on the next tick after it's assigned — via
// setTimeout(...,0) so a fake timer can catch it.
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
  return handle;
};

window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

// Since the save watchdog (save-deadline.ts) adds and removes its own entry,
// make this a container that can actually register and unregister. It's not
// used for counting = the requirement is only that a place for it exists.
const dropListeners: any[] = [];

window.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    sendMessage: (msg: any, cb: any) => {
      sent.push(msg);
      cb?.(msg.type === 'checkDuplicate' ? duplicateAnswer : sendReply);
    },
    onMessage: {
      addListener: (fn: any) => dropListeners.push(fn),
      removeListener: (fn: any) => {
        const i = dropListeners.indexOf(fn);
        if (i >= 0) dropListeners.splice(i, 1);
      },
    },
  },
  storage: {
    local: { get: (_keys: any, cb: any) => cb({}) },
    onChanged: { addListener: () => {} },
  },
} as any;

// #44: the in-page UI lives inside a shared ShadowRoot (ui-root.ts), not
// directly under body. Since this boundary is what keeps the host page's CSS
// from reaching in and this CSS from leaking out, the test also looks inside the boundary, same as the real thing.
const uiHost = () => window.document.querySelector('hologram-extension-ui') as any;
const uiRoot = () => uiHost()?.shadowRoot;
const zone = () => (uiRoot()?.getElementById('__hologramDropZone') ?? null) as any;
const ring = () => zone()?.querySelector('.ring') as any;
const label = () => zone()?.querySelector('.label') as any;
// Checks "which state it's in", not the look itself (#44) = the color/icon/
// animation mapping is now held in one place, components.css, and all drag.ts decides is the state.
const state = () => zone()?.dataset.state;
// The element's mere existence is the open/closed state (mounted with an
// entrance animation, removed after the exit animation).
const shown = () => !!zone()?.isConnected;
// The user's drag, not the page's: the drag that arms the zone and the drop
// that commits it are both trusted-only since #323 (see lib-user-event.ts).
// `pageEvent` is the same event WITHOUT that mark — what a script on x.com can
// produce — and is used only by the guard's own tests below.
const pageEvent = (type: string) => new window.Event(type, { bubbles: true, cancelable: true });
const dragEvent = (type: string) => asUser(pageEvent(type));
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'content-scripts', 'resident.js'), 'utf8'));
  await settle(300); // wait until startOverlay/startDrag's async init (including createI18n) finishes
}, 30000);

test('投稿に同定できない画像（アバター）をドラッグしてもゾーンは作られない', () => {
  window.document.getElementById('imgAvatar')?.dispatchEvent(dragEvent('dragstart'));

  expect(zone()).toBeNull();
});

describe('投稿の絵をドラッグすると idle 状態でゾーンが出る', () => {
  beforeAll(() => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
  });

  test('表示される', () => {
    expect(shown()).toBe(true);
  });

  test('ヒントテキストが出る', () => {
    expect(label().textContent).toBe('Drop here to save to Hologram');
  });

  test('idle: 待機状態でリングを持つ', () => {
    expect(state()).toBe('idle');
    expect(ring()).not.toBeNull();
  });

  // #1057 (WCAG 2.2 SC 3.1.2): ホストページの言語はサイト側のもので、この UI の
  // 言語は i18n.ts が navigator.language から決めたもの＝一致する保証が無い。
  // shadow host が名乗らないとページ側の宣言が継承され、読み上げが別言語になる。
  // ここでは上のヒントが英語で出ている（jsdom の navigator.language は en-US）
  // ので、宣言もそれと同じ en でなければならない。
  test('shadow host が中の文言の言語を名乗る', () => {
    expect(uiHost().lang).toBe('en');
  });
});

describe('ゾーンへの dragenter/dragleave で over ⇄ idle', () => {
  test('dragenter で active（＝作用中・アクセントを取る状態）', () => {
    zone().dispatchEvent(dragEvent('dragenter'));

    expect(state()).toBe('active');
  });

  test('dragleave で idle に戻る', () => {
    zone().dispatchEvent(dragEvent('dragleave'));

    expect(state()).toBe('idle');
  });
});

describe('ドロップ: 成功', () => {
  beforeAll(async () => {
    sendReply = { ok: true, metaOk: true };
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('ドラッグ経路のメッセージを送る（プラットフォーム・投稿URL・画像URL群）', () => {
    const msg = sent.at(-1);
    expect(msg).toMatchObject({ type: 'imageDragged', platform: 'x', postUrl: 'https://x.com/alice/status/111' });
    expect(msg.imageUrls).toContain('https://pbs.twimg.com/media/AAA.jpg');
    expect(msg.imageUrls.some((u: string) => u.includes('name=orig'))).toBe(true);
  });

  test('success 状態へ転ぶ', () => {
    expect(state()).toBe('success');
  });

  test('保存済みテキストを出す', () => {
    expect(label().textContent).toBe('Post saved');
  });

  test('しばらくすると隠れる', async () => {
    await settle(1600); // exceeds the success dwell time of 1400ms

    expect(shown()).toBe(false);
  });
});

describe('ドロップ: 部分成功（メタデータ取得失敗）', () => {
  beforeAll(async () => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    sendReply = { ok: true, metaOk: false, metaReason: 'protected' };
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('partial 状態へ転ぶ', () => {
    expect(state()).toBe('partial');
  });

  test('理由付きの文面', () => {
    expect(label().textContent).toBe('Saved (post info unavailable: private account)');
  });
});

describe('ドロップ: グループ化（同じ投稿を2枚目）', () => {
  beforeAll(async () => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    sendReply = { ok: true, metaOk: true, grouped: 2 };
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('グループ化された枚数を文面に出す', () => {
    expect(label().textContent).toBe('Saved — grouped with your earlier image (3 of this post)');
  });
});

// #205: the drop path also shows the same notice = with 3 save exits but the
// message only spoken by one of them, someone who only ever uses drag would never learn an update is needed.
describe('ドロップ: 版のずれ（#205）', () => {
  beforeAll(async () => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    sendReply = { ok: true, metaOk: true, grouped: 0, hostSkew: 'host-old' };
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('保存できたことと更新の要求を同時に出す', () => {
    expect(label().textContent).toBe('Saved — please update the Hologram app (it no longer matches this extension)');
  });

  test('緑ではなく partial（琥珀）へ倒す＝見落とさせない', () => {
    expect(state()).toBe('partial');
  });
});

describe('ドロップ: 失敗', () => {
  beforeAll(async () => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    sendReply = { ok: false, errorKind: 'host-unavailable' };
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('error 状態へ転ぶ', () => {
    expect(state()).toBe('error');
  });

  test('復旧案内の文面（生のエラーは出さない）', () => {
    expect(label().textContent).toBe("Hologram's saver could not start. Open the diagnostics page from the extension settings.");
  });

  test('失敗表示もしばらくすると隠れる', async () => {
    await settle(2900); // exceeds the failure dwell time of 2600ms

    expect(shown()).toBe(false);
  });
});

// #34: the 3-way choice when an already-saved picture is dragged again. Since
// the drop path's save target is exactly "the picture the pointer carried",
// that picture's set of URLs becomes the second axis of matching.
describe('重複保存の警告（ドロップ前の3択）', () => {
  const buttons = () => Array.from(zone()?.querySelectorAll('button') || []) as any[];

  beforeAll(async () => {
    duplicateAnswer = { ok: true, duplicate: true, captureId: 'cap-old' };
    sendReply = { ok: true, metaOk: true };
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('3択が出て、まだ保存メッセージは飛んでいない', () => {
    expect(label().textContent).toBe('This post is already saved');
    expect(state()).toBe('ask');
    expect(buttons().map((b) => b.textContent)).toEqual(['Copy', 'Replace', 'Skip']);
    expect(sent.at(-1).type).toBe('checkDuplicate');
  });

  test('置換: 置き換える相手の captureId を載せて保存する', async () => {
    buttons()[1].dispatchEvent(dragEvent('click'));
    await settle();
    expect(sent.at(-1)).toMatchObject({ type: 'imageDragged', replaces: 'cap-old' });
    expect(label().textContent).toBe('Replaced (the earlier save goes to the trash)');
  });

  test('スキップ: 保存せずに閉じる', async () => {
    await settle(2300); // outlasts the previous scenario's dwell time to fully close the zone
    duplicateAnswer = { ok: true, duplicate: true, captureId: 'cap-old' };
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
    const before = sent.length;
    buttons()[2].dispatchEvent(dragEvent('click'));
    await settle();
    expect(sent.slice(before).map((m) => m.type)).not.toContain('imageDragged');
    // #519: choosing "cancel" is recorded in capture.log = it can be told apart from silence.
    expect(sent.at(-1)).toMatchObject({ type: 'logCapture', entry: { stage: 'duplicate', phase: 'skip' } });
    expect(label().textContent).toBe('Not saved');
    duplicateAnswer = { ok: true, duplicate: false };
    await settle(1500);
  });

  // #158: drag-save rides on this same vessel too = the text and choices must
  // stay aligned with capture.ts (otherwise the same decision would be asked
  // with a different face depending on the path).
  test('ゴミ箱に在る投稿は2択の告知（置換を出さない）', async () => {
    await settle(2300); // outlasts the previous scenario's dwell time to fully close the zone
    duplicateAnswer = { ok: true, duplicate: false, trashed: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } };
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    zone().dispatchEvent(dragEvent('drop'));
    await settle();

    expect(label().textContent).toMatch(/^This post is in the trash \(deleted .+\)\. You can restore it in Hologram$/);
    expect(state()).toBe('ask');
    expect(buttons().map((b) => b.textContent)).toEqual(['Copy', 'Skip']);
    // The button label stays the same and only the helper text tells the scene apart = the same text must appear on both paths (paired with capture.ts's side).
    expect(buttons()[0].title).toBe('Save a new record, leaving the trashed one alone');

    const before = sent.length;
    buttons()[0].dispatchEvent(dragEvent('click'));
    await settle();
    expect(sent.slice(before).find((m) => m.type === 'imageDragged')).toMatchObject({ replaces: null });

    duplicateAnswer = { ok: true, duplicate: false };
    await settle(1500);
  });
});

// #323: a synthetic event thrown by the page itself makes zero progress
// through this path. Drag-save's sole gate is the operation itself of "the
// user grabs a picture and drops it on the zone", and without checking
// isTrusted, a page-side script could make a save go through whenever it wanted.
describe('#323 ページ由来の合成イベントでは動かない', () => {
  test('合成 dragstart はゾーンを出さない（保存の入口が開かない）', async () => {
    await settle(1600); // until the previous scenario's zone fully closes
    window.document.getElementById('img1')?.dispatchEvent(pageEvent('dragstart'));

    expect(shown()).toBe(false);
  });

  test('本物のドラッグ中でも、合成 drop は保存を送らない', async () => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    expect(shown()).toBe(true);
    const before = sent.length;

    zone().dispatchEvent(pageEvent('drop'));
    await settle();

    expect(sent.slice(before).map((m) => m.type)).not.toContain('imageDragged');
    expect(state()).toBe('idle'); // the zone is still waiting for the user's drop

    window.document.dispatchEvent(dragEvent('dragend'));
    await settle(300);
  });
});

test('ゾーンへ落とさず終わったドラッグ（dragend）は保存せず隠すだけ', async () => {
  const before = sent.length;
  window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
  expect(shown()).toBe(true);

  window.document.dispatchEvent(dragEvent('dragend'));
  await settle(300); // give extra room for the fade's onfinish to fire (the stub calls it on the next tick)

  expect(shown()).toBe(false);
  expect(sent.length).toBe(before); // no new message was sent
});
