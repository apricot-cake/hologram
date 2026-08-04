// Unit tests for app/src/main/lib-index-queue.ts (#834, parent #98) — the state
// machine, driven end to end over fake deps (the module is Electron-free by
// design so this needs no app).
//
// What is pinned here is #834's own acceptance criteria on the queue side:
//
//   - a save enqueues jobs for the records that moved, and only those;
//   - a backfill interrupted partway resumes from derived_progress and does NOT
//     re-process what already finished (the whole reason there is no cursor);
//   - pause stops the queue and resume continues it;
//   - AI features off ⇒ no requiresModel job is ever queued;
//   - the status the toolbar draws reflects all of the above.

import { afterEach, describe, expect, test } from 'vitest';
import { createJobPool } from '../app/src/main/lib-job-pool';
import type { IndexJobKind, IndexProgressRow, IndexRecord } from '../app/src/main/lib-index-jobs';
import { indexQueueStatus, notifyRecordsChanged, pauseIndexQueue, registerIndexJobKind, requestBackfill, resetIndexQueueForTest, resumeIndexQueue, startIndexQueue, type IndexProgressWrite } from '../app/src/main/lib-index-queue';

afterEach(() => resetIndexQueueForTest());

/** Waits until `pred` holds, letting the pool's setImmediate scheduling advance. */
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

describe('nothing runs without a registered job kind', () => {
  test('the vessel is inert until a feature (#48/#49/#50/#51) registers one', async () => {
    const h = start(makeRecords(3));
    await until(() => !indexQueueStatus().active, 'the scan to finish');
    expect(h.ran).toEqual([]);
    expect(h.writes).toEqual([]);
  });
});

describe('backfill', () => {
  test('walks the library once and records how far each asset got', async () => {
    const h = start(makeRecords(3));
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => h.ran.length === 3, 'three jobs to run');
    expect(new Set(h.ran)).toEqual(new Set(['cap0', 'cap1', 'cap2']));
    expect(h.writes[0]).toMatchObject({ assetRef: 'image', jobKind: 'test', indexedSegments: 1, totalSegments: 1, modelId: null, modelRev: null });
  });

  test('resumes from derived_progress instead of re-processing (no cursor)', async () => {
    // Two of three already finished in a previous run — the only thing that
    // survived a restart is their progress rows.
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

  test('an interrupted asset picks up at its last indexed segment', async () => {
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

  test('a resolution failure writes no progress, so it is retried rather than remembered', async () => {
    // The file is gone from disk. Nothing is recorded — an absent input is a
    // fact about the file, not a result, and a "failed" marker would keep the
    // record excluded after the file came back.
    const h = start(makeRecords(2), { resolveInFolder: () => null });
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => !indexQueueStatus().active && indexQueueStatus().total === 0, 'the pass to finish');
    expect(h.writes).toEqual([]);
    expect(h.ran).toEqual([]);
    expect(h.errors).toEqual([]); // not an error either — just nothing to do
  });

  test('a throwing job is reported and leaves no progress row', async () => {
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

describe('the save-delta hook', () => {
  test('a change enqueues only the records that moved', async () => {
    const h = start(makeRecords(2));
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    await until(() => h.ran.length === 2, 'the initial pass');

    h.records.push(...makeRecords(1, 9)); // cap9, with a later updatedAt
    notifyRecordsChanged();
    await until(() => h.ran.length === 3, 'the new record');
    expect(h.ran[2]).toBe('cap9');
  });
});

describe('the #830 opt-in gate', () => {
  test('no requiresModel job is queued while AI features are off, and they appear when it is on', async () => {
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

describe('pause and resume', () => {
  test('pausing stops the queue where it is; resuming finishes it', async () => {
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
    // Give the pool several turns — a paused queue must not start anything else.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.ran.length).toBe(stoppedAt);
    expect(indexQueueStatus()).toMatchObject({ paused: true, active: true });
    // The pause is visible to the renderer immediately, not after the coalescing
    // window — a control that looks unresponsive is a control nobody trusts.
    expect(h.statuses.at(-1)).toMatchObject({ paused: true });

    resumeIndexQueue();
    await until(() => h.ran.length === 6, 'the rest of the library');
    expect(indexQueueStatus().paused).toBe(false);
  });
});

describe('status', () => {
  test('goes active while working and settles back to idle', async () => {
    const h = start(makeRecords(3));
    registerIndexJobKind(recordingKind(h));
    requestBackfill({ full: true });
    expect(indexQueueStatus().active).toBe(true);
    await until(() => h.ran.length === 3, 'the jobs');
    await until(() => !indexQueueStatus().active, 'the queue to settle');
    expect(indexQueueStatus()).toMatchObject({ active: false, scanning: false, done: 0, total: 0, currentKind: null });
  });

  test('reports the kind being worked on and a total that only grows while scanning', async () => {
    const h = start(makeRecords(3));
    registerIndexJobKind(recordingKind(h, { id: 'colour' }));
    requestBackfill({ full: true });
    await until(() => indexQueueStatus().currentKind === 'colour', 'the current kind');
    await until(() => !indexQueueStatus().active, 'the queue to settle');
    const totals = h.statuses.map((s) => s.total).filter((t) => t > 0);
    for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
  });
});
