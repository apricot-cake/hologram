// app/src/main/lib-index-jobs.ts の単体テスト (#834, 親 #98)＝この Issue の判定の側の
// 半分。
//
// #98 の 2026-08-02 コメント §6 が、ユニットで固定するものとしてまさにこれを名指しして
// いる＝「ユニットで固定するのは『レコード×ジョブ種→実行するか』の判定表」。planRecord
// （行だけで決められること）と resolveInput（ファイルシステムが要ること）の2つで、#834 の
// 受け入れ条件のうち入力側を覆う:
//
//   - #830 のオプトインが切れている間は requiresModel のジョブを1件もキューへ入れず、
//     モデルの要らないジョブはそれと関係なくキューへ入れる
//   - 書庫・ゴミ箱にあるレコード・0バイトのファイル・大きすぎるファイルは決して走らせない
//   - 途中まで索引したアセットは再開し、終わったものは走らせ直さず、ジョブ種の上限で
//     止まったものは求められるまで再試行しない

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

/** planRecord に渡す env。`rows` で指定しない限り進捗の行は1つも無い。 */
function env(aiEnabled: boolean, rows: Record<string, IndexProgressRow> = {}, includeCapped = false) {
  return {
    aiEnabled,
    includeCapped,
    progressOf: (captureId: string, assetRef: string, jobKind: string) => rows[`${captureId} ${assetRef} ${jobKind}`],
  };
}

const reasons = (skipped: Array<{ reason: string }>) => skipped.map((s) => s.reason);

describe('assetsOfRecord', () => {
  test('#833 の assetRef の語彙で、レコードが指すファイルを全部名指しする', () => {
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

  test('空いている枠は飛ばし、空の ref を出さない', () => {
    expect(assetsOfRecord(record({ image: null, file: 'only.pdf' })).map((a) => a.ref)).toEqual(['file']);
    expect(assetsOfRecord(record({ image: null, media: [{ seq: 0, file: null }] }))).toEqual([]);
  });
});

describe('オプトインのゲートは requiresModel に掛かり、キューには掛からない (#98 §1-2)', () => {
  test('AI 機能が切れている間、requiresModel のジョブはキューへ入らない', () => {
    const { run, skipped } = planRecord(record(), [kind({ id: 'ocr', requiresModel: true })], env(false));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['ai-disabled']);
  });

  test('AI 機能が切れていても、モデルの要らないジョブは必ずキューへ入る', () => {
    const { run } = planRecord(record({ image: null, file: 'doc.pdf' }), [kind({ id: 'text-layer', requiresModel: false })], env(false));
    expect(run.map((c) => c.jobKind)).toEqual(['text-layer']);
  });

  test('ゲートを開けるとモデルのジョブが通り、もう一方には影響しない', () => {
    const kinds = [kind({ id: 'ocr', requiresModel: true }), kind({ id: 'text-layer', requiresModel: false })];
    expect(planRecord(record(), kinds, env(true)).run.map((c) => c.jobKind)).toEqual(['ocr', 'text-layer']);
  });
});

describe('what never runs (#98 §1 索引しないもの)', () => {
  test('ゴミ箱にあるレコード', () => {
    const { run, skipped } = planRecord(record({ trashedAt: '2026-08-04T00:00:00.000Z' }), [kind()], env(true));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['trashed']);
  });

  test('書庫は、ジョブ種が知らなくても、どの種でも走らない', () => {
    // accepts() は何にでも yes と答える＝除外は構造の側にあるので、将来のジョブ種が
    // 忘れることはない。
    const { run, skipped } = planRecord(record({ image: null, file: 'ugoira.zip' }), [kind({ accepts: () => true })], env(true));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['archive']);
    for (const name of ['a.zip', 'a.7z', 'a.rar', 'a.tar', 'a.CBZ']) expect(isArchiveName(name)).toBe(true);
    expect(isArchiveName('a.pdf')).toBe(false);
  });

  test('そのジョブ種が受け付けないアセット', () => {
    const visual = kind({ id: 'colour', accepts: (a: IndexAsset) => a.role === 'image' });
    const { run, skipped } = planRecord(record({ image: null, video: 'clip.mp4' }), [visual], env(true));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['unaccepted']);
  });

  test('対象の集合を assetClass で削ることは一切しない＝取り込んだファイルも索引できる', () => {
    const extractor = kind({ id: 'text-layer', accepts: (a: IndexAsset) => a.role === 'file' });
    const { run } = planRecord(record({ assetClass: 'file', image: null, file: 'paper.pdf' }), [extractor], env(false));
    expect(run.map((c) => c.asset.ref)).toEqual(['file']);
  });
});

describe('再開できるかどうかは進捗の行だけで決まる (#98 §3)', () => {
  test('終わったアセットは走らせ直さない', () => {
    const rows = { 'cap1 image test': { indexedSegments: 1, totalSegments: 1 } };
    const { run, skipped } = planRecord(record(), [kind()], env(true, rows));
    expect(run).toEqual([]);
    expect(reasons(skipped)).toEqual(['complete']);
  });

  test('中断したアセットは止まった所から再開する', () => {
    const rows = { 'cap1 image test': { indexedSegments: 3, totalSegments: 12 } };
    const { run } = planRecord(record(), [kind({ maxSegments: 12 })], env(true, rows));
    expect(run).toHaveLength(1);
    expect(run[0].fromSegment).toBe(3);
  });

  test('ジョブ種の上限で止まったアセットは、明示的に求められるまで放っておく', () => {
    // paperless-ngx の PAPERLESS_OCR_PAGES と同じ形。残りは indexedSegments <
    // totalSegments として見えたままだが、埋め戻しがそれを判定し直し続けることはない。
    const rows = { 'cap1 image test': { indexedSegments: 5, totalSegments: 40 } };
    const capped = kind({ maxSegments: 5 });
    expect(reasons(planRecord(record(), [capped], env(true, rows)).skipped)).toEqual(['capped']);
    const asked = planRecord(record(), [capped], env(true, rows, true));
    expect(asked.run).toHaveLength(1);
    expect(asked.run[0].fromSegment).toBe(5);
  });

  test('行が1つも無いアセットはセグメント 0 から始まる', () => {
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

  test('保存フォルダの外へ出てしまう名前を拒む', async () => {
    const r = await resolveInput(candidate, kind(), deps({ resolveInFolder: () => null }));
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });

  test('もう存在しないファイルを拒む', async () => {
    const r = await resolveInput(candidate, kind(), deps({ stat: async () => null }));
    expect(r).toEqual({ ok: false, reason: 'missing' });
  });

  test('0バイトのファイルを拒む', async () => {
    const r = await resolveInput(candidate, kind(), deps({ stat: async () => ({ size: 0 }) }));
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });

  test('大きすぎるファイルは、一切読まずに拒む', async () => {
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
    expect(read).toBe(false); // 上限は、これをメモリへ載せないために在る
  });

  test('rasterImage のジョブは既定でサムネイルのキャッシュを読む', async () => {
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

  test('デコードできないラスタは、空の結果ではなく拒否になる', async () => {
    const r = await resolveInput(candidate, kind({ inputKind: 'rasterImage' }), deps({ thumbnail: async () => null }));
    expect(r).toEqual({ ok: false, reason: 'undecodable' });
  });

  test('rasterSource:original は原寸のファイルを読む（OCR の経路）', async () => {
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

  test('再開地点は入力のセグメントとしてそのまま渡る', async () => {
    const r = await resolveInput({ ...candidate, fromSegment: 7 }, kind(), deps());
    expect(r).toMatchObject({ ok: true, input: { segment: 7 } });
  });
});
