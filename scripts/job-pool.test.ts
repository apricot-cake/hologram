// Unit tests for app/src/main/lib-job-pool.ts (#834, parent #98).
//
// Two things are being pinned here, and they are the two the Issue's acceptance
// criteria rest on:
//
//   1. Thumbnails behave exactly as they did before the pool was generalized —
//      up to 2 at a time, and never starting synchronously inside run() (the
//      setImmediate yield is the whole reason the pool exists; without it a
//      first scroll runs every queued decode in one turn).
//   2. A background index job is never STARTED while interactive work is queued
//      or running, so a backfill cannot take a slot the grid is about to want
//      ("バックフィル中でも一覧のスクロールと検索が詰まらない").

import { describe, expect, test } from 'vitest';
import { createJobPool } from '../app/src/main/lib-job-pool';

/** Lets the pool's setImmediate scheduling advance. */
const tick = () => new Promise((r) => setImmediate(r));

function gate() {
  let release!: (v?: unknown) => void;
  const promise = new Promise((r) => {
    release = r;
  });
  return { promise, release };
}

describe('interactive admission (the thumbnail contract)', () => {
  test('does not start a job synchronously — the setImmediate yield', async () => {
    const pool = createJobPool({ concurrency: 2 });
    let ran = false;
    const p = pool.run(() => {
      ran = true;
    });
    expect(ran).toBe(false); // still queued: run() returned before the job body
    await p;
    expect(ran).toBe(true);
  });

  test('runs at most `concurrency` at once', async () => {
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

  test('a throwing job rejects rather than resolving null', async () => {
    const pool = createJobPool({ concurrency: 1 });
    await expect(
      pool.run(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // ...and the slot is released, so the pool is not wedged behind it.
    await expect(pool.run(() => 'next')).resolves.toBe('next');
  });
});

describe('background admission (the priority rule)', () => {
  test('does not start while interactive jobs are running', async () => {
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

  test('an already-running background job does not hold the interactive slot', async () => {
    // The documented limit of the rule: a background job in flight is NOT
    // preempted (a synchronous decode cannot be interrupted mid-call). What
    // must still hold is that it occupies only its own slot, so a thumbnail
    // request arriving mid-backfill runs immediately rather than waiting.
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const g = gate();
    void pool.run(async () => await g.promise, { priority: 'background' });
    await tick();
    expect(pool.stats()).toMatchObject({ backgroundRunning: 1 });
    await expect(pool.run(() => 'tile')).resolves.toBe('tile');
    g.release();
  });

  test('does not start while an interactive job is merely QUEUED', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    const g = gate();
    // Fill both slots with interactive work, then queue one more of each.
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

  test('honours backgroundConcurrency once the pool is otherwise idle', async () => {
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

describe('pause', () => {
  test('stops starting background work and resumes where it left off', async () => {
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

    // Interactive work is unaffected by a background pause.
    await expect(pool.run(() => 'ui')).resolves.toBe('ui');
    expect(ran).toEqual([]);

    pool.resumeBackground();
    await tick();
    await tick();
    await tick();
    await tick();
    expect(ran).toEqual([0, 1, 2]);
  });

  test('clearBackground drops queued background work only', async () => {
    const pool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
    pool.pauseBackground();
    for (let i = 0; i < 3; i++) void pool.run(() => i, { priority: 'background' });
    const ui = pool.run(() => 'ui'); // a background pause does not hold this back
    expect(pool.stats()).toMatchObject({ backgroundQueued: 3, interactiveRunning: 1 });
    pool.clearBackground();
    expect(pool.stats()).toMatchObject({ backgroundQueued: 0, interactiveRunning: 1 });
    await expect(ui).resolves.toBe('ui');
  });
});
