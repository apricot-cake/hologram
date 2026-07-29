// extension/utils/drag.ts（ドラッグ保存のドロップゾーン）の、オフライン純ユニットテスト。
// overlay.test.ts と同じ据え方＝常駐バンドル（resident.js、overlay.ts + drag.ts が同じ
// content script として同梱される）を jsdom の中で、実際の注入と同じグローバルのもとで
// 走らせ、本物の dragstart/dragenter/dragover/dragleave/drop/dragend イベントで駆動する。
//
// 見るのは、ドロップゾーンの状態遷移（idle → active → busy → success/partial/error）が
// 実際に起きること、投稿に同定できない画像（アバター等）はそもそも
// ゾーンを出さないこと（media-identity.test.ts が見るのは extractIdentity 自体の正しさ、
// ここが見るのはその結果を drag.ts がどう使うか）、送るメッセージがドラッグ経路
// （imageDragged）であること。
//
// 前提: extension のビルド成果物（extension/.output/chrome-mv3/content-scripts/resident.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, test } from 'vitest';

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
// #34: onDrop は保存の前に checkDuplicate を1往復する。既定は「重複なし」で、
// 3択のシナリオだけ差し替える。
let duplicateAnswer: any = { ok: true, duplicate: false };

// animate() の呼び出し自体は無視してよいが、hideOverlay は onfinish の中でしか display を
// 戻さない（実ブラウザではアニメ終了イベント）。onfinish はここでは代入された次のティックで
// 呼ぶ — フェイクタイマーで拾えるよう setTimeout(…,0) 越しに。
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

window.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    sendMessage: (msg: any, cb: any) => {
      sent.push(msg);
      cb?.(msg.type === 'checkDuplicate' ? duplicateAnswer : sendReply);
    },
    onMessage: { addListener: () => {} },
  },
  storage: {
    local: { get: (_keys: any, cb: any) => cb({}) },
    onChanged: { addListener: () => {} },
  },
} as any;

// #44: ページ内 UI は body 直下ではなく共有の ShadowRoot の中にいる（ui-root.ts）。
// ホストページの CSS がこちらへ届かず、こちらの CSS も漏れないための境界なので、
// テストも実物と同じく境界の内側を見る。
const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
const zone = () => (uiRoot()?.getElementById('__hologramDropZone') ?? null) as any;
const ring = () => zone()?.querySelector('.ring') as any;
const label = () => zone()?.querySelector('.label') as any;
// 見た目そのものではなく「どの状態か」を見る（#44）＝色・アイコン・アニメの対応は
// components.css が1か所で持ち、drag.ts が決めるのは状態だけになった。
const state = () => zone()?.dataset.state;
// 要素の存在そのものが開閉状態（入場アニメ付きで mount、退場アニメの後に remove）。
const shown = () => !!zone()?.isConnected;
const dragEvent = (type: string) => new window.Event(type, { bubbles: true, cancelable: true });
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'content-scripts', 'resident.js'), 'utf8'));
  await settle(300); // startOverlay/startDrag の非同期初期化（createI18n 含む）が終わるまで
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
    expect(label().textContent).toBe('Image saved');
  });

  test('しばらくすると隠れる', async () => {
    await settle(1600); // 成功の滞留 1400ms を越える

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
    await settle(2900); // 失敗の滞留 2600ms を越える

    expect(shown()).toBe(false);
  });
});

// #34: すでに保存した絵をもう一度ドラッグしたときの3択。ドロップ経路は「ポインタが
// 運んだ絵」がそのまま保存対象なので、その絵の URL 群が照合の第2軸になる。
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
    await settle(2300); // 直前のシナリオの滞留を越えてゾーンを閉じきる
    duplicateAnswer = { ok: true, duplicate: true, captureId: 'cap-old' };
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
    const before = sent.length;
    buttons()[2].dispatchEvent(dragEvent('click'));
    await settle();
    expect(sent.length).toBe(before); // imageDragged は飛んでいない
    expect(label().textContent).toBe('Not saved');
    duplicateAnswer = { ok: true, duplicate: false };
    await settle(1500);
  });
});

test('ゾーンへ落とさず終わったドラッグ（dragend）は保存せず隠すだけ', async () => {
  const before = sent.length;
  window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
  expect(shown()).toBe(true);

  window.document.dispatchEvent(dragEvent('dragend'));
  await settle(300); // フェードの onfinish（スタブは次ティックで呼ぶ）が飛ぶまで余裕を見る

  expect(shown()).toBe(false);
  expect(sent.length).toBe(before); // 新しいメッセージは送られていない
});
