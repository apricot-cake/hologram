// extension/utils/drag.ts（ドラッグ保存のドロップゾーン）のオフライン純粋単体テスト。
// 段取りは overlay.test.ts と同じ＝常駐バンドル（resident.js。overlay.ts と drag.ts を同じ
// コンテンツスクリプトとして束ねたもの）を jsdom の中で、実際の注入と同じグローバルの下で
// 走らせ、本物の dragstart/dragenter/dragover/dragleave/drop/dragend イベントで駆動する。
//
// 見るもの: ドロップゾーンの状態遷移（idle → active → busy → success/partial/error）が実際に
// 起きること。投稿に同定できない画像（アバターなど）ではそもそもゾーンを出さないこと
// （extractIdentity 自体の正しさは media-identity.test.ts が見る＝ここで見るのは、その結果を
// drag.ts がどう使うか）。そして送るメッセージがドラッグ経路のもの（imageDragged）であること。
//
// 前提: 拡張機能のビルド成果物
// (extension/.output/chrome-mv3/content-scripts/resident.js) が要る。

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
// #34: onDrop は保存の前に checkDuplicate へ1往復する。既定は「重複なし」で、これを差し替える
// のは3択のシナリオだけ。
let duplicateAnswer: any = { ok: true, duplicate: false };

// animate() の呼び出し自体は無視してよいが、hideOverlay が display を戻すのは onfinish
// （実ブラウザではアニメーション終了のイベント）の中だけ。ここでは onfinish を、代入された次の
// ティックで呼ぶ＝フェイクタイマーでも捕まえられるよう setTimeout(...,0) を使う。
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

// 保存の見張り（save-deadline.ts）が自分のエントリを足したり外したりするので、ここは実際に登録
// と解除ができる入れ物にする。数を数えるのには使わない＝置き場所さえあればよい。
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

// #44: ページ内の UI は body の直下ではなく、共有の ShadowRoot（ui-root.ts）の中にある。ホスト
// ページの CSS を入り込ませず、こちらの CSS を漏らさないのがこの境界の役目なので、テストも本物
// と同じく境界の内側を見る。
const uiHost = () => window.document.querySelector('hologram-extension-ui') as any;
const uiRoot = () => uiHost()?.shadowRoot;
const zone = () => (uiRoot()?.getElementById('__hologramDropZone') ?? null) as any;
const ring = () => zone()?.querySelector('.ring') as any;
const label = () => zone()?.querySelector('.label') as any;
// 見た目そのものではなく「どの状態にいるか」を見る (#44)＝色・アイコン・アニメーションの対応は
// components.css の1か所が持つようになり、drag.ts が決めるのは状態だけ。
const state = () => zone()?.dataset.state;
// 要素が在ることそのものが開閉の状態（登場アニメーションとともに載せ、退場アニメーションの後に
// 外す）。
const shown = () => !!zone()?.isConnected;
// ページのドラッグではなく利用者のドラッグ。ゾーンを構えるドラッグも、それを確定するドロップも、
// #323 以降は trusted なものしか通さない（lib-user-event.ts を参照）。`pageEvent` はその印を一切
// 持たない同じイベント＝x.com 上のスクリプトが作れるもので、下の番人自身のテストでしか使わない。
const pageEvent = (type: string) => new window.Event(type, { bubbles: true, cancelable: true });
const dragEvent = (type: string) => asUser(pageEvent(type));
const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'content-scripts', 'resident.js'), 'utf8'));
  await settle(300); // startOverlay/startDrag の非同期の初期化（createI18n を含む）が終わるまで待つ
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
    await settle(1600); // success の滞留時間 1400ms を超える

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

// #205: ドロップの経路でも同じ告知を出す＝保存の出口が3つあるのに1つでしか言わないと、ドラッグ
// しか使わない利用者は更新が要ることを知る機会が無い。
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
    await settle(2900); // 失敗の滞留時間 2600ms を超える

    expect(shown()).toBe(false);
  });
});

