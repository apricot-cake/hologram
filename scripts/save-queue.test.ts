// Tests for extension/utils/save-queue.ts (#203): the retry queue that
// stashes a 'save'/'saveDragged' request whose bridge send never reached the
// host, and resends it later. background.ts's own wiring (bridgeSend's
// `.unreachable` tagging, the four resend triggers) is covered by
// background-wiring.test.ts; this file drives stashFailedSave/sweepSaveQueue/
// saveQueueStats directly against a hand-rolled chrome.storage.local, the
// same stub policy background-wiring.test.ts documents (no library implements
// a working chrome.storage double either).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { NATIVE_HOST } from '../extension/utils/native-host';
import { SAVE_QUEUE_BUDGET_BYTES, SAVE_QUEUE_MAX_ENTRIES, SAVE_QUEUE_MAX_TRIES, SAVE_QUEUE_PREFIX, saveQueueStats, sweepSaveQueue, stashFailedSave } from '../extension/utils/save-queue';
import type { SaveDraggedRequest, SaveRequest, SavedEntry } from '../native-host/protocol.mts';

function setupChromeStorage() {
  const store = new Map<string, unknown>();
  const chromeStub: any = {
    runtime: { lastError: undefined as { message: string } | undefined },
    storage: {
      local: {
        get: (keys: any, cb: (r: any) => void) => {
          let result: Record<string, unknown>;
          if (keys == null) result = Object.fromEntries(store);
          else if (typeof keys === 'string') result = store.has(keys) ? { [keys]: store.get(keys) } : {};
          else result = Object.fromEntries((keys as string[]).filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
          cb(result);
        },
        set: (items: Record<string, unknown>, cb?: () => void) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
          cb?.();
        },
        remove: (keys: string | string[], cb?: () => void) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
          cb?.();
        },
      },
    },
  };
  (globalThis as any).chrome = chromeStub;
  return store;
}

function noopLog() {
  /* the logger's own content isn't the point of these tests */
}

function draggedReq(overrides: Partial<SaveDraggedRequest> = {}): SaveDraggedRequest {
  return {
    type: 'saveDragged',
    captureId: '1700000000000-aaaa',
    saveId: 'save-1',
    imageUrl: 'https://example.com/a.jpg',
    imageReferer: null,
    metadata: { url: 'https://x.com/alice/status/1' } as any,
    metaOk: true,
    metaReason: null,
    ...overrides,
  };
}

function saveReq(overrides: Partial<SaveRequest> = {}): SaveRequest {
  return {
    type: 'save',
    captureId: '1700000000000-bbbb',
    saveId: 'save-2',
    image: '',
    metadata: { url: 'https://x.com/alice/status/2' } as any,
    metaOk: true,
    metaReason: null,
    ...overrides,
  };
}

function queueKeys(store: Map<string, unknown>): string[] {
  return [...store.keys()].filter((k) => k.startsWith(SAVE_QUEUE_PREFIX)).sort();
}

