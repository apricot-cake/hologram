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
import { describe, expect, test, vi } from 'vitest';

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

  // #44: ページ内 UI は共有の ShadowRoot の中（ui-root.ts）。状態は共通部品の
  // data-state に載る＝語彙は idle/active/busy/success/partial/ask/error。
  const uiRoot = () => (window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot;
  const banner = () => uiRoot()?.querySelector('[data-hologram-capture-banner]');
  return {
    window,
    advance,
    sent,
    state: () => banner()?.getAttribute('data-state') ?? null,
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
  expect(rig.state()).toBe('error');
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
  expect(rig.state()).toBe('error');
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

// --- 打ち切りが記録に残ること（4つの面すべて） -------------------------------
//
// 上限を最初に入れたとき、`capture.log` へ1行書いていたのは Alt+S の面だけだった。
// ユーザーが実際に固まりを報告したのは**ホバー保存ボタン**の面で、そちらは常駐
// スクリプトなので activate の行すら出ない＝打ち切っても記録が完全に無音になる。
// 「終わりを宣言する」と「後から追える」は別の話で、後者が1面だけ欠けていた。
//
// 面ごとに jsdom のハーネスを4つ立てる代わりに、壊れた不変条件そのものを見る＝
// **上限を張る場所は、必ず打ち切りを記録する**。増えた面が記録を忘れる形の退行は
// これで捕まる（記録の中身は下の単体テストが見る）。
describe('打ち切りは必ず記録される（#507 の穴）', () => {
  const UTILS = path.join(import.meta.dirname, '..', 'extension', 'utils');
  const SURFACES = ['capture.ts', 'overlay.ts', 'drag.ts', 'bulk-capture.ts'];

  // コメントを落としてから見る。この不変条件を最初に書いたとき、呼び出しを1行
  // コメントアウトしただけのファイルが素通りした＝「書いてある」と「呼んでいる」は
  // 別物で、後者だけが記録を出す。
  const code = (file: string) =>
    fs
      .readFileSync(path.join(UTILS, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test.each(SURFACES)('%s は上限を張り、かつ打ち切りを記録する', (file) => {
    const source = code(file);
    expect(source, `${file} が保存の上限を張らなくなった＝この不変条件の対象から外れたなら SURFACES を直す`).toContain('SAVE_WATCHDOG_MS');
    expect(source, `${file} が capture-log を読み込んでいない`).toMatch(/from '\.\/capture-log\.ts'/);
    expect(source, `${file} は上限を張るのに reportSaveTimeout() を呼んでいない＝打ち切りが capture.log に残らない`).toMatch(/reportSaveTimeout\(/);
  });

  test('上限を張るファイルを数え漏らしていない', () => {
    const armed = fs
      .readdirSync(UTILS)
      .filter((f) => f.endsWith('.ts') && f !== 'deadline.ts')
      .filter((f) => code(f).includes('SAVE_WATCHDOG_MS'));
    expect(armed.sort()).toEqual([...SURFACES].sort());
  });
});

describe('reportSaveTimeout が出す行', () => {
  test('stage=result / phase=fail と、どの面かを載せる', async () => {
    const sent: any[] = [];
    vi.stubGlobal('chrome', { runtime: { sendMessage: (m: any) => sent.push(m) } });
    const { reportSaveTimeout } = await import('../extension/utils/capture-log.ts');
    reportSaveTimeout('hover-save', 'x', 'https://x.com/alice/status/111', 'save timed out — no result');

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('logCapture');
    expect(sent[0].entry).toMatchObject({
      stage: 'result',
      phase: 'fail',
      via: 'hover-save',
      platform: 'x',
      url: 'https://x.com/alice/status/111',
    });
    // 生の診断文がそのまま入る＝ユーザーへ見せる文言とは別物（ログは開発者が読む）
    expect(String(sent[0].entry.error)).toMatch(/timed out/i);
    vi.unstubAllGlobals();
  });

  test('バックグラウンドが居なくても投げない（診断は保存を邪魔しない）', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    });
    const { reportSaveTimeout } = await import('../extension/utils/capture-log.ts');
    expect(() => reportSaveTimeout('drop-zone', 'x', null, 'boom')).not.toThrow();
    vi.unstubAllGlobals();
  });
});