// #34: 保存済みの絵をもう一度ドラッグしたときの3択。ドロップ経路の保存対象はまさに「ポインタが
// 運んできた絵」なので、その絵が持つ URL の集合が一致判定の第2の軸になる。
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
    await settle(2300); // 前のシナリオの滞留時間を越えさせ、ゾーンを完全に閉じる
    duplicateAnswer = { ok: true, duplicate: true, captureId: 'cap-old' };
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    zone().dispatchEvent(dragEvent('drop'));
    await settle();
    const before = sent.length;
    buttons()[2].dispatchEvent(dragEvent('click'));
    await settle();
    expect(sent.slice(before).map((m) => m.type)).not.toContain('imageDragged');
    // #519: 「やめる」を選んだことは capture.log に記録される＝無反応と区別がつく。
    expect(sent.at(-1)).toMatchObject({ type: 'logCapture', entry: { stage: 'duplicate', phase: 'skip' } });
    expect(label().textContent).toBe('Not saved');
    duplicateAnswer = { ok: true, duplicate: false };
    await settle(1500);
  });

  // #158: ドラッグ保存もこの同じ器に乗る＝文面と選択肢は capture.ts と揃えておく必要がある
  // （揃えないと、同じ判断を経路によって別の顔で尋ねることになる）。
  test('ゴミ箱に在る投稿は2択の告知（置換を出さない）', async () => {
    await settle(2300); // 前のシナリオの滞留時間を越えさせ、ゾーンを完全に閉じる
    duplicateAnswer = { ok: true, duplicate: false, trashed: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } };
    window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
    zone().dispatchEvent(dragEvent('drop'));
    await settle();

    expect(label().textContent).toMatch(/^This post is in the trash \(deleted .+\)\. You can restore it in Hologram$/);
    expect(state()).toBe('ask');
    expect(buttons().map((b) => b.textContent)).toEqual(['Copy', 'Skip']);
    // ボタンのラベルは同じままで、場面を区別するのは補助テキストだけ＝同じ文言が両方の経路に出る必要がある（capture.ts 側と対になる）。
    expect(buttons()[0].title).toBe('Save a new record, leaving the trashed one alone');

    const before = sent.length;
    buttons()[0].dispatchEvent(dragEvent('click'));
    await settle();
    expect(sent.slice(before).find((m) => m.type === 'imageDragged')).toMatchObject({ replaces: null });

    duplicateAnswer = { ok: true, duplicate: false };
    await settle(1500);
  });
});

// #323: ページ自身が投げた合成イベントでは、この経路は一歩も進まない。ドラッグ保存のゲートは
// 「利用者が絵をつかみ、ゾーンへ落とす」という操作そのものだけであり、isTrusted を見なければ
// ページ側のスクリプトが好きなときに保存を通せてしまう。
describe('#323 ページ由来の合成イベントでは動かない', () => {
  test('合成 dragstart はゾーンを出さない（保存の入口が開かない）', async () => {
    await settle(1600); // 前のシナリオのゾーンが完全に閉じるまで
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
    expect(state()).toBe('idle'); // ゾーンは利用者のドロップをまだ待っている

    window.document.dispatchEvent(dragEvent('dragend'));
    await settle(300);
  });
});

test('ゾーンへ落とさず終わったドラッグ（dragend）は保存せず隠すだけ', async () => {
  const before = sent.length;
  window.document.getElementById('img1')?.dispatchEvent(dragEvent('dragstart'));
  expect(shown()).toBe(true);

  window.document.dispatchEvent(dragEvent('dragend'));
  await settle(300); // フェードの onfinish が発火する余裕を持たせる（スタブは次のティックで呼ぶ）

  expect(shown()).toBe(false);
  expect(sent.length).toBe(before); // 新しいメッセージは送られていない
});
