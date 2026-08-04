'use strict';

// The app's one job pool (#834, parent #98).
//
// This is lib-thumbnails.ts's own pool (`runThumbJob`), generalized. It was
// built for one reason and still exists for it: nativeImage decode/resize/
// toJPEG is synchronous on the main process's single JS thread, so the burst of
// asset://…?w= requests a first scroll fires would otherwise execute back-to-back
// as one long synchronous run that starves every other IPC/UI message. Funnelling
// heavy work through a small pool that yields to the event loop (setImmediate)
// between jobs is what keeps the main thread breathing, and generalizing it does
// not dilute that — thumbnails keep the exact same admission rule they had.
//
// What the generalization adds is a SECOND class of work: the background index
// jobs (#48/#49/#50/#51, scheduled by lib-index-queue.ts). Those must never make
// the grid stutter, so they are not merely queued behind interactive work — a
// background job is only ever STARTED while no interactive job is queued or
// running. Four features each running their own全件 sweep is precisely what #834
// exists to prevent; one pool is where concurrency, priority and pause live.
//
// Not preemptive, and deliberately so: a background job already in flight runs to
// completion (there is no way to interrupt a synchronous decode mid-call), so the
// worst an arriving thumbnail request waits is one background job. That bounds
// the stall by the job kinds' own size caps (lib-index-jobs.ts's maxInputBytes /
// maxSegments) rather than by anything this module can enforce.
//
// Electron-free (no imports at all) so it unit-tests in plain node.

export type JobPriority = 'interactive' | 'background';

export interface JobPoolStats {
  interactiveRunning: number;
  backgroundRunning: number;
  interactiveQueued: number;
  backgroundQueued: number;
  backgroundPaused: boolean;
}

export interface JobPoolOptions {
  /** Ceiling across BOTH classes. Default 2 — lib-thumbnails.ts's THUMB_POOL. */
  concurrency?: number;
  /** Of that ceiling, how many may be background jobs. Default 1. */
  backgroundConcurrency?: number;
}

interface QueuedJob {
  fn: () => unknown;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
}

export function createJobPool(options: JobPoolOptions = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const backgroundConcurrency = Math.max(1, options.backgroundConcurrency ?? 1);

  const interactiveQueue: QueuedJob[] = [];
  const backgroundQueue: QueuedJob[] = [];
  let interactiveRunning = 0;
  let backgroundRunning = 0;
  let backgroundPaused = false;

  function start(job: QueuedJob, priority: JobPriority) {
    if (priority === 'interactive') interactiveRunning++;
    else backgroundRunning++;
    // setImmediate, not a direct call: this is the yield. Without it a queue
    // drain would run every job in one synchronous turn, which is the stutter
    // the pool exists to remove.
    setImmediate(async () => {
      try {
        job.resolve(await job.fn());
      } catch (err) {
        // Unlike the pre-#834 runThumbJob, a failure REJECTS rather than
        // resolving null: an index job's caller has to be able to tell "produced
        // nothing" from "threw". lib-thumbnails.ts keeps its old null by
        // catching at its own call site.
        job.reject(err);
      } finally {
        if (priority === 'interactive') interactiveRunning--;
        else backgroundRunning--;
        pump();
      }
    });
  }

  function pump() {
    while (interactiveRunning + backgroundRunning < concurrency && interactiveQueue.length) {
      start(interactiveQueue.shift() as QueuedJob, 'interactive');
    }
    // Background admission is strictly narrower: everything above, AND no
    // interactive work anywhere in the system. That is the whole of "UI より低い
    // 優先度" — a queue position would not be enough, because a background job
    // holding a slot delays the very first tile of a scroll.
    while (!backgroundPaused && backgroundQueue.length && backgroundRunning < backgroundConcurrency && interactiveRunning + backgroundRunning < concurrency && interactiveRunning === 0 && interactiveQueue.length === 0) {
      start(backgroundQueue.shift() as QueuedJob, 'background');
    }
  }

  return {
    /** Queues `fn`; resolves with its value, rejects with whatever it threw. */
    run<T>(fn: () => T | Promise<T>, opts: { priority?: JobPriority } = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const job: QueuedJob = { fn, resolve, reject };
        if (opts.priority === 'background') backgroundQueue.push(job);
        else interactiveQueue.push(job);
        pump();
      });
    },
    /** Stops STARTING background jobs. In-flight ones still finish (see the header). */
    pauseBackground(): void {
      backgroundPaused = true;
    },
    resumeBackground(): void {
      if (!backgroundPaused) return;
      backgroundPaused = false;
      pump();
    },
    isBackgroundPaused(): boolean {
      return backgroundPaused;
    },
    /** Drops every not-yet-started background job (library switch / clear-all). */
    clearBackground(): void {
      backgroundQueue.length = 0;
    },
    stats(): JobPoolStats {
      return {
        interactiveRunning,
        backgroundRunning,
        interactiveQueued: interactiveQueue.length,
        backgroundQueued: backgroundQueue.length,
        backgroundPaused,
      };
    },
  };
}

export type JobPool = ReturnType<typeof createJobPool>;

/**
 * The process-wide pool. Thumbnails (interactive) and the index queue
 * (background) share it — the point of #834 is that there is exactly one place
 * where "how much heavy work may run at once" is decided.
 */
export const sharedJobPool: JobPool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
