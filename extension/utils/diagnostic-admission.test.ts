import { afterEach, expect, test, vi } from 'vitest';
import { boundedDiagnostic, createDiagnosticAdmission } from './diagnostic-admission.ts';

afterEach(() => vi.useRealTimers());
const entry = { stage: 'unknown' as const, phase: 'fail' as const, error: 'own failure' };
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
function fixture(initial: unknown = undefined) {
  let state = initial;
  let clock = 10_000;
  const emitted: unknown[] = [];
  const summaries: unknown[] = [];
  const write = vi.fn(async (next, summary) => {
    state = structuredClone(next);
    if (summary) summaries.push(summary);
  });
  const alarm = vi.fn(async () => {});
  const options = { read: async () => state, write, alarm, now: () => clock, emit: (...args: unknown[]) => emitted.push(args) };
  return {
    options,
    write,
    alarm,
    emitted,
    summaries,
    state: () => state as any,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

test('復元の完了前は出力・永続予約を行わず、飽和した予算を維持する', async () => {
  const f = fixture({ startedAt: 10_000, count: 200, suppressed: 17 });
  let resolve!: (value: unknown) => void;
  const gate = createDiagnosticAdmission({
    ...f.options,
    read: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  for (let i = 0; i < 250; i++) gate.submit(entry);
  expect(f.emitted).toEqual([]);
  expect(f.write).not.toHaveBeenCalled();
  resolve(f.state());
  await flush();
  expect(f.emitted).toEqual([]);
  expect(f.state()).toMatchObject({ count: 200, suppressed: 267 });
});

test('永続予約の成功前には native/local 出力を開始しない', async () => {
  const f = fixture();
  let release!: () => void;
  const gate = createDiagnosticAdmission({
    ...f.options,
    write: () =>
      new Promise<void>((r) => {
        release = r;
      }),
  });
  gate.submit(entry);
  await flush();
  expect(f.emitted).toEqual([]);
  release();
  await flush();
  expect(f.emitted).toHaveLength(1);
});

test('accepted だけの窓も worker 再起動をまたいで 200 件までに制限する', async () => {
  const f = fixture();
  const first = createDiagnosticAdmission(f.options);
  for (let i = 0; i < 100; i++) first.submit(entry);
  await flush();
  expect(f.state().count).toBe(100);
  const second = createDiagnosticAdmission(f.options);
  for (let i = 0; i < 150; i++) second.submit(entry);
  await flush();
  expect(f.emitted).toHaveLength(200);
  expect(f.state()).toMatchObject({ count: 200, suppressed: 50 });
});

test('quiet alarm が次の入力なしで summary を永続化し、再起動で重複させない', async () => {
  const f = fixture();
  const gate = createDiagnosticAdmission(f.options);
  for (let i = 0; i < 250; i++) gate.submit(entry);
  await flush();
  expect(f.alarm).toHaveBeenCalledWith(70_000);
  f.advance(60_001);
  gate.wake();
  await flush();
  expect(f.summaries).toHaveLength(1);
  expect(f.summaries[0]).toMatchObject({ suppressed: 50 });
  createDiagnosticAdmission(f.options);
  await flush();
  expect(f.summaries).toHaveLength(1);
});

test('期限を過ぎた最初の入力は新しい窓で受理する', async () => {
  vi.useFakeTimers();
  const f = fixture({ startedAt: 10_000, count: 200, suppressed: 0 });
  const gate = createDiagnosticAdmission(f.options);
  await flush();
  f.advance(60_001);
  gate.submit(entry);
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  expect(f.emitted).toHaveLength(1);
  expect(f.state().count).toBe(1);
});

test.each([
  { startedAt: NaN, count: 0, suppressed: 0 },
  { startedAt: 90_000, count: 0, suppressed: 0 },
  { startedAt: 10_000, count: -1, suppressed: Infinity },
])('不正な保存状態は予算を復活させない: %#', async (initial) => {
  const f = fixture(initial);
  const gate = createDiagnosticAdmission(f.options);
  gate.submit(entry);
  await flush();
  expect(f.emitted).toEqual([]);
  expect(f.state().count).toBe(200);
});

test('storage 失敗は出力せず閉じ、alarm 再試行で回復する', async () => {
  const f = fixture();
  f.write.mockRejectedValueOnce(new Error('quota'));
  const gate = createDiagnosticAdmission(f.options);
  gate.submit(entry);
  await flush();
  expect(f.emitted).toEqual([]);
  for (let i = 0; i < 500; i++) gate.submit(entry);
  expect(f.write).toHaveBeenCalledTimes(1);
  gate.wake();
  await flush();
  gate.submit(entry);
  await flush();
  expect(f.emitted).toHaveLength(1);
});

test('read と alarm が同時失敗しても有限頻度の入力再試行で通常ログが復帰する', async () => {
  const f = fixture();
  let unavailable = true;
  const read = vi.fn(async () => {
    if (unavailable) throw new Error('offline');
    return f.state();
  });
  const gate = createDiagnosticAdmission({
    ...f.options,
    read,
    alarm: async () => {
      if (unavailable) throw new Error('offline');
    },
  });
  await flush();
  for (let i = 0; i < 500; i++) gate.submit(entry);
  expect(read).toHaveBeenCalledTimes(1);
  expect(f.write).not.toHaveBeenCalled();
  unavailable = false;
  f.advance(5000);
  gate.submit(entry);
  await flush();
  expect(read).toHaveBeenCalledTimes(2);
  expect(f.emitted).toHaveLength(1);
});

test('sustained burst の抑止書込みは一秒ごとに集約し、出力は増えない', async () => {
  vi.useFakeTimers();
  const f = fixture();
  const gate = createDiagnosticAdmission(f.options);
  for (let i = 0; i < 250; i++) gate.submit(entry);
  await flush();
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 100; j++) gate.submit(entry);
    f.advance(1000);
    await vi.advanceTimersByTimeAsync(1000);
  }
  expect(f.write.mock.calls.length).toBeLessThanOrEqual(21);
  expect(f.emitted).toHaveLength(200);
  expect(f.state().suppressed).toBe(2050);
});

test('長い文字列・任意入れ子・非有限数を転送せず 8 KiB 以内へ制限する', () => {
  const value = boundedDiagnostic({ ...entry, error: '猫'.repeat(100_000), stack: '猫'.repeat(100_000), url: '猫'.repeat(100_000), arbitrary: { large: 'x'.repeat(100_000) }, count: Infinity });
  expect(value).not.toHaveProperty('arbitrary');
  expect(value).not.toHaveProperty('count');
  expect(new TextEncoder().encode(JSON.stringify(value)).length).toBeLessThanOrEqual(8192);
  expect(boundedDiagnostic({ stage: 'invalid', phase: 'fail' })).toBeNull();
  expect(boundedDiagnostic({ stage: { toString: 1 }, phase: 'fail' })).toBeNull();
  expect(boundedDiagnostic({ stage: 'unknown', phase: ['fail'] })).toBeNull();
});
