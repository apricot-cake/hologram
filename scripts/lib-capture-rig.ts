// クリックcaptureのcontent script（extension/.output/chrome-mv3/capture.js）を
// jsdom内で動かし、backgroundはこちら側が演じる。
//
// なぜこれがそもそも存在するか: 実際のブラウザで作るのが最も難しい2つは、
// 決して応答しないbackgroundと、90秒先へ動かせる時計。どちらも保存経路の
// 期限（#507）とその診断記録（#519）が扱う対象で、ここでは両方が些細になる＝
// このリグがsetTimeoutを所有するので、「91秒進める」は実時間を一切消費せず、
// 不安定になりようがない。
//
// scripts/capture-timeout.test.ts（全ての待機は終わるか？）とscripts/save-log.test.ts
// （ログはそのどれが起きたかを言うか？）が共有する。この2つは同じスクリプトを
// 反対側から動かすので、立ち上げ方がずれてはいけない。
//
// ビルド済みの拡張機能が要る: extension/.output/chrome-mv3/capture.js。
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { asUser } from './lib-user-event.ts';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

const realSetTimeout = setTimeout;
// マイクロタスクと実際のタイマー（リグの外にあるもの）を全て捌く。手動の
// 時計はsetTimeoutだけを乗っ取るので、awaitの連鎖はここで進む。
export const settle = (): Promise<void> => new Promise((r) => realSetTimeout(r, 0));

export interface Rig {
  window: any;
  advance(ms: number): void;
  sent: any[];
  state(): string | null;
  text(): string;
  // background→contentのメッセージ（notify / saveProgress / cropImage）を届ける。
  // これは、workerが素の応答以外の何かを報告する方法。
  push(message: any): void;
  // このsideが中継したcapture.logの行。順序どおりに。
  logged(): any[];
}

// `reply`はcontent→backgroundのメッセージに答える。`undefined`を返すことは、
// backgroundが「決して答えない」ことを意味する: コールバックは単に呼ばれない。
// これは止まった、あるいは破棄されたservice workerがページを残す状態。
export function makeRig(reply: (msg: any) => any): Rig {
  const dom = new JSDOM(HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
  const { window } = dom;

  let now = 0;
  let seq = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  window.setTimeout = (fn: () => void, ms = 0) => {
    const id = seq++;
    timers.set(id, { fn, at: now + ms });
    return id;
  };
  window.clearTimeout = (id: number) => {
    timers.delete(id);
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at > now) continue;
      timers.delete(id);
      timer.fn();
    }
  };

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
  window.requestAnimationFrame = (fn: () => void) => {
    Promise.resolve().then(fn);
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  window.scrollTo = () => {};
  window.scrollBy = () => {};

  const sent: any[] = [];
  const listeners: Array<(msg: any, sender: any, sendResponse: (r?: any) => void) => unknown> = [];
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb?: (r: any) => void) => {
        sent.push(msg);
        const answer = reply(msg);
        if (answer !== undefined && cb) Promise.resolve().then(() => cb(answer));
      },
      onMessage: {
        addListener: (fn: any) => listeners.push(fn),
        removeListener: (fn: any) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
    storage: { local: { get: (_k: unknown, cb: (v: any) => void) => cb({}), set: () => {} } },
  } as any;

  window.eval(BUNDLE);

  // #44: ページ内UIは1つの共有ShadowRoot（ui-root.ts）に住み、状態は共有
  // コンポーネントのdata-stateに乗る＝idle / active / busy / success / partial /
  // ask / error。
  const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
  const banner = () => uiRoot()?.querySelector('[data-hologram-capture-banner]');
  return {
    window,
    advance,
    sent,
    state: () => banner()?.getAttribute('data-state') ?? null,
    text: () => banner()?.textContent ?? '',
    push: (message: any) => {
      for (const fn of [...listeners]) fn(message, {}, () => {});
    },
    logged: () => sent.filter((m) => m.type === 'logCapture').map((m) => m.entry),
  };
}

// 保存そのものを除いて、正常なbackgroundと同じように全てに答える: クリック
// 経路は自分の結果を別の`notify`プッシュで報告するので、captureAndSendへの
// 返信はテストが必要とする何も運ばない。
export const REPLY_UNTIL_SAVE = (msg: any) => (msg.type === 'checkDuplicate' ? { ok: true, duplicate: false } : msg.type === 'captureAndSend' ? undefined : { ok: true });

// バナーが「保存中…」に落ち着き、リクエストが届くところまで進める。クリックは
// ユーザーのもの（asUser）: #323以降、captureセッションはそれ以外の種類を
// 全て無視するので、これらのスイートが扱うのは本物のクリックの後に起きること。
export async function clickPost(rig: Rig): Promise<void> {
  await settle();
  const post = rig.window.document.getElementById('p1');
  post.dispatchEvent(asUser(new rig.window.MouseEvent('click', { bubbles: true })));
  for (let i = 0; i < 20; i++) await settle();
}

// ページ自身のcaptureリスナーが見るのと同じやり方で、documentにキーを押す。
export function pressKey(rig: Rig, key: string): void {
  rig.window.document.dispatchEvent(asUser(new rig.window.KeyboardEvent('keydown', { key, bubbles: true })));
}
