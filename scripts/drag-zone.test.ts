// extension/utils/drag.ts（ドラッグ保存のドロップゾーン）の、オフライン純ユニットテスト。
// overlay.test.ts と同じ据え方＝常駐バンドル（resident.js、overlay.ts + drag.ts が同じ
// content script として同梱される）を jsdom の中で、実際の注入と同じグローバルのもとで
// 走らせ、本物の dragstart/dragenter/dragover/dragleave/drop/dragend イベントで駆動する。
//
// 見るのは、ドロップゾーンの見た目の状態遷移（idle → over → busy → ok/partial/fail）が
// setState の呼び出し内容と一致すること、投稿に同定できない画像（アバター等）はそもそも
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
      cb?.(sendReply);
    },
    onMessage: { addListener: () => {} },
  },
  storage: {
    local: { get: (_keys: any, cb: any) => cb({}) },
    onChanged: { addListener: () => {} },
  },
} as any;

const zone = () => window.document.getElementById('__hologramDropZone') as any;
const ring = () => zone()?.firstElementChild as any;
// zone.el の直接の子は常に [ring, badge, label] の3つ固定 — busy 状態では badge の中に
// スピナー div がネストされるので querySelector('div:last-child') は誤ってそちらを拾う。
// label は常に zone.el 自身の最後の子であることは変わらないので lastElementChild で拾う。
const label = () => zone()?.lastElementChild as any;
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
    expect(zone().style.display).toBe('flex');
  });

  test('ヒントテキストが出る', () => {
    expect(label().textContent).toBe('Drop here to save to Hologram');
  });

  test('idle: 変形なし・リングが見える', () => {
    expect(zone().style.transform).toBe('');
    expect(ring().style.opacity).toBe('1');
  });
});

describe('ゾーンへの dragenter/dragleave で over ⇄ idle', () => {
  test('dragenter で over（拡大・アクセント枠）', () => {
    zone().dispatchEvent(dragEvent('dragenter'));

    expect(zone().style.transform).toBe('scale(1.04) translateY(-2px)');
  });

  test('dragleave で idle に戻る', () => {
    zone().dispatchEvent(dragEvent('dragleave'));

    expect(zone().style.transform).toBe('');
    expect(ring().style.opacity).toBe('1');
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

  test('ok 状態: 緑の枠・リングは隠れる', () => {
    expect(zone().style.borderColor).toBe('rgba(48, 164, 108, 0.65)');
    expect(ring().style.opacity).toBe('0');
  });

  test('保存済みテキストを出す', () => {
    expect(label().textContent).toBe('Image saved');
  });

  test('しばらくすると隠れる', async () => {
    await settle(1600); // 成功の滞留 1400ms を越える

    expect(zone().style.display).toBe('none');
  });
});

describe('ドロップ: 部分成功（メタデータ取得失敗）', () => {
  beforeAll(async () => {
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    sendReply = { ok: true, metaOk: false, metaReason: 'protected' };
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
  });

  test('partial 状態: 琥珀の枠', () => {
    expect(zone().style.borderColor).toBe('rgba(232, 161, 58, 0.65)');
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

  test('fail 状態: 赤の枠', () => {
    expect(zone().style.borderColor).toBe('rgba(229, 72, 77, 0.65)');
  });

  test('復旧案内の文面（生のエラーは出さない）', () => {
    expect(label().textContent).toBe("Hologram's saver could not start. Open the diagnostics page from the extension settings.");
  });

  test('失敗表示もしばらくすると隠れる', async () => {
    await settle(2900); // 失敗の滞留 2600ms を越える

    expect(zone().style.display).toBe('none');
  });
});

test('ゾーンへ落とさず終わったドラッグ（dragend）は保存せず隠すだけ', async () => {
  const before = sent.length;
  window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
  expect(zone().style.display).toBe('flex');

  window.document.dispatchEvent(dragEvent('dragend'));
  await settle(300); // フェードの onfinish（スタブは次ティックで呼ぶ）が飛ぶまで余裕を見る

  expect(zone().style.display).toBe('none');
  expect(sent.length).toBe(before); // 新しいメッセージは送られていない
});
