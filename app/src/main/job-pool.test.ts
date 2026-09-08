// サムネイル生成を同時に2つまでに抑え、ジョブの間でイベントループへ譲る契約を確認する。

import { describe, expect, test } from 'vitest';
import { createJobPool } from './lib-job-pool';

/** プールの setImmediate による段取りを1つ進める。 */
const tick = () => new Promise((r) => setImmediate(r));

function gate() {
  let release!: (v?: unknown) => void;
  const promise = new Promise((r) => {
    release = r;
  });
  return { promise, release };
}

describe('対話的な仕事の受け入れ（サムネイルの契約）', () => {
  test('仕事を同期的に始めない＝setImmediate による譲り', async () => {
    const pool = createJobPool({ concurrency: 2 });
    let ran = false;
    const p = pool.run(() => {
      ran = true;
    });
    expect(ran).toBe(false); // まだキューの中。run() は仕事の本体より先に返っている
    await p;
    expect(ran).toBe(true);
  });

  test('同時に走るのは最大でも `concurrency` 個', async () => {
    const pool = createJobPool({ concurrency: 2 });
    const g = gate();
    const started: number[] = [];
    for (let i = 0; i < 4; i++) {
      void pool.run(async () => {
        started.push(i);
        await g.promise;
      });
    }
    await tick();
    expect(started).toEqual([0, 1]);
    expect(pool.stats()).toEqual({ running: 2, queued: 2 });
    g.release();
    await tick();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
  });

  test('throw する仕事は null で解決せず reject する', async () => {
    const pool = createJobPool({ concurrency: 1 });
    await expect(
      pool.run(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // ...そして枠は解放され、プールがその後ろで詰まることはない。
    await expect(pool.run(() => 'next')).resolves.toBe('next');
  });
});
