'use strict';

// 取込キューの実行キュー（#834、親 #98）: アプリの中でバックグラウンドで
// ライブラリを走査する唯一のもの。
//
// #48（色）、#49（OCR／テキスト抽出）、#50（AI タグ）、#51（画像検索）は
// それぞれ、すべてのレコードを一度処理する必要がある。4つの別々の掃き寄せが
// 同時に走ればメインスレッドを奪い合い、それぞれが同じ4つの決定——一度に何件、
// どんな優先度で、どう止めるか、何をもって済んだとするか——を再発明する
// ことになる。このモジュールがそれらを所有する。機能側はジョブ種別
// （lib-index-jobs.ts）を登録し、何を計算するかを言うだけでよい。
//
// これを駆動する入り口は2つあり、「どちらも」自分自身の進捗記録を持たない:
//
//   - 新しい保存: 「レコードが変わった」というブロードキャストが、前回の走査
//     以降 updatedAt が動いた行だけに絞った走査を引き起こす。
//   - 遡及処理: ライブラリ全体を、まとまりごとに歩く。
//
// 再開可能性は、カーソルからではなく派生ストアから来る（#834 が却下した
// 代替案、#98 の 2026-08-02 コメント §3）: あるジョブにまだ仕事が残って
// いるかは、derived_progress の indexedSegments/totalSegments から導出する。
// だから遡及処理の途中のクラッシュが招くのは再処理ではなく再走査であり
// ——どこまで進んだかについて1つ目の状態と食い違いうる2つ目の状態は
// 存在しない。下の `since` のスタンプは唯一のメモリ上の近道で、それは
// あくまで最適化にすぎない: それを忘れても、走査が必要以上に多くの行を
// カバーするだけで済む。
//
// Electron に依存しない——すべての副作用（データベース、ファイルシステム、
// ログ、レンダラーへの push）は依存として渡されるので、状態機械全体を素の
// node で単体テストできる。

import { candidateKey, planRecord, resolveInput, type IndexCandidate, type IndexJobKind, type IndexProgressRow, type IndexRecord, type ResolveInputDeps } from './lib-index-jobs.ts';
import type { JobPool } from './lib-job-pool.ts';
import type { IndexQueueStatus } from './ipc-payloads.ts';

export type { IndexQueueStatus };

export interface IndexProgressWrite {
  captureId: string;
  assetRef: string;
  jobKind: string;
  modelId: string | null;
  modelRev: string | null;
  indexedSegments: number;
  totalSegments: number;
}

export interface IndexQueueDeps {
  pool: JobPool;
  /** #830 のオプトインフラグ。計画のたびに読むので、切り替えは即座に効く。 */
  aiEnabled(): boolean;
  /**
   * 仕事が必要かもしれないレコードの captureId。`since` は updatedAt の境界
   * （null = ライブラリ全体）。返される maxUpdatedAt が次の境界になる。
   */
  listCaptureIds(since: string | null): { ids: string[]; maxUpdatedAt: string | null };
  recordsByIds(ids: string[]): IndexRecord[];
  progressOf(captureId: string, assetRef: string, jobKind: string): IndexProgressRow | undefined;
  saveProgress(row: IndexProgressWrite): void;
  resolve: ResolveInputDeps;
  onJobError(candidate: IndexCandidate, err: unknown): void;
  onStatusChange(status: IndexQueueStatus): void;
}

// 走査ジョブ1回あたりの captureId のまとまり。9千件のライブラリが9千回では
// なく約45回の走査ジョブで済むだけ大きく、まとまりの計画（アセット×種別
// ごとに derived_progress を1回読む）が、プールの setImmediate の譲り合いの
// 間の短い同期的なバーストで収まるだけ小さい。
const SCAN_CHUNK = 200;
// 状態はレンダラーへ push される。ジョブごとに push すると、デコードした
// 画像1枚につき IPC メッセージが1つになってしまう。代わりにまとめる——
// このインジケータは進捗バーであってログではない。
const STATUS_COALESCE_MS = 250;
// 走査はジョブより先を行く（indexed 読み取りだけで安いため）ので、上限が
// 無いと、フルの遡及処理は最初のジョブが終わる前にライブラリ全体分の候補
// ——とそれが運ぶレコード——を実体化してしまう。この件数が未処理のままの間は
// 歩みを止め、それが送り出されるにつれて再開する。メモリを縛るのはライブラリの
// サイズではなくキューの深さ。
const MAX_QUEUE_DEPTH = 500;

