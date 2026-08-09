// app/src/main/lib-index-queue.ts の単体テスト(#834、親は #98)＝状態機械を、
// 偽の依存の上で端から端まで動かす(このモジュールは意図して Electron に依存しないので、
// アプリは要らない)。
//
// ここで固定するのは、#834 の受け入れ条件のうちキュー側のもの:
//
//   - 保存は、動いたレコードだけのジョブを積む
//   - 途中で中断したバックフィルは derived_progress から再開し、終わった分を
//     やり直さない(カーソルを持たない理由そのもの)
//   - pause でキューが止まり、resume で続く
//   - AI 機能が切れていれば requiresModel のジョブは一切積まれない
//   - ツールバーが描くステータスに以上すべてが映る

import { afterEach, describe, expect, test } from 'vitest';
import { createJobPool } from '../app/src/main/lib-job-pool';
import type { IndexJobKind, IndexProgressRow, IndexRecord } from '../app/src/main/lib-index-jobs';
import { indexQueueStatus, notifyRecordsChanged, pauseIndexQueue, registerIndexJobKind, requestBackfill, resetIndexQueueForTest, resumeIndexQueue, startIndexQueue, type IndexProgressWrite } from '../app/src/main/lib-index-queue';

afterEach(() => resetIndexQueueForTest());

