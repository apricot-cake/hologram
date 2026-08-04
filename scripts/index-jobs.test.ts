// Unit tests for app/src/main/lib-index-jobs.ts (#834, parent #98) — the
// judgement half of the Issue.
//
// #98's 2026-08-02 comment §6 names exactly this as what to pin in units: "ユニット
// で固定するのは「レコード×ジョブ種→実行するか」の判定表". Between planRecord (what
// can be decided from the row) and resolveInput (what needs the filesystem), these
// cover #834's acceptance criteria on the input side:
//
//   - no requiresModel job is queued while the #830 opt-in is off, and non-model
//     jobs are queued regardless;
//   - archives, trashed records, zero-byte files and oversize files never run;
//   - a partially indexed asset resumes, a finished one does not re-run, and one
//     stopped at the kind's cap is not retried until asked.

import { describe, expect, test } from 'vitest';
import { assetsOfRecord, isArchiveName, planRecord, resolveInput, type IndexAsset, type IndexJobKind, type IndexProgressRow, type IndexRecord, type ResolveInputDeps } from '../app/src/main/lib-index-jobs';

function kind(over: Partial<IndexJobKind> = {}): IndexJobKind {
  return {
    id: 'test',
    inputKind: 'sourceBytes',
    requiresModel: false,
    maxSegments: 10,
    maxInputBytes: 1024,
    accepts: () => true,
    run: async () => ({ indexedSegments: 1, totalSegments: 1 }),
    ...over,
  };
}

function record(over: Partial<IndexRecord> = {}): IndexRecord {
  return { captureId: 'cap1', assetClass: 'media', trashedAt: null, image: 'cap1.jpg', ...over };
}

/** planRecord env with no progress rows unless `rows` says otherwise. */
function env(aiEnabled: boolean, rows: Record<string, IndexProgressRow> = {}, includeCapped = false) {
  return {
    aiEnabled,
    includeCapped,
    progressOf: (captureId: string, assetRef: string, jobKind: string) => rows[`${captureId} ${assetRef} ${jobKind}`],
  };
}

const reasons = (skipped: Array<{ reason: string }>) => skipped.map((s) => s.reason);

describe('assetsOfRecord', () => {
  test('names every file a record points at in #833s assetRef vocabulary', () => {
    const assets = assetsOfRecord(
      record({
        image: 'a.jpg',
        video: 'b.mp4',
        file: 'c.pdf',
        media: [
          { seq: 0, file: 'm0.png' },
          { seq: 1, file: 'm1.png' },
        ],
      }),
    );
    expect(assets.map((a) => a.ref)).toEqual(['image', 'video', 'file', 'media[0]', 'media[1]']);
    expect(assets.map((a) => a.role)).toEqual(['image', 'video', 'file', 'image', 'image']);
  });

  test('skips absent slots rather than emitting empty refs', () => {
    expect(assetsOfRecord(record({ image: null, file: 'only.pdf' })).map((a) => a.ref)).toEqual(['file']);
    expect(assetsOfRecord(record({ image: null, media: [{ seq: 0, file: null }] }))).toEqual([]);
  });
});

describe('the opt-in gate hangs on requiresModel, not on the queue (#98 §1-2)', () => {
  test('a requiresModel job is not queued while AI features are off', () => {
    const { run, skipped } = planRecord(record(), [kind({ id: 'ocr', requiresModel: true })], env(false));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['ai-disabled']);
  });

  test('a non-model job IS queued while AI features are off', () => {
    const { run } = planRecord(record({ image: null, file: 'doc.pdf' }), [kind({ id: 'text-layer', requiresModel: false })], env(false));
    expect(run.map((c) => c.jobKind)).toEqual(['text-layer']);
  });

  test('turning the gate on admits the model job without touching the other', () => {
    const kinds = [kind({ id: 'ocr', requiresModel: true }), kind({ id: 'text-layer', requiresModel: false })];
    expect(planRecord(record(), kinds, env(true)).run.map((c) => c.jobKind)).toEqual(['ocr', 'text-layer']);
  });
});

describe('what never runs (#98 §1 索引しないもの)', () => {
  test('a record in the trash', () => {
    const { run, skipped } = planRecord(record({ trashedAt: '2026-08-04T00:00:00.000Z' }), [kind()], env(true));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['trashed']);
  });

  test('an archive, for every kind, without the kind having to know', () => {
    // accepts() says yes to everything — the exclusion is structural, so a
    // future job kind cannot forget it.
    const { run, skipped } = planRecord(record({ image: null, file: 'ugoira.zip' }), [kind({ accepts: () => true })], env(true));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['archive']);
    for (const name of ['a.zip', 'a.7z', 'a.rar', 'a.tar', 'a.CBZ']) expect(isArchiveName(name)).toBe(true);
    expect(isArchiveName('a.pdf')).toBe(false);
  });

  test('an asset the kind does not accept', () => {
    const visual = kind({ id: 'colour', accepts: (a: IndexAsset) => a.role === 'image' });
    const { run, skipped } = planRecord(record({ image: null, video: 'clip.mp4' }), [visual], env(true));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['unaccepted']);
  });

  test('the target set is NOT cut by assetClass — a collected file is indexable', () => {
    const extractor = kind({ id: 'text-layer', accepts: (a: IndexAsset) => a.role === 'file' });
    const { run } = planRecord(record({ assetClass: 'file', image: null, file: 'paper.pdf' }), [extractor], env(false));
    expect(run.map((c) => c.asset.ref)).toEqual(['file']);
  });
});

