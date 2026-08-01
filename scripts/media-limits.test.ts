// #389 — the overall resource limit and streaming write for a single save. Swaps out
// global.fetch and runs in-process (no network needed). What's under test:
//   - concurrent fetches never exceed MEDIA_CONCURRENCY (even with 12 items, not all open at once)
//   - the body isn't buffered in full — it streams to disk while still being received
//   - once the total byte budget is exceeded, it cuts off and starts no further fetches
//   - Content-Length is only used for early rejection; even absent or under-reported, it stops
//     based on actual received bytes
//   - neither a mid-transfer disconnect nor exceeding the limit leaves behind a .tmp file or a
//     file treated as "complete"
//   - a body reached by following a redirect comes down through the same path
//
// The byte counts are shrunk by injecting createByteBudget(a small value). A test that streams
// the default 512MB in real bytes would just burn disk and time for the same branches under test.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

const MB = 1024 * 1024;
const PNG_CT = { 'content-type': 'image/png' };

const realFetch = global.fetch;

let dir: string;
let downloadMedia: any;
let createByteBudget: any;
let MAX_SAVE_BYTES: number;
let MEDIA_CONCURRENCY: number;
let MAX_MEDIA: number;

// The number of bodies currently being fetched (peak), and a hook called each time a chunk is returned.
let openBodies = 0;
let peakOpenBodies = 0;
let onChunk: ((url: string, index: number) => void) | null = null;

// A body that returns `chunks` chunks of 1 MiB each. onChunk is called right before each chunk,
// so the test side can observe "what's happening while still mid-receive".
function chunkedBody(url: string, chunks: number, opts: { breakAt?: number } = {}) {
  let sent = 0;
  openBodies++;
  peakOpenBodies = Math.max(peakOpenBodies, openBodies);
  return new ReadableStream({
    pull(controller) {
      if (opts.breakAt != null && sent === opts.breakAt) {
        openBodies--;
        controller.error(new Error('connection reset')); // mid-transfer disconnect
        return;
      }
      if (sent >= chunks) {
        openBodies--;
        controller.close();
        return;
      }
      onChunk?.(url, sent);
      sent++;
      controller.enqueue(new Uint8Array(MB));
    },
    cancel() {
      openBodies--;
    },
  });
}

beforeAll(async () => {
  dir = path.join(process.env.HOLOGRAM_CONFIG_DIR as string, 'saves');
  fs.mkdirSync(dir, { recursive: true });

  global.fetch = (async (url: unknown) => {
    const u = String(url);
    // /n-<MiB>.png = returns that size chunked (no content-length)
    const sized = u.match(/\/n-(\d+)\.png$/);
    if (sized) return new Response(chunkedBody(u, Number(sized[1])), { status: 200, headers: PNG_CT });
    // /under-<MiB>.png = declares 1KB while actually sending that size (under-reporting)
    const under = u.match(/\/under-(\d+)\.png$/);
    if (under) return new Response(chunkedBody(u, Number(under[1])), { status: 200, headers: { ...PNG_CT, 'content-length': '1024' } });
    // /cut-<MiB>.png = disconnects after sending that size
    const cut = u.match(/\/cut-(\d+)\.png$/);
    if (cut) return new Response(chunkedBody(u, 99, { breakAt: Number(cut[1]) }), { status: 200, headers: PNG_CT });
    if (u.endsWith('/moved.png')) return new Response('', { status: 302, headers: { location: 'https://cdn.test/n-1.png' } });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;

  ({ downloadMedia, createByteBudget, MAX_SAVE_BYTES, MEDIA_CONCURRENCY, MAX_MEDIA } = await import('../native-host/media-download.cts'));
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  openBodies = 0;
  peakOpenBodies = 0;
  onChunk = null;
});

const entries = (urls: string[]) => urls.map((url) => ({ url, alt: null }));
const listDir = () => fs.readdirSync(dir);
const tmpLeftovers = () => listDir().filter((f) => f.endsWith('.tmp'));

test('合計予算の既定は 512MB・同時取得数は 2', () => {
  expect(MAX_SAVE_BYTES).toBe(512 * MB);
  expect(MEDIA_CONCURRENCY).toBe(2);
});

describe('同時取得数の制限', () => {
  test('点数上限まで渡しても同時に開く本文は MEDIA_CONCURRENCY 件まで', async () => {
    const base = 'conc-1';
    const urls = Array.from({ length: MAX_MEDIA }, (_, i) => `https://cdn.test/${i}/n-2.png`);

    const saved = await downloadMedia(entries(urls), dir, base, createByteBudget(64 * MB));

    expect(saved).toHaveLength(MAX_MEDIA);
    expect(peakOpenBodies).toBe(MEDIA_CONCURRENCY);
  });

  test('MAX_MEDIA を超えた分は取得すらしない', async () => {
    const urls = Array.from({ length: MAX_MEDIA + 3 }, (_, i) => `https://cdn.test/over-${i}/n-1.png`);

    const saved = await downloadMedia(entries(urls), dir, 'conc-2', createByteBudget(64 * MB));

    expect(saved).toHaveLength(MAX_MEDIA);
  });
});

test('本文は全量バッファされず、受信の途中でディスクへ流れている', async () => {
  const base = 'stream-1';
  // By the time the 6th of 8 MiB chunks is received, the not-yet-complete .tmp file must already
  // have the received-so-far portion written = it isn't buffering everything before writing.
  // It disappears after rename, so we capture the size while still receiving.
  const tmpSeenMidFlight: { name: string; size: number }[] = [];
  onChunk = (_url, index) => {
    if (index === 6) tmpSeenMidFlight.push(...tmpLeftovers().map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size })));
  };

  const saved = await downloadMedia(entries(['https://cdn.test/s/n-8.png']), dir, base, createByteBudget(64 * MB));

  expect(saved).toHaveLength(1);
  expect(tmpSeenMidFlight).toHaveLength(1);
  expect(tmpSeenMidFlight[0].size).toBeGreaterThan(0); // the received-so-far portion is already on disk
  expect(tmpSeenMidFlight[0].size).toBeLessThan(8 * MB); // and it's not all of it = still mid-stream
  expect(fs.statSync(path.join(dir, saved[0].file)).size).toBe(8 * MB);
  expect(tmpLeftovers()).toEqual([]); // finalized by rename = the .tmp is gone
});

