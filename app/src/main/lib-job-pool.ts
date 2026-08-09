'use strict';

// このアプリで唯一のジョブのプール（#834、親は #98）。
//
// 実体は lib-thumbnails.ts 自身のプール（`runThumbJob`）を一般化したもの。作られた理由は1つで、
// 今もその理由のために在る。nativeImage の復号・縮小・toJPEG はメインプロセスの唯一の JS
// スレッドの上で同期に走るので、最初のスクロールが投げる asset://…?w= のリクエストの群れは、
// そうしないと立て続けに1つの長い同期の実行になり、ほかのあらゆる IPC・UI のメッセージを飢え
// させる。重い仕事を、ジョブの間でイベントループへ譲る（setImmediate）小さなプールへ集約する
// ことが、メインスレッドに息を続けさせている。一般化してもそれは薄まらない＝サムネイルは今まで
// とまったく同じ入場の規則を保つ。
//
// 一般化が足すのは、2つ目の種類の仕事＝背景の索引のジョブ（#48/#49/#50/#51。lib-index-queue.ts
// が予定を立てる）。あれらは決してグリッドを引っかからせてはいけないので、単に対話的な仕事の
// 後ろに並ぶだけではない。背景のジョブが開始されるのは、対話的なジョブが1つもキューにも実行中
// にも無いときだけ。4つの機能がそれぞれ自分の全件の掃き寄せを走らせることこそ、#834 が防ぐために
// 在るもの。同時実行数・優先度・一時停止が住むのは、この1つのプール。
//
// 横取りはしないし、それは意図してのこと。既に飛行中の背景のジョブは最後まで走る（同期の復号を
// 途中で中断する手段は無い）ので、到着したサムネイルの要求が待つのは最悪でも背景のジョブ1つ分。
// つまり止まる時間は、このモジュールが強制できる何かではなく、ジョブの種別自身の大きさの上限
// （lib-index-jobs.ts の maxInputBytes / maxSegments）で抑えられる。
//
// Electron に依存しない（そもそも import が1つも無い）ので、素の node で単体テストできる。

export type JobPriority = 'interactive' | 'background';

export interface JobPoolStats {
  interactiveRunning: number;
  backgroundRunning: number;
  interactiveQueued: number;
  backgroundQueued: number;
  backgroundPaused: boolean;
}

export interface JobPoolOptions {
  /** 両方の種類を合わせた上限。既定は 2＝lib-thumbnails.ts の THUMB_POOL と同じ。 */
  concurrency?: number;
  /** その上限のうち、背景のジョブが占めてよい数。既定は 1。 */
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
    // 直接の呼び出しではなく setImmediate。これが譲り。これが無いと、キューの送り出しが
    // すべてのジョブを1回の同期のターンで走らせてしまい、それがこのプールの取り除くために
    // 在る引っかかり。
    setImmediate(async () => {
      try {
        job.resolve(await job.fn());
      } catch (err) {
        // #834 より前の runThumbJob と違い、失敗は null で解決するのではなく拒否する。索引の
        // ジョブの呼び出し元は「何も作らなかった」と「投げた」を区別できなければならない。
        // lib-thumbnails.ts は自分の呼び出し箇所で捕まえることで、昔の null を保つ。
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
    // 背景の入場は厳密により狭い。上の条件すべてに加えて、系のどこにも対話的な仕事が無いこと。
    // それが "UI より低い優先度" の全部＝キューでの位置だけでは足りない。枠を掴んだ背景のジョブ
    // が、スクロールの一番最初のタイルを遅らせてしまうため。
    while (!backgroundPaused && backgroundQueue.length && backgroundRunning < backgroundConcurrency && interactiveRunning + backgroundRunning < concurrency && interactiveRunning === 0 && interactiveQueue.length === 0) {
      start(backgroundQueue.shift() as QueuedJob, 'background');
    }
  }

  return {
    /** `fn` をキューへ入れる。その値で解決し、投げたものがあればそれで拒否する。 */
    run<T>(fn: () => T | Promise<T>, opts: { priority?: JobPriority } = {}): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const job: QueuedJob = { fn, resolve, reject };
        if (opts.priority === 'background') backgroundQueue.push(job);
        else interactiveQueue.push(job);
        pump();
      });
    },
    /** 背景のジョブの開始を止める。飛行中のものは今までどおり終わる（ヘッダを参照）。 */
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
    /** まだ開始していない背景のジョブを全部捨てる（ライブラリの切り替え・clear-all）。 */
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
 * プロセス全体で1つのプール。サムネイル（対話的）と索引のキュー（背景）がこれを共有する＝
 * #834 の要点は、「重い仕事を一度にどれだけ走らせてよいか」を決める場所がちょうど1つある
 * ことにある。
 */
export const sharedJobPool: JobPool = createJobPool({ concurrency: 2, backgroundConcurrency: 1 });