describe('resumability comes from the progress row alone (#98 §3)', () => {
  test('a finished asset is not re-run', () => {
    const rows = { 'cap1 image test': { indexedSegments: 1, totalSegments: 1 } };
    const { run, skipped } = planRecord(record(), [kind()], env(true, rows));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['complete']);
  });

  test('an interrupted asset resumes from where it stopped', () => {
    const rows = { 'cap1 image test': { indexedSegments: 3, totalSegments: 12 } };
    const { run } = planRecord(record(), [kind({ maxSegments: 12 })], env(true, rows));
    expect(run).toHaveLength(1);
    expect(run[0].fromSegment).toBe(3);
  });

  test('an asset stopped at the kind cap is left alone until explicitly asked for', () => {
    // paperless-ngx's PAPERLESS_OCR_PAGES shape: the remainder stays visible as
    // indexedSegments < totalSegments, but a backfill does not keep re-deciding it.
    const rows = { 'cap1 image test': { indexedSegments: 5, totalSegments: 40 } };
    const capped = kind({ maxSegments: 5 });
    expect(reasons(planRecord(record(), [capped], env(true, rows)).skipped)).toEqual(['capped']);
    const asked = planRecord(record(), [capped], env(true, rows, true));
    expect(asked.run).toHaveLength(1);
    expect(asked.run[0].fromSegment).toBe(5);
  });

  test('an asset with no row at all starts from segment 0', () => {
    const { run } = planRecord(record(), [kind()], env(true));
    expect(run[0].fromSegment).toBe(0);
  });
});

describe('resolveInput', () => {
  function deps(over: Partial<ResolveInputDeps> = {}): ResolveInputDeps {
    return {
      resolveInFolder: (name) => `/library/${name}`,
      stat: async () => ({ size: 10 }),
      readFile: async () => Buffer.from('source-bytes'),
      thumbnail: async () => Buffer.from('jpeg'),
      ...over,
    };
  }
  const candidate = { record: record(), asset: { ref: 'image', file: 'cap1.jpg', role: 'image' as const }, jobKind: 'test', fromSegment: 0 };

  test('refuses a name that would escape the save folder', async () => {
    const r = await resolveInput(candidate, kind(), deps({ resolveInFolder: () => null }));
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });

  test('refuses a file that is no longer there', async () => {
    const r = await resolveInput(candidate, kind(), deps({ stat: async () => null }));
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });

  test('refuses a zero-byte file', async () => {
    const r = await resolveInput(candidate, kind(), deps({ stat: async () => ({ size: 0 }) }));
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });

  test('refuses an oversize file WITHOUT reading it', async () => {
    let read = false;
    const r = await resolveInput(
      candidate,
      kind({ maxInputBytes: 100 }),
      deps({
        stat: async () => ({ size: 101 }),
        readFile: async () => {
          read = true;
          return Buffer.alloc(101);
        },
      }),
    );
    expect(r).toEqual({ ok: false, reason: 'too-large' });
    expect(read).toBe(false); // the cap exists to keep this out of memory
  });

  test('a rasterImage job reads the thumbnail cache by default', async () => {
    const asked: Array<[string, number]> = [];
    const r = await resolveInput(
      candidate,
      kind({ inputKind: 'rasterImage', rasterWidth: 320 }),
      deps({
        thumbnail: async (p, w) => {
          asked.push([p, w]);
          return Buffer.from('jpeg');
        },
        readFile: async () => {
          throw new Error('a thumbCache job must not read the original');
        },
      }),
    );
    expect(asked).toEqual([['/library/cap1.jpg', 320]]);
    expect(r).toMatchObject({ ok: true, input: { kind: 'rasterImage', segment: 0, source: '/library/cap1.jpg' } });
  });

  test('an undecodable raster is a refusal, not an empty result', async () => {
    const r = await resolveInput(candidate, kind({ inputKind: 'rasterImage' }), deps({ thumbnail: async () => null }));
    expect(r).toEqual({ ok: false, reason: 'undecodable' });
  });

  test('rasterSource:original reads the full-size file (the OCR path)', async () => {
    const r = await resolveInput(
      candidate,
      kind({ inputKind: 'rasterImage', rasterSource: 'original' }),
      deps({
        thumbnail: async () => {
          throw new Error('an original-source job must not use the thumbnail cache');
        },
      }),
    );
    expect(r).toMatchObject({ ok: true, input: { kind: 'rasterImage' } });
    expect((r as { ok: true; input: { bytes: Buffer } }).input.bytes.toString()).toBe('source-bytes');
  });

  test('carries the resume point through as the input segment', async () => {
    const r = await resolveInput({ ...candidate, fromSegment: 7 }, kind(), deps());
    expect(r).toMatchObject({ ok: true, input: { segment: 7 } });
  });
});