/** プールの setImmediate による段取りを進めながら、`pred` が成り立つまで待つ。 */
async function until(pred: () => boolean, label = 'condition') {
  for (let i = 0; i < 2000; i++) {
    if (pred()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface Harness {
  ran: string[];
  progress: Map<string, IndexProgressRow>;
  writes: IndexProgressWrite[];
  errors: string[];
  statuses: ReturnType<typeof indexQueueStatus>[];
  aiEnabled: boolean;
  records: IndexRecord[];
}

function makeRecords(n: number, from = 0): IndexRecord[] {
  return Array.from({ length: n }, (_, i) => ({ captureId: `cap${from + i}`, assetClass: 'media', trashedAt: null, image: `cap${from + i}.jpg`, updatedAt: `2026-08-04T00:00:0${from + i}.000Z` }) as IndexRecord & { updatedAt: string });
}

function start(records: IndexRecord[], opts: { aiEnabled?: boolean; progress?: Map<string, IndexProgressRow>; resolveInFolder?: (name: string) => string | null } = {}): Harness {
  const h: Harness = { ran: [], progress: opts.progress ?? new Map(), writes: [], errors: [], statuses: [], aiEnabled: opts.aiEnabled ?? false, records };
  startIndexQueue({
    pool: createJobPool({ concurrency: 2, backgroundConcurrency: 1 }),
    aiEnabled: () => h.aiEnabled,
    listCaptureIds: (since) => {
      const rows = h.records.filter((r) => !r.trashedAt && (!since || String((r as { updatedAt?: string }).updatedAt) > since));
      const stamps = rows.map((r) => String((r as { updatedAt?: string }).updatedAt ?? ''));
      return { ids: rows.map((r) => r.captureId), maxUpdatedAt: stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null };
    },
    recordsByIds: (ids) => h.records.filter((r) => ids.includes(r.captureId)),
    progressOf: (captureId, assetRef, jobKind) => h.progress.get(`${captureId} ${assetRef} ${jobKind}`),
    saveProgress: (row) => {
      h.writes.push(row);
      h.progress.set(`${row.captureId} ${row.assetRef} ${row.jobKind}`, { indexedSegments: row.indexedSegments, totalSegments: row.totalSegments });
    },
    resolve: {
      resolveInFolder: opts.resolveInFolder ?? ((name) => `/library/${name}`),
      stat: async () => ({ size: 10 }),
      readFile: async () => Buffer.from('bytes'),
      thumbnail: async () => Buffer.from('jpeg'),
    },
    onJobError: (candidate, err) => h.errors.push(`${candidate.record.captureId}:${(err as Error).message}`),
    onStatusChange: (s) => h.statuses.push(s),
  });
  return h;
}

function recordingKind(h: Harness, over: Partial<IndexJobKind> = {}): IndexJobKind {
  return {
    id: 'test',
    inputKind: 'sourceBytes',
    requiresModel: false,
    maxSegments: 10,
    maxInputBytes: 1024,
    accepts: () => true,
    run: async (_input, ctx) => {
      h.ran.push(ctx.record.captureId);
      return { indexedSegments: 1, totalSegments: 1 };
    },
    ...over,
  };
}

describe('ジョブ種別の登録が無ければ何も走らない', () => {
  test('機能(#48/#49/#50/#51)が登録するまで、器は動かない', async () => {
    const h = start(makeRecords(3));
    await until(() => !indexQueueStatus().active, 'the scan to finish');
    expect(h.ran).toEqual([]);
    expect(h.writes).toEqual([]);
  });
});

describe('バックフィル', () => {
  test('ライブラリを一巡し、アセットごとにどこまで進んだかを記録する', async () => {
    const h = start(makeRecords(3));
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => h.ran.length === 3, 'three jobs to run');
    expect(new Set(h.ran)).toEqual(new Set(['cap0', 'cap1', 'cap2']));
    expect(h.writes[0]).toMatchObject({ assetRef: 'image', jobKind: 'test', indexedSegments: 1, totalSegments: 1, modelId: null, modelRev: null });
  });

  test('やり直さず derived_progress から再開する(カーソルは持たない)', async () => {
    // 3件のうち2件は前回の実行で終わっている。再起動をまたいで残るのは、その
    // 進捗行だけ。
    const progress = new Map<string, IndexProgressRow>([
      ['cap0 image test', { indexedSegments: 1, totalSegments: 1 }],
      ['cap1 image test', { indexedSegments: 1, totalSegments: 1 }],
    ]);
    const h = start(makeRecords(3), { progress });
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => !indexQueueStatus().active && h.ran.length > 0, 'the remaining job');
    expect(h.ran).toEqual(['cap2']);
  });

  test('中断したアセットは、最後に索引を張ったセグメントから続ける', async () => {
    const progress = new Map<string, IndexProgressRow>([['cap0 image test', { indexedSegments: 4, totalSegments: 9 }]]);
    const h = start(makeRecords(1), { progress });
    const seen: number[] = [];
    registerIndexJobKind(
      recordingKind(h, {
        maxSegments: 9,
        run: async (_input, ctx) => {
          seen.push(ctx.fromSegment);
          return { indexedSegments: 9, totalSegments: 9 };
        },
      }),
    );
    requestBackfill({ full: true });
    await until(() => seen.length === 1, 'the resumed job');
    expect(seen).toEqual([4]);
  });

  test('解決に失敗したら進捗を書かない＝覚え込まず、次にまた試す', async () => {
    // ファイルがディスクから消えている。何も記録しない。入力が無いのはファイル
    // についての事実であって結果ではないし、「失敗」の印を残すと、ファイルが
    // 戻ってきた後もそのレコードが外れたままになる。
    const h = start(makeRecords(2), { resolveInFolder: () => null });
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => !indexQueueStatus().active && indexQueueStatus().total === 0, 'the pass to finish');
    expect(h.writes).toEqual([]);
    expect(h.ran).toEqual([]);
    expect(h.errors).toEqual([]); // エラーでもない＝やることが無いだけ
  });

  test('例外を投げたジョブは報告され、進捗行を残さない', async () => {
    const h = start(makeRecords(1));
    registerIndexJobKind(
      recordingKind(h, {
        run: async () => {
          throw new Error('kaboom');
        },
      }),
    );
    requestBackfill({ full: true });
    await until(() => h.errors.length === 1, 'the failure to be reported');
    expect(h.errors).toEqual(['cap0:kaboom']);
    expect(h.writes).toEqual([]);
  });
});

