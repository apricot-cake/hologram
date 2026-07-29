// 保存が「保存中...」のまま永久に終わらない不具合の再現と、その上限（#507）。
//
// ネイティブホストへの 30 秒はもともと在った。それでも画面が固まったのは、
// **コンテンツスクリプトが結果を待つ脚**に上限が無かったから＝バックグラウンドが
// 黙った瞬間（MV3 のサービスワーカー停止・メッセージの取りこぼし・その先の
// どこかの無期限待ち）、バナーを busy から動かす者が誰も居なくなる。
//
// ここはビルド済みの capture.js を jsdom で走らせ、バックグラウンドを
// **一切答えない相手**として立てる＝実機を要さずに「応答が返らない」状況を
// 決定的に作れる唯一の場所。時間はテストが持つ手動クロックで進める。
//
// 前提: extension のビルド成果物（extension/.output/chrome-mv3/capture.js）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

const realSetTimeout = setTimeout;
// マイクロタスクと（テストの外に居る）本物のタイマを消化する。手動クロックは
// setTimeout だけを乗っ取るので、await の連鎖はこちらで進める。
const settle = () => new Promise((r) => realSetTimeout(r, 0));

interface Rig {
  window: any;
  advance(ms: number): void;
  sent: any[];
  state(): string | null;
  text(): string;
}

// 手動クロック付きの jsdom。sendMessage は `reply` が返した値だけを返し、
// undefined を返した型は「答えない」＝コールバックを呼ばずに握り潰す。
function makeRig(reply: (msg: any) => any): Rig {
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
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb?: (r: any) => void) => {
        sent.push(msg);
        const answer = reply(msg);
        if (answer !== undefined && cb) Promise.resolve().then(() => cb(answer));
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: { local: { get: (_k: unknown, cb: (v: any) => void) => cb({}), set: () => {} } },
  } as any;

  window.eval(BUNDLE);

  const banner = () => window.document.querySelector('[data-hologram-capture-banner]');
  return {
    window,
    advance,
    sent,
    state: () => banner()?.getAttribute('data-hologram-capture-state') ?? null,
    text: () => banner()?.textContent ?? '',
  };
}

// バックグラウンドまで届いて busy に入るところまで進める。
async function clickPost(rig: Rig): Promise<void> {
  await settle();
  const post = rig.window.document.getElementById('p1');
  post.dispatchEvent(new rig.window.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 20; i++) await settle();
}

test('保存要求に誰も答えなければ、上限で必ず終わる（永久に「保存中...」にしない）', async () => {
  // captureAndSend にだけ答えない＝バックグラウンドが黙った状態そのもの。
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? { ok: true, duplicate: false } : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);

  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');

  // 正常な保存を巻き添えにしないこと＝バックグラウンド側の予算（crop 10s ＋
  // メタデータ 20s ＋ ネイティブホスト 30s）を跨いでもまだ待っている。
  rig.advance(60_000);
  await settle();
  expect(rig.state()).toBe('busy');

  rig.advance(31_000); // 90 秒の見張りを越える
  await settle();
  expect(rig.state()).toBe('fail');
  // バナーはブラウザのロケールに従う＝jsdom は en。日本語版の同じ文言は
  // i18n-parity.test.ts が両言語に在ることを見る。ここは「次の一手が書いてある」
  // ことだけを確かめる＝「失敗しました」で終わらせないのが #507 の要求。
  expect(rig.text()).toContain('Try again');
});

test('タイムアウトは capture.log へ残す', async () => {
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? { ok: true, duplicate: false } : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);
  rig.advance(91_000);
  await settle();

  const logged = rig.sent.filter((m) => m.type === 'logCapture').map((m) => m.entry);
  const timeout = logged.find((e) => e.phase === 'fail' && e.stage === 'result');
  expect(timeout, `logCapture entries: ${JSON.stringify(logged)}`).toBeTruthy();
  expect(String(timeout.error)).toMatch(/timed out/i);
});

test('サービスワーカーが落ちてチャネルが閉じたら、見張りを待たずに終わる', async () => {
  // 応答なしでコールバックだけ呼ばれる＝Chrome が「返事なしでポートが閉じた」と
  // 告げる形。MV3 でワーカーが保存の途中で停止したときに実際に起きる。
  const rig = makeRig((msg) => {
    if (msg.type === 'checkDuplicate') return { ok: true, duplicate: false };
    if (msg.type === 'captureAndSend') {
      rig.window.chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
      return null;
    }
    return { ok: true };
  });
  await clickPost(rig);
  await settle();
  expect(rig.state()).toBe('fail');
});

test('重複の問い合わせに誰も答えなければ、上限で普通に保存へ進む（fail open）', async () => {
  // #34 が保存の前に足した往復。ここで黙られると、クリックの受け口はもう外され
  // ているのに画面は「クリックしてください」のまま＝何を押しても動かない。
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? undefined : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);

  rig.advance(13_000);
  for (let i = 0; i < 20; i++) await settle();
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');
});