const kinds = new Map<string, IndexJobKind>();

let deps: IndexQueueDeps | null = null;
let queued = new Set<string>();
let scanIds: string[] = [];
let scanning = false;
let sinceStamp: string | null = null;
let paused = false;
let done = 0;
let total = 0;
let currentKind: string | null = null;
let statusTimer: NodeJS.Timeout | null = null;

/**
 * ジョブ種別を追加する。機能側の Issue が起動時にこれを呼ぶ。キュー自身は、
 * どの種別が何を計算するかを一切知らない。同じ id を再登録すれば置き換わる
 * ので、ホットリロードされた開発ビルドがすべて二重になったりしない。
 */
export function registerIndexJobKind(kind: IndexJobKind): void {
  kinds.set(kind.id, kind);
}

export function registeredIndexJobKinds(): IndexJobKind[] {
  return [...kinds.values()];
}

export function indexQueueStatus(): IndexQueueStatus {
  return {
    active: total > done || scanning || scanIds.length > 0,
    paused,
    scanning: scanning || scanIds.length > 0,
    done,
    total,
    currentKind,
  };
}

function emitStatus(immediate = false) {
  if (!deps) return;
  if (immediate) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    deps.onStatusChange(indexQueueStatus());
    return;
  }
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    deps?.onStatusChange(indexQueueStatus());
  }, STATUS_COALESCE_MS);
}

/** すべて送り出された——カウンタは実行ごとなので、次の実行は 0/0 から始まる。 */
function settleIfIdle() {
  if (total > done || scanning || scanIds.length > 0) return;
  done = 0;
  total = 0;
  currentKind = null;
  emitStatus(true);
}

function enqueue(candidates: IndexCandidate[]) {
  const d = deps;
  if (!d) return;
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (queued.has(key)) continue;
    queued.add(key);
    total++;
    void runCandidate(d, candidate, key);
  }
  if (candidates.length) emitStatus();
}

async function runCandidate(d: IndexQueueDeps, candidate: IndexCandidate, key: string) {
  const kind = kinds.get(candidate.jobKind);
  try {
    await d.pool.run(
      async () => {
        if (!kind) return;
        currentKind = kind.id;
        const resolved = await resolveInput(candidate, kind, d.resolve);
        if (!resolved.ok) {
          // 解決の失敗に対して進捗行を書かないのは意図的: 空／サイズ超過／
          // 無いという入力は「結果」ではなく「ファイル」についての事実で
          // あり、それを決め直すコストは stat 1回で済む（サムネイル経路は
          // さらに lib-thumbnails.ts 自身の失敗結果キャッシュにも当たる）。
          // 「失敗した」という印を書けば、#833 のスキーマが意図して持って
          // いない3つ目の状態を発明することになり、除外する理由が無くなった
          // 後もファイルを除外したままにしてしまう。
          return;
        }
        const result = await kind.run(resolved.input, { record: candidate.record, asset: candidate.asset, fromSegment: candidate.fromSegment });
        d.saveProgress({
          captureId: candidate.record.captureId,
          assetRef: candidate.asset.ref,
          jobKind: kind.id,
          modelId: result.modelId ?? null,
          modelRev: result.modelRev ?? null,
          indexedSegments: result.indexedSegments,
          totalSegments: result.totalSegments,
        });
      },
      { priority: 'background' },
    );
  } catch (err) {
    // 上と同じ理由で進捗行を残さない——一時的な失敗は結果として記憶される
    // のではなく、次の遡及処理で再試行される。
    d.onJobError(candidate, err);
  } finally {
    queued.delete(key);
    done++;
    emitStatus();
    // 歩みは MAX_QUEUE_DEPTH で止まっていた——この送り出しが、それを続けられる
    // ようにする。
    if (!paused && scanIds.length) scheduleScan();
    settleIfIdle();
  }
}

