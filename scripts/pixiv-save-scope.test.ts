// Issue #1154: pixiv の保存範囲は操作方法ではなく表示対象で決める。
// 純粋な対象判定に加え、実際に配布する capture/resident バンドルが一覧
// サムネイルを作品単位、作品ページの展開画像を画像単位として送ることを
// jsdom 上で確認する。ネットワークや実アカウントには依存しない。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, test, vi } from 'vitest';
import { pixivSaveTarget } from '../extension/utils/extractor/pixiv.ts';
import { asUser } from './lib-user-event.ts';

const { sleep } = require('./lib-wait.cts') as { sleep(ms: number): Promise<void> };

const RELEASE = path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release');
const CAPTURE = fs.readFileSync(path.join(RELEASE, 'capture.js'), 'utf8');
const RESIDENT = fs.readFileSync(path.join(RELEASE, 'content-scripts', 'resident.js'), 'utf8');
const ART = '99';
const p = (n: number) => `https://i.pximg.net/img-original/img/2026/08/23/${ART}_p${n}.jpg`;

function rect() {
  return { left: 50, top: 100, right: 350, bottom: 400, width: 300, height: 300, x: 50, y: 100 };
}

function installDom(html: string, url = `https://www.pixiv.net/artworks/${ART}`) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const { window } = dom;
  window.Element.prototype.animate = () => ({ cancel() {}, finish() {} }) as any;
  window.Element.prototype.getBoundingClientRect = rect;
  window.Element.prototype.scrollIntoView = () => {};
  window.scrollBy = () => {};
  window.scrollTo = () => {};
  window.requestAnimationFrame = (fn: FrameRequestCallback) => {
    queueMicrotask(() => fn(performance.now()));
    return 1;
  };
  window.cancelAnimationFrame = () => {};
  return window;
}

async function captureMessage(html: string, selector: string, url?: string) {
  const window = installDom(html, url);
  const sent: any[] = [];
  const listeners: any[] = [];
  (window as any).chrome = {
    storage: { local: { get: (_key: unknown, cb: (v: object) => void) => cb({}) } },
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb?: (v: unknown) => void) => {
        sent.push(msg);
        if (msg.type === 'checkDuplicate') cb?.({ ok: true, duplicate: false });
      },
      onMessage: { addListener: (fn: any) => listeners.push(fn), removeListener: () => {} },
    },
  };
  window.eval(CAPTURE);
  await vi.waitFor(() => expect((window as any).__snsPostSaveActive).toBe(true));
  window.document.querySelector(selector)?.dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
  await vi.waitFor(() => expect(sent.some((m) => m.type === 'captureAndSend')).toBe(true));
  return sent.find((m) => m.type === 'captureAndSend');
}

interface OverlayRun {
  window: Window & typeof globalThis;
  sent: any[];
  controls(): HTMLElement[];
  banners(): HTMLElement[];
  hover(): void;
}

async function overlay(html: string, saved: any, url = `https://www.pixiv.net/artworks/${ART}`, saveReply: any = {}): Promise<OverlayRun> {
  const window = installDom(html, url);
  const sent: any[] = [];
  let io: ((entries: any[]) => void) | null = null;
  (window as any).IntersectionObserver = class {
    constructor(cb: any) {
      io = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (window as any).MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  (window as any).chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb?: (v: unknown) => void) => {
        sent.push(msg);
        if (msg.type === 'checkSaved') cb?.({ ok: true, results: Object.fromEntries(msg.urls.map((u: string) => [u, saved])) });
        else if (msg.type === 'savePost' || msg.type === 'imageDragged') cb?.({ ok: true, metaOk: true, metaReason: null, grouped: 0, media: msg.type === 'savePost' ? [p(0), p(1), p(2)] : [p(0)], imageCount: 3, mediaMissing: 0, ...saveReply });
      },
      onMessage: { addListener: () => {}, removeListener: () => {} },
    },
    storage: {
      local: { get: (_keys: unknown, cb: (v: object) => void) => cb({ savedBadgeMode: 'always', hoverSaveButton: true }), set: () => {} },
      onChanged: { addListener: () => {} },
    },
  };
  window.eval(RESIDENT);
  const unit = window.document.getElementById('unit') as Element;
  const controls = () => Array.from(window.document.querySelectorAll('[data-hologram-overlay]')) as HTMLElement[];
  await vi.waitFor(() => expect(io).not.toBeNull());
  (io as ((entries: any[]) => void) | null)?.([{ target: unit, isIntersecting: true }]);
  // biome-ignore lint/plugin: resident が交差通知後に置く300msの安定化期間そのものを待つ
  await sleep(350);
  const banners = () => Array.from((window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot?.querySelectorAll('[data-hologram-save-banner]') || []) as HTMLElement[];
  const hover = () => {
    const event: any = new window.Event('pointermove', { bubbles: true });
    event.clientX = 200;
    event.clientY = 250;
    (window.document.getElementById('img') as Element).dispatchEvent(event);
  };
  return { window: window as any, sent, controls, banners, hover };
}

const face = (control: HTMLElement | undefined) => control?.getAttribute('data-hologram-face');
const disc = (control: HTMLElement | undefined): HTMLElement | null => ((control as any)?.shadowRoot?.firstElementChild as HTMLElement | null) || control || null;

