'use strict';

// サムネイル生成のジョブプール。nativeImage の復号・縮小・toJPEG はメインプロセスの唯一の JS
// スレッドの上で同期に走るので、最初のスクロールが投げる asset://…?w= のリクエストの群れは、
// そうしないと立て続けに1つの長い同期の実行になり、ほかのあらゆる IPC・UI のメッセージを飢え
// させる。重い仕事を、ジョブの間でイベントループへ譲る（setImmediate）小さなプールへ集約する
// ことで、メインスレッドがほかの処理を続けられるようにする。
//
// Electron に依存しない（そもそも import が1つも無い）ので、素の node で単体テストできる。

export interface JobPoolStats {
  running: number;
  queued: number;
}

export interface JobPoolOptions {
  /** 同時に実行する上限。 */
  concurrency?: number;
}

interface QueuedJob {
  fn: () => unknown;
  resolve: (v: any) => void;
  reject: (e: unknown) => void;
}

export function createJobPool(options: JobPoolOptions = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const queue: QueuedJob[] = [];
  let running = 0;

  function start(job: QueuedJob) {
    running++;
    // 直接の呼び出しではなく setImmediate。これが譲り。これが無いと、キューの送り出しが
    // すべてのジョブを1回の同期のターンで走らせてしまい、それがこのプールの取り除くために
    // 在る引っかかり。
    setImmediate(async () => {
      try {
        job.resolve(await job.fn());
      } catch (err) {
        job.reject(err);
      } finally {
        running--;
        pump();
      }
    });
  }

  function pump() {
    while (running < concurrency && queue.length) {
      start(queue.shift() as QueuedJob);
    }
  }

  return {
    /** `fn` をキューへ入れる。その値で解決し、投げたものがあればそれで拒否する。 */
    run<T>(fn: () => T | Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const job: QueuedJob = { fn, resolve, reject };
        queue.push(job);
        pump();
      });
    },
    stats(): JobPoolStats {
      return {
        running,
        queued: queue.length,
      };
    },
  };
}

export type JobPool = ReturnType<typeof createJobPool>;

/** プロセス全体でサムネイル生成が共有するプール。 */
export const sharedJobPool: JobPool = createJobPool({ concurrency: 2 });
