// app/src/main/lib-job-pool.ts の単体テスト (#834、親は #98)。
//
// ここで押さえているのは2つ。どちらも Issue の受け入れ条件が乗っているもの:
//
//   1. サムネイルの振る舞いが、プールを汎用化する前と厳密に同じであること＝同時に2つ
//      まで、かつ run() の中で同期的に始めないこと（setImmediate による譲りこそプールが
//      在る理由そのもので、これが無いと最初のスクロールでキューに積んだデコードを1ターン
//      で全部走らせてしまう）。
//   2. 対話的な仕事がキューに在るか走っている間、背景の索引の仕事を決して開始しないこと。
//      バックフィルが、グリッドがこれから欲しがる枠を奪えないようにする
//      （「バックフィル中でも一覧のスクロールと検索が詰まらない」）。

import { describe, expect, test } from 'vitest';
import { createJobPool } from '../app/src/main/lib-job-pool';

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
    expect(pool.stats()).toMatchObject({ interactiveRunning: 2, interactiveQueued: 2 });
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

describe('背景の仕事の受け入れ（優先の規則）', () => {
  test('対話的な仕事が走っている間は始めない', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const g = gate();
    const order: string[] = [];
    for (let i = 0; i < 2; i++) {
      void pool.run(async () => {
        order.push('interactive');
        await g.promise;
      });
    }
    await tick();
    void pool.run(
      () => {
        order.push('background');
      },
      { priority: 'background' },
    );
    await tick();
    await tick();
    expect(order).toEqual(['interactive', 'interactive']);
    expect(pool.stats()).toMatchObject({ backgroundRunning: 0, backgroundQueued: 1 });
    g.release();
    await tick();
    await tick();
    expect(order).toEqual(['interactive', 'interactive', 'background']);
  });

  test('すでに走っている背景の仕事は、対話的な枠を塞がない', async () => {
    // 規則の、文書に書いてある限界。飛行中の背景の仕事を横取りすることは一切しない
    //（同期的なデコードは呼び出しの途中で中断できない）。それでも成り立っていなければ
    // ならないのは、それが自分の枠しか占めないこと。バックフィルの最中に届いたサムネイル
    // の要求は、待たずにすぐ走る。
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const g = gate();
    void pool.run(async () => await g.promise, { priority: 'background' });
    await tick();
    expect(pool.stats()).toMatchObject({ backgroundRunning: 1 });
    await expect(pool.run(() => 'tile')).resolves.toBe('tile');
    g.release();
  });

  test('対話的な仕事がキューに在るだけでも始めない', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const g = gate();
    // 両方の枠を対話的な仕事で埋め、そのうえで両方をもう1つずつキューへ積む。
    for (let i = 0; i < 3; i++) void pool.run(async () => await g.promise);
    let backgroundStarted = false;
    void pool.run(
      () => {
        backgroundStarted = true;
      },
      { priority: 'background' },
    );
    await tick();
    expect(pool.stats()).toMatchObject({ interactiveRunning: 2, interactiveQueued: 1, backgroundRunning: 0 });
    expect(backgroundStarted).toBe(false);
  });

  test('プールが他に何もしていなければ backgroundConcurrency を守る', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const g = gate();
    let running = 0;
    let peak = 0;
    for (let i = 0; i < 3; i++) {
      void pool.run(
        async () => {
          running++;
          peak = Math.max(peak, running);
          await g.promise;
          running--;
        },
        { priority: 'background' },
      );
    }
    await tick();
    expect(peak).toBe(1);
    g.release();
  });
});

describe('一時停止', () => {
  test('背景の仕事の開始を止め、再開すると続きから始まる', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const ran: number[] = [];
    pool.pauseBackground();
    for (let i = 0; i < 3; i++) {
      void pool.run(
        () => {
          ran.push(i);
        },
        { priority: 'background' },
      );
    }
    await tick();
    await tick();
    expect(ran).toEqual([]);
    expect(pool.isBackgroundPaused()).toBe(true);

    // 対話的な仕事は、背景の一時停止の影響を受けない。
    await expect(pool.run(() => 'ui')).resolves.toBe('ui');
    expect(ran).toEqual([]);

    pool.resumeBackground();
    await tick();
    await tick();
    await tick();
    await tick();
    expect(ran).toEqual([0, 1, 2]);
  });

  test('clearBackground はキューに在る背景の仕事だけを捨てる', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    pool.pauseBackground();
    for (let i = 0; i < 3; i++) void pool.run(() => i, { priority: 'background' });
    const ui = pool.run(() => 'ui'); // 背景の一時停止はこれを止めない
    expect(pool.stats()).toMatchObject({ backgroundQueued: 3, interactiveRunning: 1 });
    pool.clearBackground();
    expect(pool.stats()).toMatchObject({ backgroundQueued: 0, interactiveRunning: 1 });
    await expect(ui).resolves.toBe('ui');
  });
});