describe('保存差分のフック', () => {
  test('変更があると、動いたレコードだけを積む', async () => {
    const h = start(makeRecords(2));
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => h.ran.length === 2, 'the initial pass');

    h.records.push(...makeRecords(1, 9)); // cap9。updatedAt はより後
    notifyRecordsChanged();
    await until(() => h.ran.length === 3, 'the new record');
    expect(h.ran[2]).toBe('cap9');
  });
});

describe('#830 の明示的な有効化ゲート', () => {
  test('AI 機能が切れている間は requiresModel のジョブが積まれず、入れると現れる', async () => {
    const h = start(makeRecords(2), { aiEnabled: false });
    registerIndexJobKind(recordingKind(h, { id: 'ocr', requiresModel: true }));
    registerIndexJobKind(
      recordingKind(h, {
        id: 'text',
        requiresModel: false,
        run: async (_i, ctx) => {
          h.ran.push(`text:${ctx.record.captureId}`);
          return { indexedSegments: 1, totalSegments: 1 };
        },
      }),
    );
    requestBackfill({ full: true });
    await until(() => h.ran.length === 2, 'the non-model jobs');
    expect(h.ran.every((r) => r.startsWith('text:'))).toBe(true);
    expect(h.writes.some((w) => w.jobKind === 'ocr')).toBe(false);

    h.aiEnabled = true;
    requestBackfill({ full: true });
    await until(() => h.writes.filter((w) => w.jobKind === 'ocr').length === 2, 'the model jobs after opt-in');
    expect(
      h.writes
        .filter((w) => w.jobKind === 'ocr')
        .map((w) => w.captureId)
        .sort(),
    ).toEqual(['cap0', 'cap1']);
  });
});

describe('一時停止と再開', () => {
  test('pause はその場でキューを止め、resume が最後まで走らせる', async () => {
    const h = start(makeRecords(6));
    registerIndexJobKind(
      recordingKind(h, {
        run: async (_i, ctx) => {
          h.ran.push(ctx.record.captureId);
          if (h.ran.length === 1) pauseIndexQueue();
          return { indexedSegments: 1, totalSegments: 1 };
        },
      }),
    );
    requestBackfill({ full: true });
    await until(() => indexQueueStatus().paused, 'the pause to take effect');
    const stoppedAt = h.ran.length;
    // プールに何度か手番を渡す。止めたキューが他の何かを始めてはいけない。
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.ran.length).toBe(stoppedAt);
    expect(indexQueueStatus()).toMatchObject({ paused: true, active: true });
    // 一時停止はまとめ待ちの窓を待たず、すぐレンダラーへ見える。反応が無いように
    // 見える操作子は、誰にも信用されない。
    expect(h.statuses.at(-1)).toMatchObject({ paused: true });

    resumeIndexQueue();
    await until(() => h.ran.length === 6, 'the rest of the library');
    expect(indexQueueStatus().paused).toBe(false);
  });
});

describe('ステータス', () => {
  test('仕事の間は active になり、終われば idle へ落ち着く', async () => {
    const h = start(makeRecords(3));
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    expect(indexQueueStatus().active).toBe(true);
    await until(() => h.ran.length === 3, 'the jobs');
    await until(() => !indexQueueStatus().active, 'the queue to settle');
    expect(indexQueueStatus()).toMatchObject({ active: false, scanning: false, done: 0, total: 0, currentKind: null });
  });

  test('作業中の種別と、走査の間は増える一方の total を報告する', async () => {
    const h = start(makeRecords(3));
    registerIndexJobKind(recordingKind(h, { id: 'colour' }));
    requestBackfill({ full: true });
    await until(() => indexQueueStatus().currentKind === 'colour', 'the current kind');
    await until(() => !indexQueueStatus().active, 'the queue to settle');
    const totals = h.statuses.map((s) => s.total).filter((t) => t > 0);
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
  });
});
