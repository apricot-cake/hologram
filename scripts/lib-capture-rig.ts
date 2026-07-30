// The click-capture content script (extension/.output/chrome-mv3/capture.js)
// running in jsdom, with a background that this side plays.
//
// Why this exists at all: the two things hardest to produce on a real browser
// are a background that NEVER answers and a clock that can be moved 90 seconds
// forward. Both are what the save path's deadlines (#507) and its diagnostic
// record (#519) are about, and both are trivial here — the rig owns setTimeout,
// so "advance 91 seconds" costs no real time and cannot be flaky.
//
// Shared by scripts/capture-timeout.test.ts (does every wait end?) and
// scripts/save-log.test.ts (does the log say which of them happened?), which
// drive the same script from opposite ends and must not drift apart in how they
// stand it up.
//
// Needs the built extension: extension/.output/chrome-mv3/capture.js.
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { asUser } from './lib-user-event.ts';

const BUNDLE = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'capture.js'), 'utf8');

const HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1" data-rect-top="100" data-rect-size="300">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
    </article>
  </div>
</body></html>`;

const realSetTimeout = setTimeout;
// Drain microtasks and any REAL timer (the ones outside the rig). The manual
// clock only takes over setTimeout, so await chains are advanced here.
export const settle = (): Promise<void> => new Promise((r) => realSetTimeout(r, 0));

export interface Rig {
  window: any;
  advance(ms: number): void;
  sent: any[];
  state(): string | null;
  text(): string;
  // Deliver a background→content message (notify / saveProgress / cropImage),
  // which is how the worker reports anything other than a bare reply.
  push(message: any): void;
  // The capture.log lines this side relayed, in order.
  logged(): any[];
}

// `reply` answers a content→background message. Returning `undefined` means the
// background NEVER ANSWERS: the callback is simply not called, which is the
// state a stalled or torn-down service worker leaves the page in.
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

  // #44: the in-page UI lives inside one shared ShadowRoot (ui-root.ts), and the
  // state rides on the shared component's data-state — idle / active / busy /
  // success / partial / ask / error.
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

// Answer everything the way a working background would, except the save itself:
// the click path reports its outcome on a separate `notify` push, so the reply
// to captureAndSend carries nothing a test needs.
export const REPLY_UNTIL_SAVE = (msg: any) => (msg.type === 'checkDuplicate' ? { ok: true, duplicate: false } : msg.type === 'captureAndSend' ? undefined : { ok: true });

// Get as far as the banner sitting on "saving…" with the request delivered.
// The click is the USER's (asUser): since #323 the capture session ignores every
// other kind, and what these suites are about is what happens after a real one.
export async function clickPost(rig: Rig): Promise<void> {
  await settle();
  const post = rig.window.document.getElementById('p1');
  post.dispatchEvent(asUser(new rig.window.MouseEvent('click', { bubbles: true })));
  for (let i = 0; i < 20; i++) await settle();
}

// Press a key on the document the way the page's own capture listener sees it.
export function pressKey(rig: Rig, key: string): void {
  rig.window.document.dispatchEvent(asUser(new rig.window.KeyboardEvent('keydown', { key, bubbles: true })));
}