describe('共有する対象判定', () => {
  test('一覧サムネイルは作品単位、展開画像は画像単位', () => {
    const window = installDom(`<a id="thumb" href="/artworks/${ART}"><img id="thumb-img" src="${p(0)}"></a><a id="page" href="${p(1)}"><img id="page-img" src="${p(1)}"></a>`);
    expect(pixivSaveTarget(window.document.getElementById('thumb-img') as Element)).toEqual({ scope: 'post', pageIndex: null });
    expect(pixivSaveTarget(window.document.getElementById('page-img') as Element)).toEqual({ scope: 'media', pageIndex: 2 });
  });
});

describe('Alt+S', () => {
  test('一覧サムネイルは作品全体を要求する', async () => {
    const msg = await captureMessage(`<a href="/artworks/${ART}"><img id="target" src="${p(0)}"></a>`, '#target', 'https://www.pixiv.net/ranking.php');
    expect(msg).toMatchObject({ platform: 'pixiv', postUrl: `https://www.pixiv.net/artworks/${ART}`, saveTarget: { scope: 'post', pageIndex: null }, imageUrls: [] });
  });

  test('展開画像はその画像だけを要求し、位置を運ぶ', async () => {
    const msg = await captureMessage(`<a href="${p(1)}"><img id="target" src="${p(1)}"></a>`, '#target');
    expect(msg).toMatchObject({ platform: 'pixiv', postUrl: `https://www.pixiv.net/artworks/${ART}`, saveTarget: { scope: 'media', pageIndex: 2 } });
    expect(msg.imageUrls).toContain(p(1));
  });
});

describe('ホバー保存と保存済み表示', () => {
  test('一覧の一部保存を区別し、ホバーすると全ページ保存を要求する', async () => {
    const run = await overlay(`<a id="unit" href="/artworks/${ART}"><img id="img" src="${p(0)}"></a>`, { id: 'partial', media: [p(1)], total: 3 }, 'https://www.pixiv.net/ranking.php');
    expect(face(run.controls()[0])).toBe('partial');
    expect(disc(run.controls()[0])?.getAttribute('aria-label')).toBe('Partially saved in Hologram (3 images total)');
    run.hover();
    await vi.waitFor(() => expect(face(run.controls()[0])).toBe('save'));
    expect(disc(run.controls()[0])?.getAttribute('aria-label')).toBe('Save artwork (all 3 images)');
    disc(run.controls()[0])?.dispatchEvent(asUser(new run.window.MouseEvent('click', { bubbles: true })));
    expect(run.sent.at(-1)).toMatchObject({ type: 'savePost', platform: 'pixiv', postUrl: `https://www.pixiv.net/artworks/${ART}` });
  });

  test('一覧の全ページ保存済みを一部保存と区別する', async () => {
    const run = await overlay(`<a id="unit" href="/artworks/${ART}"><img id="img" src="${p(0)}"></a>`, { id: 'full', media: [p(0), p(1), p(2)], total: 3 }, 'https://www.pixiv.net/ranking.php');
    expect(face(run.controls()[0])).toBe('mark');
    expect(disc(run.controls()[0])?.getAttribute('aria-label')).toBe('All 3 images saved in Hologram');
  });

  test('一覧保存が12枚で止まった場合は残り枚数を通知する', async () => {
    const run = await overlay(`<a id="unit" href="/artworks/${ART}"><img id="img" src="${p(0)}"></a>`, null, 'https://www.pixiv.net/ranking.php', { imageCount: 15, mediaMissing: 3 });
    run.hover();
    await vi.waitFor(() => expect(face(run.controls()[0])).toBe('save'));
    disc(run.controls()[0])?.dispatchEvent(asUser(new run.window.MouseEvent('click', { bubbles: true })));
    await vi.waitFor(() => expect(run.banners().at(-1)?.textContent).toBe('Saved, but 3 original image(s) remain unsaved. Save them individually from the artwork page.'));
    expect(run.banners().at(-1)?.getAttribute('data-state')).toBe('partial');
  });

  test('展開画像は画像ごとの保存状態と位置を読み上げる', async () => {
    const run = await overlay(`<a id="unit" href="${p(1)}"><img id="img" src="${p(1)}"></a>`, { id: 'one', media: [p(1)], total: 3 });
    expect(face(run.controls()[0])).toBe('mark');
    expect(disc(run.controls()[0])?.getAttribute('aria-label')).toBe('This image is saved in Hologram (2/3)');
  });

  test('未保存でも作品ページの画像群から k/N を読み上げる', async () => {
    const run = await overlay(`<a id="unit" href="${p(1)}"><img id="img" src="${p(1)}"></a><a href="${p(2)}"><img src="${p(2)}"></a>`, null);
    run.hover();
    await vi.waitFor(() => expect(face(run.controls()[0])).toBe('save'));
    expect(disc(run.controls()[0])?.getAttribute('aria-label')).toBe('Save this image (2/3)');
  });

  test('未保存の展開画像はその1枚だけを要求する', async () => {
    const run = await overlay(`<a id="unit" href="${p(0)}"><img id="img" src="${p(0)}"></a>`, { id: 'other', media: [p(1)], total: 3 });
    run.hover();
    await vi.waitFor(() => expect(face(run.controls()[0])).toBe('save'));
    expect(disc(run.controls()[0])?.getAttribute('aria-label')).toBe('Save this image (1/3)');
    disc(run.controls()[0])?.dispatchEvent(asUser(new run.window.MouseEvent('click', { bubbles: true })));
    expect(run.sent.at(-1)).toMatchObject({ type: 'imageDragged', platform: 'pixiv', postUrl: `https://www.pixiv.net/artworks/${ART}` });
    expect(run.sent.at(-1).imageUrls).toContain(p(0));
  });
});
