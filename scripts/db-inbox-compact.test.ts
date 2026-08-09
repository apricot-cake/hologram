// app/src/main/lib-db-inbox-compact.ts の単体テスト＝耐久性のある取込キューのコンパクション
// と、その後の DB 喪失からの復元（これは #5 St6 / #299 の受け入れ条件そのもの）:
//   - 受領記録の付いた loose イベントが 1,000 件に満たない間はコンパクションが発火しない
//   - 1,000 件に達したら1つの segment (JSON Lines・SHA-256 の名前) へ束ね、loose ファイルを
//     削除する
//   - 1,500 イベントをコンパクションした後も loose は 1,000 件未満に収まり、loose+segment を
//     空の DB へ replay すれば 1,500 件を全部再構成できる（Issue #299 の本文が述べる受け入れ条件）
//   - segment を書いた後・loose を消す前にプロセスが落ちても（オーファンの loose）、次の呼び
//     出しが安全に掃除する。受領記録はすでに残っているので、二重に数えられない

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope, inboxNewDir, inboxSegmentsDir } from '../native-host/inbox.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import { openDatabase } from '../app/src/main/lib-db';
import { drainInbox } from '../app/src/main/lib-db-inbox';
import { COMPACT_THRESHOLD, SEGMENT_EVENT_CAP, cleanOrphanedLoose, compactInbox } from '../app/src/main/lib-db-inbox-compact';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* できる範囲で片付ける */
    }
  }
});

