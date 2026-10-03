// extension/utils/save-queue.ts (#203) のテスト。ブリッジへの送信がホストへ届かなかった
// 'saveMedia' の要求を退避し、後で送り直す再試行キュー。background.ts 自身の配線
//（bridgeSend の `delivery` の付与、4つの再送の引き金）は background-wiring.test.ts が
// 見ている。このファイルは手製の chrome.storage.local を相手に stashFailedSave/
// sweepSaveQueue/saveQueueStats を直に動かす。スタブの方針は background-wiring.test.ts が
// 書いているものと同じ（動く chrome.storage の代役を実装したライブラリも無い）。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { RELEASE_NATIVE_HOST } from './native-host';
import { SAVE_QUEUE_BUDGET_BYTES, SAVE_QUEUE_MAX_ENTRIES, SAVE_QUEUE_MAX_TRIES, SAVE_QUEUE_PREFIX, saveQueueStats, sweepSaveQueue, stashFailedSave } from './save-queue';
import type { SaveMediaRequest, SavedEntry } from '../../native-host/protocol.mts';

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
  /* ログの中身自体は、このテストの主題ではない */
}

function mediaReq(overrides: Partial<SaveMediaRequest> = {}): SaveMediaRequest {
  return {
    type: 'saveMedia',
    captureId: '1700000000000-aaaa',
    saveId: 'save-1',
    mediaUrl: 'https://example.com/a.jpg',
    mediaReferer: null,
    metadata: { url: 'https://x.com/alice/status/1' } as any,
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
  test('検証先への再試行は通常先の掃き出しで送られない', async () => {
    const host = 'com.hologram.host.verify.0123456789ab';
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog, host);
    const send = vi.fn(async () => ({}));
    const deps = { send, query: async () => ({ saved: null, receipt: null, receiptCapable: true }), log: noopLog };
    await sweepSaveQueue(deps);
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
    await sweepSaveQueue(deps, host);
    expect(send).toHaveBeenCalledWith(mediaReq());
    expect(queueKeys(store)).toHaveLength(0);
  });
  test('小さい payload はそのままキューへ1件入る', async () => {
    const store = setupChromeStorage();
    const ok = await stashFailedSave(mediaReq(), noopLog);
    expect(ok).toBe(true);
    const keys = queueKeys(store);
    expect(keys).toHaveLength(1);
    const entry: any = store.get(keys[0]);
    expect(entry).toMatchObject({ v: 1, host: RELEASE_NATIVE_HOST, type: 'saveMedia', tries: 0 });
    expect(entry.payload).toEqual(mediaReq());
  });

  test('送信前予約は満杯の既存 pending を追い出さない', async () => {
    const store = setupChromeStorage();
    for (let i = 0; i < SAVE_QUEUE_MAX_ENTRIES; i++) await stashFailedSave(mediaReq({ captureId: `170000000${String(i).padStart(4, '0')}-abcd` }), noopLog);
    const before = queueKeys(store);
    await expect(stashFailedSave(mediaReq({ captureId: '1700000099999-abcd' }), noopLog, undefined, false, true)).resolves.toBe(false);
    expect(queueKeys(store)).toEqual(before);
  });

  test('同時予約は直列化され、19 pendingの最後の1枠を両方に渡さない', async () => {
    const store = setupChromeStorage();
    for (let i = 0; i < SAVE_QUEUE_MAX_ENTRIES - 1; i++) await stashFailedSave(mediaReq({ captureId: `170000001${String(i).padStart(4, '0')}-abcd` }), noopLog);
    const results = await Promise.all([stashFailedSave(mediaReq({ captureId: '1700000020000-abcd' }), noopLog, undefined, true, true), stashFailedSave(mediaReq({ captureId: '1700000020001-abcd' }), noopLog, undefined, true, true)]);
    expect(results.sort()).toEqual([false, true]);
    expect(queueKeys(store)).toHaveLength(SAVE_QUEUE_MAX_ENTRIES);
  });

  test('満杯時はunknownを保持し、終端gaveUpだけ整理して新規予約を受ける', async () => {
    const store = setupChromeStorage();
    for (let i = 0; i < SAVE_QUEUE_MAX_ENTRIES; i++) await stashFailedSave(mediaReq({ captureId: `170000003${String(i).padStart(4, '0')}-abcd` }), noopLog);
    const keys = queueKeys(store);
    keys.slice(0, 19).forEach((key) => store.set(key, { ...(store.get(key) as any), gaveUp: true }));
    store.set(keys[19], { ...(store.get(keys[19]) as any), outcomeUnknown: true, attemptedAt: Date.now() });
    await expect(stashFailedSave(mediaReq({ captureId: '1700000040000-abcd' }), noopLog, undefined, true, true)).resolves.toBe(true);
    expect(queueKeys(store)).toHaveLength(SAVE_QUEUE_MAX_ENTRIES);
    expect(store.has(keys[19])).toBe(true);
    expect(store.has(keys[0])).toBe(false);
  });

  test('単独で予算に収まらない1件は退避せず false', async () => {
    const store = setupChromeStorage();
    const req = mediaReq({ mediaUrl: `https://example.com/${'A'.repeat(SAVE_QUEUE_BUDGET_BYTES + 1024)}` });
    const ok = await stashFailedSave(req, noopLog);
    expect(ok).toBe(false);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('バイト予算を超える新規分は古い順に破棄してから入る', async () => {
    const store = setupChromeStorage();
    // 単独なら収まる2件。ただし同じ大きさの3件目が加わると予算を超える。
    const chunk = 'A'.repeat(Math.floor(SAVE_QUEUE_BUDGET_BYTES / 2.5));
    await stashFailedSave(mediaReq({ mediaUrl: `https://example.com/${chunk}`, captureId: '1700000000001-0001' }), noopLog);
    // 追い出しの順序はキーから決まる。キーは `new Date().toISOString()`（ミリ秒の分解能）
    // を埋め込んでいる。同じミリ秒に入った2件の退避には順序が無いので、その衝突から1目盛り
    // 先まで待つ＝ここに事後条件は無い。時計が進むこと自体が目的。
    // biome-ignore lint/plugin: ISO のミリ秒までのキーの粒度が仕様＝2ms でその1刻みを越える
    await new Promise((r) => setTimeout(r, 2));
    await stashFailedSave(mediaReq({ mediaUrl: `https://example.com/${chunk}`, captureId: '1700000000002-0002' }), noopLog);
    expect(queueKeys(store)).toHaveLength(2);
    const oldestKeyBefore = queueKeys(store)[0];

    await stashFailedSave(mediaReq({ mediaUrl: `https://example.com/${chunk}`, captureId: '1700000000003-0003' }), noopLog);
    const keysAfter = queueKeys(store);
    // 3件目の場所を空けるため、先の2件のうち古いほうが追い出された。
    expect(keysAfter).not.toContain(oldestKeyBefore);
    expect(keysAfter).toHaveLength(2);
    const totalBytes = keysAfter.reduce((sum, k) => sum + new TextEncoder().encode(JSON.stringify(store.get(k))).length, 0);
    expect(totalBytes).toBeLessThanOrEqual(SAVE_QUEUE_BUDGET_BYTES);
  });

  test(`件数が ${SAVE_QUEUE_MAX_ENTRIES} を超えたら小さい payload でも古い順に落ちる`, async () => {
    const store = setupChromeStorage();
    for (let i = 0; i < SAVE_QUEUE_MAX_ENTRIES; i++) {
      await stashFailedSave(mediaReq({ captureId: `170000000${String(i).padStart(4, '0')}-0000` }), noopLog);
      // 上と同じ理由。キューのキーは ISO のミリ秒を持つので、「古い順」が意味を持つには
      // エントリごとに自分のミリ秒が要る。1ms ＝区別できる最小の目盛り。
      // biome-ignore lint/plugin: ISO のミリ秒までのキーの粒度が仕様＝1ms が1刻み
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(queueKeys(store)).toHaveLength(SAVE_QUEUE_MAX_ENTRIES);
    const oldestKeyBefore = queueKeys(store)[0];

    await stashFailedSave(mediaReq({ captureId: '1700000009999-0000' }), noopLog);
    const keysAfter = queueKeys(store);
    expect(keysAfter).toHaveLength(SAVE_QUEUE_MAX_ENTRIES);
    expect(keysAfter).not.toContain(oldestKeyBefore);
  });
});

describe('sweepSaveQueue — 直列再送', () => {
  test('成功したエントリはキューから消える', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const query = vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true });
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('現在のプロファイルが選ぶ Native Host と異なるエントリは触らない（#732）', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const [key] = queueKeys(store);
    const entry: any = store.get(key);
    store.set(key, { ...entry, host: 'com.hologram.host.dev' });
    const send = vi.fn().mockResolvedValue({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true }), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
  });

  test('gaveUp 済みのエントリは対象外', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const [key] = queueKeys(store);
    const entry: any = store.get(key);
    store.set(key, { ...entry, gaveUp: true, tries: SAVE_QUEUE_MAX_TRIES });
    const send = vi.fn().mockResolvedValue({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true }), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1); // その場に残る。消さない
  });

  test('同一 captureId が既に着地済みなら送らず捨てる（#34 の owners/id 一致）', async () => {
    const store = setupChromeStorage();
    const req = mediaReq({ captureId: '1700000000000-aaaa', metadata: { url: 'https://x.com/alice/status/9' } as any });
    await stashFailedSave(req, noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const landed: SavedEntry = { id: '1700000000000-aaaa', media: [] };
    const query = vi.fn().mockResolvedValue({ saved: landed, receipt: null, receiptCapable: true });
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('同じ URL でも別 captureId が保存済みなら、これは別の正当な保存として送る', async () => {
    const store = setupChromeStorage();
    const req = mediaReq({ captureId: '1700000000000-aaaa', metadata: { url: 'https://x.com/alice/status/9' } as any });
    await stashFailedSave(req, noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const other: SavedEntry = { id: '1700000000000-ffff', media: [], owners: ['1700000000000-ffff'] };
    const query = vi.fn().mockResolvedValue({ saved: other, receipt: null, receiptCapable: true });
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('query が失敗したら fail-open で送る', async () => {
    setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const query = vi.fn().mockRejectedValue(new Error('host unreachable'));
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('未送信の失敗は tries を増やして中断し、以降のエントリを試さない', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq({ captureId: '1700000000001-0001' }), noopLog);
    // 掃除はキューを古い順にたどるので、この2件のどちらを先に試すかを決めておく必要が
    // ある。そしてキーは ISO のミリ秒しか記録しない。
    // biome-ignore lint/plugin: ISO のミリ秒までのキーの粒度が仕様＝1ms が1刻み
    await new Promise((r) => setTimeout(r, 1));
    await stashFailedSave(mediaReq({ captureId: '1700000000002-0002' }), noopLog);
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Native host unavailable'), { delivery: 'not-sent' }));
    const query = vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true });
    await sweepSaveQueue({ send, query, log: noopLog });
    expect(send).toHaveBeenCalledTimes(1); // 最初の失敗で止まった
    const remaining = queueKeys(store).map((k) => store.get(k) as any);
    expect(remaining).toHaveLength(2); // どちらのエントリも落ちていない
    expect(remaining.some((e) => e.tries === 1)).toBe(true);
  });

  test(`tries が ${SAVE_QUEUE_MAX_TRIES} に達したら gaveUp を立てて残す`, async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const [key] = queueKeys(store);
    store.set(key, { ...(store.get(key) as any), tries: SAVE_QUEUE_MAX_TRIES - 1 });
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Native host unavailable'), { delivery: 'not-sent' }));
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true }), log: noopLog });
    const entry: any = store.get(key);
    expect(entry.tries).toBe(SAVE_QUEUE_MAX_TRIES);
    expect(entry.gaveUp).toBe(true);
  });

  test('ホストが答えた上での明示拒否はその1件だけ捨てて次へ進む', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq({ captureId: '1700000000001-0001' }), noopLog);
    // 上と同じ。拒否されるエントリを掃除が先に踏まなければならず、その順序はキーの
    // ISO のミリ秒にある。
    // biome-ignore lint/plugin: ISO のミリ秒までのキーの粒度が仕様＝1ms が1刻み
    await new Promise((r) => setTimeout(r, 1));
    await stashFailedSave(mediaReq({ captureId: '1700000000002-0002' }), noopLog);
    const send = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('post unavailable: deleted'), { delivery: 'rejected' }))
      .mockResolvedValueOnce({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true }), log: noopLog });
    expect(send).toHaveBeenCalledTimes(2); // 答えのあった拒否では止まらない
    expect(queueKeys(store)).toHaveLength(0); // 2件とも消えた（1件は拒否、1件は送信）
  });

  test('結果不明の保存はreceipt生成猶予中は保持し、v5 hostのreceipt無し確認後に回復再送する', async () => {
    vi.useFakeTimers();
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog, undefined, true);
    const send = vi.fn().mockResolvedValue({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockRejectedValue(new Error('query timeout')), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(90_001);
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true }), log: noopLog });
    expect(send).toHaveBeenCalledTimes(1);
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('再送の結果が不明なら pending を落とさず次の確認に委ねる', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Native host timed out'), { delivery: 'unknown' }));
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true }), log: noopLog });
    const [key] = queueKeys(store);
    expect(store.get(key)).toMatchObject({ outcomeUnknown: true, tries: 0 });
  });

  test('sweepもsend直前にunknownを耐久化し、確定not-sentだけ解除する', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const [key] = queueKeys(store);
    const send = vi.fn(async () => {
      expect(store.get(key)).toMatchObject({ outcomeUnknown: true, attemptedAt: expect.any(Number) });
      throw Object.assign(new Error('connect failed'), { delivery: 'not-sent' });
    });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: false }), log: noopLog });
    expect(store.get(key)).toMatchObject({ outcomeUnknown: false, tries: 1 });
    expect((store.get(key) as any).attemptedAt).toBeUndefined();
  });

  test('host receipt が processing の間は再送せず、completed で pending を落とす', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    const send = vi.fn();
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: { state: 'processing', ownerPid: 123, startedAt: Date.now() }, receiptCapable: true }), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
    await sweepSaveQueue({
      send,
      query: vi.fn().mockResolvedValue({
        saved: null,
        receiptCapable: true,
        receipt: { state: 'completed', ack: { ok: true, captureId: '1700000000000-aaaa', file: 'actual.jpg', saveFolder: 'C:/library', media: ['https://example.com/a.jpg'] } },
      }),
      log: noopLog,
    });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(0);
  });

  test('旧v4 host は receipt 無しを未受領とみなして結果不明要求を再送しない', async () => {
    vi.useFakeTimers();
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog, undefined, true);
    const [key] = queueKeys(store);
    store.set(key, { ...(store.get(key) as any), attemptedAt: Date.now() - 10 * 60_000 });
    const send = vi.fn();
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: false }), log: noopLog });
    expect(send).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
  });

  test('死亡ownerをhostがretryableと確定した要求だけ同じcaptureIdで再送する', async () => {
    setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog, undefined, true);
    const send = vi.fn().mockResolvedValue({ ok: true });
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: { state: 'retryable', interruptedAt: Date.now() }, receiptCapable: true }), log: noopLog });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ captureId: '1700000000000-aaaa' }));
  });

  test.each(['failed', 'completed', 'retryable', 'processing'])('別要求の %s receipt は保存キューを消去も再送もしない', async (state) => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq({ requestNonce: 'a'.repeat(32) }), noopLog, undefined, true);
    const before = store.get(queueKeys(store)[0]);
    const send = vi.fn().mockResolvedValue({ ok: true });
    const log = vi.fn();
    await sweepSaveQueue({
      send,
      query: vi.fn().mockResolvedValue({ saved: { id: '1700000000000-aaaa' }, receipt: { state, requestNonce: 'b'.repeat(32), error: '別要求の失敗' }, receiptCapable: true }),
      log,
    });
    expect(send).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(queueKeys(store)).toHaveLength(1);
    expect(store.get(queueKeys(store)[0])).toEqual(before);
  });

  test('同じ要求の failed receipt だけを終端失敗として取り除く', async () => {
    const store = setupChromeStorage();
    const requestNonce = 'a'.repeat(32);
    await stashFailedSave(mediaReq({ requestNonce }), noopLog, undefined, true);
    const send = vi.fn();
    const log = vi.fn();
    await sweepSaveQueue({ send, query: vi.fn().mockResolvedValue({ saved: null, receipt: { state: 'failed', requestNonce, error: '確定失敗' }, receiptCapable: true }), log });
    expect(queueKeys(store)).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ error: '確定失敗' }), true);
  });

  test('二重起動しても同時に1回しか走らない（single-flight）', async () => {
    setupChromeStorage();
    await stashFailedSave(mediaReq(), noopLog);
    let resolveSend!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((resolve) => (resolveSend = resolve)));
    const query = vi.fn().mockResolvedValue({ saved: null, receipt: null, receiptCapable: true });
    const first = sweepSaveQueue({ send, query, log: noopLog });
    const second = sweepSaveQueue({ send, query, log: noopLog }); // 掃除の途中で届く
    // ここで待っている観測可能な状態は、最初の掃除が send() まで届いたこと（resolveSend を
    // 代入するのもそこ）。2つ目の掃除は何もしなかったか、まだその手前にいるかのどちらか。
    // いずれにせよ決め手は下の回数で、それは両方が決着してから確かめる。
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    resolveSend({ ok: true });
    await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1); // 2つ目の呼び出しは `sweeping` がすでに true なので何もしない
  });
});

describe('saveQueueStats — 診断ページの在庫表示', () => {
  test('件数・合計バイト・諦めた件数を数える', async () => {
    const store = setupChromeStorage();
    await stashFailedSave(mediaReq({ captureId: '1700000000001-0001' }), noopLog);
    // 下の keys[0] は2件のうち古いほうでなければならず、それを決めるのはキーの ISO のミリ秒。
    // biome-ignore lint/plugin: ISO のミリ秒までのキーの粒度が仕様＝1ms が1刻み
    await new Promise((r) => setTimeout(r, 1));
    await stashFailedSave(mediaReq({ captureId: '1700000000002-0002' }), noopLog);
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