beforeEach(() => {
  setupChromeStorage();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stashFailedSave — 退避', () => {
  test('小さい payload はそのままキューへ1件入る', async () => {
    const store = setupChromeStorage();
    const ok = await stashFailedSave(draggedReq(), noopLog);
    expect(ok).toBe(true);
    const keys = queueKeys(store);
    expect(keys).toHaveLength(1);
    const entry: any = store.get(keys[0]);
    expect(entry).toMatchObject({ v: 1, host: NATIVE_HOST, type: 'saveDragged', tries: 0 });
    expect(entry.payload).toEqual(draggedReq());
    expect(entry.rawPayloadsDropped).toBeUndefined();
  });

  test('rawPayloads を含めると収まらない時は落として詰める（rawPayloadsDropped）', async () => {
    const store = setupChromeStorage();
    const bigRaw = [{ url: 'https://api.example/1', body: 'x'.repeat(6 * 1024 * 1024), status: 200, contentType: 'application/json' }];
    const req = saveReq({ metadata: { url: 'https://x.com/alice/status/3', rawPayloads: bigRaw } as any });
    const ok = await stashFailedSave(req, noopLog);
    expect(ok).toBe(true);
    const keys = queueKeys(store);
    const entry: any = store.get(keys[0]);
    expect(entry.rawPayloadsDropped).toBe(true);
    expect(entry.payload.metadata.rawPayloads).toEqual([]);
  });

  test('rawPayloads を落としても収まらない1件は退避せず false', async () => {
    const store = setupChromeStorage();
    const req = saveReq({ image: 'A'.repeat(SAVE_QUEUE_BUDGET_BYTES + 1024) });
    const ok = await stashFailedSave(req, noopLog);
    expect(ok).toBe(false);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('バイト予算を超える新規分は古い順に破棄してから入る', async () => {
    const store = setupChromeStorage();
    // Two entries that alone fit, but together would exceed the budget once a
    // third of the same size joins them.
    const chunk = 'A'.repeat(Math.floor(SAVE_QUEUE_BUDGET_BYTES / 2.5));
    await stashFailedSave(saveReq({ image: chunk, captureId: '1700000000001-0001' }), noopLog);
    await new Promise((r) => setTimeout(r, 2)); // ts distinct enough to sort
    await stashFailedSave(saveReq({ image: chunk, captureId: '1700000000002-0002' }), noopLog);
    expect(queueKeys(store)).toHaveLength(2);
    const oldestKeyBefore = queueKeys(store)[0];

    await stashFailedSave(saveReq({ image: chunk, captureId: '1700000000003-0003' }), noopLog);
    const keysAfter = queueKeys(store);
    // The oldest of the first two was evicted to make room for the third.
    expect(keysAfter).not.toContain(oldestKeyBefore);
    expect(keysAfter).toHaveLength(2);
    const totalBytes = keysAfter.reduce((sum, k) => sum + new TextEncoder().encode(JSON.stringify(store.get(k))).length, 0);
    expect(totalBytes).toBeLessThanOrEqual(SAVE_QUEUE_BUDGET_BYTES);
  });

  test(`件数が ${SAVE_QUEUE_MAX_ENTRIES} を超えたら小さい payload でも古い順に落ちる`, async () => {
    const store = setupChromeStorage();
    for (let i = 0; i < SAVE_QUEUE_MAX_ENTRIES; i++) {
      await stashFailedSave(draggedReq({ captureId: `170000000${String(i).padStart(4, '0')}-0000` }), noopLog);
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(queueKeys(store)).toHaveLength(SAVE_QUEUE_MAX_ENTRIES);
    const oldestKeyBefore = queueKeys(store)[0];

    await stashFailedSave(draggedReq({ captureId: '1700000009999-0000' }), noopLog);
    const keysAfter = queueKeys(store);
    expect(keysAfter).toHaveLength(SAVE_QUEUE_MAX_ENTRIES);
    expect(keysAfter).not.toContain(oldestKeyBefore);
  });
});

describe('sweepSaveQueue — 直列再送', () => {
  test('成功したエントリはキューから消える', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq(), noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const query = vi.fn().mockResolvedValue(null);
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('現在の NATIVE_HOST と異なる host のエントリは触らない（#732）', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq(), noopLog);
    const [key] = queueKeys(store);
    const entry: any = store.get(key);
    store.set(key, { ...entry, host: 'com.hologram.host.dev' });
    const send = vi.fn().mockResolvedValue({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue(null), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
  });

  test('gaveUp 済みのエントリは対象外', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq(), noopLog);
    const [key] = queueKeys(store);
    const entry: any = store.get(key);
    store.set(key, { ...entry, gaveUp: true, tries: SAVE_QUEUE_MAX_TRIES });
    const send = vi.fn().mockResolvedValue({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue(null), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1); // left in place, not deleted
  });

  test('同一 captureId が既に着地済みなら送らず捨てる（#34 の owners/id 一致）', async () => {
    const store = setupChromeStorage();
    const req = draggedReq({ captureId: '1700000000000-aaaa', metadata: { url: 'https://x.com/alice/status/9' } as any });
    await stashFailedSave(req, noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const landed: SavedEntry = { id: '1700000000000-aaaa', media: [] };
    const query = vi.fn().mockResolvedValue(landed);
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('同じ URL でも別 captureId が保存済みなら、これは別の正当な保存として送る', async () => {
    const store = setupChromeStorage();
    const req = draggedReq({ captureId: '1700000000000-aaaa', metadata: { url: 'https://x.com/alice/status/9' } as any });
    await stashFailedSave(req, noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const other: SavedEntry = { id: '1700000000000-ffff', media: [], owners: ['1700000000000-ffff'] };
    const query = vi.fn().mockResolvedValue(other);
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('query が失敗したら fail-open で送る', async () => {
    setupChromeStorage();
    await stashFailedSave(draggedReq(), noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const query = vi.fn().mockRejectedValue(new Error('host unreachable'));
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('unreachable な失敗は tries を増やして中断し、以降のエントリを試さない', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq({ captureId: '1700000000001-0001' }), noopLog);
    await new Promise((r) => setTimeout(r, 1));
    await stashFailedSave(draggedReq({ captureId: '1700000000002-0002' }), noopLog);
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Native host timed out'), { unreachable: true }));
    const query = vi.fn().mockResolvedValue(null);
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1); // stopped after the first failure
    const remaining = queueKeys(store).map((k) => store.get(k) as any);
    expect(remaining).toHaveLength(2); // neither entry was dropped
    expect(remaining.some((e) => e.tries === 1)).toBe(true);
  });

  test(`tries が ${SAVE_QUEUE_MAX_TRIES} に達したら gaveUp を立てて残す`, async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq(), noopLog);
    const [key] = queueKeys(store);
    store.set(key, { ...(store.get(key) as any), tries: SAVE_QUEUE_MAX_TRIES - 1 });
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Native host disconnected'), { unreachable: true }));
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue(null), log: noopLog });
    const entry: any = store.get(key);
    expect(entry.tries).toBe(SAVE_QUEUE_MAX_TRIES);
    expect(entry.gaveUp).toBe(true);
  });

  test('ホストが答えた上での拒否（unreachable でない）はその1件だけ捨てて次へ進む', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq({ captureId: '1700000000001-0001' }), noopLog);
    await new Promise((r) => setTimeout(r, 1));
    await stashFailedSave(draggedReq({ captureId: '1700000000002-0002' }), noopLog);
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('post unavailable: deleted')) // no .unreachable — host answered
      .mockResolvedValueOnce({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue(null), log: noopLog });
    expect(send).toHaveBeenCalledTimes(2); // did NOT stop after the answered refusal
    expect(queueKeys(store)).toHaveLength(0); // both entries gone (one refused, one sent)
  });

  test('二重起動しても同時に1回しか走らない（single-flight）', async () => {
    setupChromeStorage();
    await stashFailedSave(draggedReq(), noopLog);
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => (resolveSend = resolve)));
    const query = vi.fn().mockResolvedValue(null);
    const first = sweepSaveQueue({ send, query, log: noopLog });
    const second = sweepSaveQueue({ send, query, log: noopLog }); // arrives mid-sweep
    await new Promise((r) => setTimeout(r, 10)); // let the first sweep's query()/send() microtasks run
    resolveSend({ ok: true });
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1); // the second call found `sweeping` already true and no-opped
  });
});

describe('saveQueueStats — 診断ページの在庫表示', () => {
  test('件数・合計バイト・諦めた件数を数える', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(draggedReq({ captureId: '1700000000001-0001' }), noopLog);
    await new Promise((r) => setTimeout(r, 1));
    await stashFailedSave(draggedReq({ captureId: '1700000000002-0002' }), noopLog);
    const keys = queueKeys(store);
    store.set(keys[0], { ...(store.get(keys[0]) as any), gaveUp: true });

    const stats = await saveQueueStats();
    expect(stats.count).toBe(2);
    expect(stats.gaveUp).toBe(1);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  test('何も無ければ全部ゼロ', async () => {
    setupChromeStorage();
    expect(await saveQueueStats()).toEqual({ count: 0, bytes: 0, gaveUp: 0 });
  });
});