describe('1回の保存全体の合計バイト予算', () => {
  test('予算を超えた時点で打ち切り、以降の取得を始めない', async () => {
    const base = 'budget-1';
    const urls = Array.from({ length: MAX_MEDIA }, (_, i) => `https://cdn.test/b${i}/n-4.png`);

    // 10MiB = the first two 4MiB items pass, and it runs out partway through the third
    const saved = await downloadMedia(entries(urls), dir, base, createByteBudget(10 * MB));

    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved.length).toBeLessThan(MAX_MEDIA);
    // the cut-off item leaves behind neither a completed file nor a temp file
    expect(tmpLeftovers()).toEqual([]);
    const written = listDir().filter((f) => f.startsWith(`${base}-media-`));
    expect(written).toHaveLength(saved.length);
  });

  test('落ちた分は残高から引かれる＝予算は保存全体で1つ', async () => {
    const budget = createByteBudget(10 * MB);

    await downloadMedia(entries(['https://cdn.test/c1/n-4.png']), dir, 'budget-2', budget);
    expect(budget.remaining()).toBe(6 * MB);

    await downloadMedia(entries(['https://cdn.test/c2/n-4.png']), dir, 'budget-3', budget);
    expect(budget.remaining()).toBe(2 * MB);
    expect(budget.blown).toBe(false);

    // 4MiB doesn't fit in the remaining 2MiB = it's cut off based on actual received bytes
    const saved = await downloadMedia(entries(['https://cdn.test/c3/n-4.png']), dir, 'budget-4', budget);
    expect(saved).toHaveLength(0);
    expect(budget.blown).toBe(true);
    expect(tmpLeftovers()).toEqual([]);
  });

  test('尽きた予算では新しい取得を1件も始めない', async () => {
    const budget = createByteBudget(1 * MB);
    await downloadMedia(entries(['https://cdn.test/d1/n-4.png']), dir, 'budget-5', budget);
    expect(budget.blown).toBe(true);
    const opened = peakOpenBodies;

    const saved = await downloadMedia(entries(['https://cdn.test/d2/n-1.png']), dir, 'budget-6', budget);

    expect(saved).toHaveLength(0);
    expect(peakOpenBodies).toBe(opened); // not a single body was opened
  });
});

describe('Content-Length を信用しない', () => {
  test('申告が無くても実受信バイトで1ファイル上限を強制する', async () => {
    const saved = await downloadMedia(entries(['https://cdn.test/e1/n-26.png']), dir, 'cl-1', createByteBudget(64 * MB));

    expect(saved).toHaveLength(0); // exceeds the 25MB per-file limit
    expect(tmpLeftovers()).toEqual([]);
  });

  test('過少申告（1KB と称して 26MiB）でも実受信バイトで止める', async () => {
    const saved = await downloadMedia(entries(['https://cdn.test/e2/under-26.png']), dir, 'cl-2', createByteBudget(64 * MB));

    expect(saved).toHaveLength(0);
    expect(tmpLeftovers()).toEqual([]);
  });

  test('1ファイル上限の直下（24MiB）が複数あっても、予算内なら全部通る', async () => {
    const base = 'cl-3';
    const saved = await downloadMedia(entries(['https://cdn.test/e3/n-24.png', 'https://cdn.test/e4/n-24.png']), dir, base, createByteBudget(64 * MB));

    expect(saved).toHaveLength(2);
    expect(fs.statSync(path.join(dir, saved[0].file)).size).toBe(24 * MB);
    expect(fs.statSync(path.join(dir, saved[1].file)).size).toBe(24 * MB);
    expect(tmpLeftovers()).toEqual([]);
  });
});

test('途中切断は項目を落とし、一時ファイルを残さない', async () => {
  const base = 'cut-1';
  const saved = await downloadMedia(entries(['https://cdn.test/f1/cut-3.png', 'https://cdn.test/f2/n-1.png']), dir, base, createByteBudget(64 * MB));

  expect(saved).toHaveLength(1); // only the one that got cut off drops out
  expect(saved[0].file).toBe(`${base}-media-1.png`);
  expect(listDir()).not.toContain(`${base}-media-0.png`);
  expect(tmpLeftovers()).toEqual([]);
});

test('リダイレクト先の本文も同じ経路で落ちてくる', async () => {
  const base = 'redir-1';
  const saved = await downloadMedia(entries(['https://cdn.test/moved.png']), dir, base, createByteBudget(64 * MB));

  expect(saved).toHaveLength(1);
  expect(fs.statSync(path.join(dir, saved[0].file)).size).toBe(1 * MB);
  expect(tmpLeftovers()).toEqual([]);
});