const BASE_EPOCH = 1_700_000_000_000;
// フィクスチャのエンベロープを new/ へ直接書き、writeInboxEvent の tmp+fsync+rename と
// いう耐久性の段取りは通さない。あの段取りは inbox.test.ts が端から端まで見ているし、
// ここでイベントごとにやると（このファイル全体でおよそ 4,500 回）この一式の実行時間は
// 本物のディスクの fsync に支配される。#514 の、並行セッションでディスクが混む状況での
// 不安定なタイムアウトの実際の原因はそれであって、試したいコンパクションのロジックではない。
function seedEvents(saveFolder: string, count: number, startAt = 0) {
  fs.mkdirSync(inboxNewDir(saveFolder), { recursive: true });
  for (let i = startAt; i < startAt + count; i++) {
    const captureId = `${BASE_EPOCH + i}-aaaa`;
    const rec = normalizePostRecord({ captureId, url: `https://x.com/u/status/${i}` });
    const envelope = buildEnvelope(rec);
    fs.writeFileSync(path.join(inboxNewDir(saveFolder), `${envelope.eventId}.json`), JSON.stringify(envelope, null, 2));
  }
}
function looseCount(saveFolder: string): number {
  try {
    return fs.readdirSync(inboxNewDir(saveFolder)).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
function segmentFiles(saveFolder: string): string[] {
  try {
    return fs.readdirSync(inboxSegmentsDir(saveFolder)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
}

describe('compactInbox', () => {
  test(`${COMPACT_THRESHOLD}件未満では発火しない`, async () => {
    const saveFolder = mkTempDir('hologram-inbox-compact-under-');
    const handle = openDatabase(path.join(mkTempDir('hologram-inbox-compact-under-db-'), 'test.db'));
    await seedEvents(saveFolder, COMPACT_THRESHOLD - 1);
    drainInbox(saveFolder, handle.sqlite);

    const report = compactInbox(saveFolder, handle.sqlite);

    expect(report.compacted).toBe(false);
    expect(segmentFiles(saveFolder)).toHaveLength(0);
    expect(looseCount(saveFolder)).toBe(COMPACT_THRESHOLD - 1);
    handle.sqlite.close();
  }, 20000);

  test(`ちょうど ${SEGMENT_EVENT_CAP} 件で1 segment へ束ね、loose を削除する`, async () => {
    const saveFolder = mkTempDir('hologram-inbox-compact-exact-');
    const handle = openDatabase(path.join(mkTempDir('hologram-inbox-compact-exact-db-'), 'test.db'));
    await seedEvents(saveFolder, SEGMENT_EVENT_CAP);
    drainInbox(saveFolder, handle.sqlite);

    const report = compactInbox(saveFolder, handle.sqlite);

    expect(report).toMatchObject({ compacted: true, eventCount: SEGMENT_EVENT_CAP, looseRemoved: SEGMENT_EVENT_CAP });
    expect(segmentFiles(saveFolder)).toHaveLength(1);
    expect(looseCount(saveFolder)).toBe(0);

    // segment のファイル名は payloadSha256 と一致し、中身は JSON Lines
    const segFile = segmentFiles(saveFolder)[0];
    expect(segFile).toBe(`${report.segmentId}.jsonl`);
    const lines = fs
      .readFileSync(path.join(inboxSegmentsDir(saveFolder), segFile), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(lines).toHaveLength(SEGMENT_EVENT_CAP);
    expect(JSON.parse(lines[0])).toMatchObject({ format: 'hologram-inbox', version: 1 });

    // inbox_events.sourceSegment が埋まっている
    const row = handle.sqlite.prepare('SELECT sourceSegment FROM inbox_events WHERE eventId = ?').get(`${BASE_EPOCH}-aaaa`) as any;
    expect(row.sourceSegment).toBe(report.segmentId);
    const segRow = handle.sqlite.prepare('SELECT payloadSha256 FROM inbox_segments WHERE segmentId = ?').get(report.segmentId) as any;
    expect(segRow.payloadSha256).toBe(report.segmentId);
    handle.sqlite.close();
  }, 20000);

  test('オーファン loose（segment 発行後・削除前に落ちた想定）は次回呼び出しで一掃される', async () => {
    const saveFolder = mkTempDir('hologram-inbox-compact-orphan-');
    const handle = openDatabase(path.join(mkTempDir('hologram-inbox-compact-orphan-db-'), 'test.db'));
    await seedEvents(saveFolder, SEGMENT_EVENT_CAP);
    drainInbox(saveFolder, handle.sqlite);
    compactInbox(saveFolder, handle.sqlite); // まず通常の経路で1回コンパクションする

    // 異常終了を模す。受領記録には sourceSegment がもう入っているのに、loose ファイルを1つ蘇らせる
    const orphanCaptureId = `${BASE_EPOCH}-aaaa`;
    const rec = normalizePostRecord({ captureId: orphanCaptureId, url: `https://x.com/u/status/0` });
    fs.writeFileSync(path.join(inboxNewDir(saveFolder), `${orphanCaptureId}.json`), JSON.stringify(buildEnvelope(rec)));
    expect(looseCount(saveFolder)).toBe(1);

    const cleaned = cleanOrphanedLoose(saveFolder, handle.sqlite);

    expect(cleaned).toBe(1);
    expect(looseCount(saveFolder)).toBe(0);
    handle.sqlite.close();
  }, 20000);
});

describe('1,500 event: コンパクション後の loose 上限と、空 DB への完全復元', () => {
  let saveFolder: string;
  let compactedSegmentId: string;

  beforeAll(async () => {
    saveFolder = mkTempDir('hologram-inbox-1500-');
    const handle = openDatabase(path.join(mkTempDir('hologram-inbox-1500-db-'), 'test.db'));
    await seedEvents(saveFolder, 1500);
    const drainReport = drainInbox(saveFolder, handle.sqlite);
    expect(drainReport.applied).toHaveLength(1500);

    const compactReport = compactInbox(saveFolder, handle.sqlite);
    expect(compactReport.compacted).toBe(true);
    compactedSegmentId = compactReport.segmentId as string;
    handle.sqlite.close();
  }, 30000);

  test('loose は 1,000 件未満になる（design の "未処理/異常分 + 999件" 上限）', () => {
    expect(looseCount(saveFolder)).toBe(500);
    expect(segmentFiles(saveFolder)).toEqual([`${compactedSegmentId}.jsonl`]);
  });

  test('空 DB へ loose+segment を replay すると 1,500 件を完全に再構成できる', () => {
    const freshHandle = openDatabase(path.join(mkTempDir('hologram-inbox-1500-restore-db-'), 'test.db'));

    const report = drainInbox(saveFolder, freshHandle.sqlite);

    expect(report.segmentsReplayed).toEqual([compactedSegmentId]);
    expect(report.applied.length + report.receiptOnly.length).toBe(1500);
    const dbCount = (freshHandle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get() as any).n;
    expect(dbCount).toBe(1500);
    // 本文と投稿者が保たれたまま再構成されることを、1レコードを抜き取って確かめる
    const sample = freshHandle.sqlite.prepare('SELECT url FROM posts WHERE captureId = ?').get(`${BASE_EPOCH}-aaaa`) as any;
    expect(sample.url).toBe('https://x.com/u/status/0');

    freshHandle.sqlite.close();
  }, 20000);

  test('replay 済みの DB へ再度 drain しても増殖しない（segment receipt を見て中身を開かない）', () => {
    const handle = openDatabase(path.join(mkTempDir('hologram-inbox-1500-idempotent-db-'), 'test.db'));
    drainInbox(saveFolder, handle.sqlite);

    const report2 = drainInbox(saveFolder, handle.sqlite);

    expect(report2.segmentsReplayed).toEqual([]); // 受領記録がすでに在るので開かない
    expect(report2.applied).toEqual([]);
    const dbCount = (handle.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get() as any).n;
    expect(dbCount).toBe(1500);
    handle.sqlite.close();
  }, 20000);
});