function scheduleScan() {
  const d = deps;
  if (!d || scanning || paused || !scanIds.length) return;
  if (total - done >= MAX_QUEUE_DEPTH) return; // runCandidate の送り出しがこれを再開させる
  scanning = true;
  void d.pool
    .run(
      () => {
        const chunk = scanIds.splice(0, SCAN_CHUNK);
        const kindList = registeredIndexJobKinds();
        if (!kindList.length) return;
        const aiEnabled = d.aiEnabled();
        for (const record of d.recordsByIds(chunk)) {
          const { run } = planRecord(record, kindList, { aiEnabled, progressOf: d.progressOf });
          enqueue(run);
        }
      },
      { priority: 'background' },
    )
    .catch(() => {
      // 例外を投げた走査のまとまりは、この回はそのレコード分を失う。次の
      // 遡及処理がそれらを歩き直す（何も書かれていないので何も失われない）。
    })
    .finally(() => {
      scanning = false;
      scheduleScan();
      emitStatus();
      settleIfIdle();
    });
}

/**
 * ライブラリを歩き、まだ仕事が残っているものをすべてキューに入れる。
 *
 * `full` はすべてを歩き直す（起動時、そして AI のオプトインが有効になった
 * 後——'ai-disabled' としてスキップされたレコードはどこにも記憶されないので、
 * 決め直す必要がある）。これが無ければ、歩みは前回の走査以降 updatedAt が
 * 動いた行に限られる。これは保存が引き起こすもの。
 */
export function requestBackfill(opts: { full?: boolean } = {}): void {
  const d = deps;
  if (!d) return;
  const { ids, maxUpdatedAt } = d.listCaptureIds(opts.full ? null : sinceStamp);
  if (maxUpdatedAt && (!sinceStamp || maxUpdatedAt > sinceStamp)) sinceStamp = maxUpdatedAt;
  if (!ids.length) return;
  scanIds = scanIds.concat(ids);
  emitStatus(true);
  if (!paused) scheduleScan();
}

/** 保存の差分フック: 何かが変わったので、動いたものを見る。 */
export function notifyRecordsChanged(): void {
  requestBackfill();
}

export function pauseIndexQueue(): void {
  if (paused) return;
  paused = true;
  deps?.pool.pauseBackground();
  emitStatus(true);
}

export function resumeIndexQueue(): void {
  if (!paused) return;
  paused = false;
  deps?.pool.resumeBackground();
  scheduleScan();
  emitStatus(true);
}

/**
 * キューを起動する。プロセスごとに一度だけ呼ばれる。最初のフル遡及処理が、
 * このビルドより前から存在していたすべて（と、前回の実行が途中で中断した
 * すべて）を拾い上げる。
 */
export function startIndexQueue(d: IndexQueueDeps): void {
  deps = d;
  requestBackfill({ full: true });
}

/**
 * キューに入っていた仕事と走査の境界を捨てる——ライブラリの切り替え
 * （#176）向け。処理中のすべての captureId は、もう開いていないライブラリに
 * 属している。処理中のジョブはそのまま完了する。その進捗行は captureId を
 * キーにし、これはライブラリをまたいで一意なので、遅れて届く書き込みも
 * 無害に着地する。
 */
export function clearIndexQueue(): void {
  deps?.pool.clearBackground();
  queued = new Set();
  scanIds = [];
  sinceStamp = null;
  done = 0;
  total = 0;
  currentKind = null;
  emitStatus(true);
}

/** テスト専用: deps・種別・すべての状態を忘れる。 */
export function resetIndexQueueForTest(): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  kinds.clear();
  deps = null;
  queued = new Set();
  scanIds = [];
  scanning = false;
  sinceStamp = null;
  paused = false;
  done = 0;
  total = 0;
  currentKind = null;
}
