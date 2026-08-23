'use strict';

// 永続の取込キューにある、適用済みで loose のままのエンベロープを、追記だけの
// JSON Lines セグメントへ畳む (#5 St6 / #299 の設計コメント「保持量と圧縮」)。loose な
// ファイルの数に上限を掛ける（drainInbox の readdir の費用、バックアップ転送の
// 1ファイルあたりの負担）が、履歴は一切捨てない。セグメントは再生元が1つ増えるだけであって、欄を落とし
// うる要約ではない。「取り込んだから消す」は一切起きない＝検証を通って受領記録の付いた
// セグメントだけが、その loose なメンバーを手放させる。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）なので素の node で単体テスト
// できる。lib-db-inbox.ts に倣う。

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { inboxNewDir, inboxSegmentsDir, inboxTmpDir } from '../../../native-host/inbox.mts';

const SEGMENT_EVENT_CAP = 1000;
const SEGMENT_BYTE_CAP = 16 * 1024 * 1024; // 16 MiB
const COMPACT_THRESHOLD = 1000; // 圧縮が動き出すまでの、受領記録済みで loose なイベント数

export interface CompactReport {
  compacted: boolean;
  segmentId: string | null;
  eventCount: number;
  looseRemoved: number;
  orphanCleaned: number; // すでにセグメントが覆っているのに残っていた loose ファイル（クラッシュからの復帰）
}

// クラッシュからの復帰。受領記録がすでにセグメントを指しているのに、loose ファイルが
// まだディスクに残っているイベント＝セグメントの rename と loose の unlink の間で
// プロセスが死んだ場合（設計コメント「セグメント発行後・loose 削除前に落ちると両方
// 残るが、イベントの受領記録があるので何もしないで済む」）。ここで消して安全＝
// セグメントの書き込みは、その受領記録がコミットされる前にファイル全体を SHA-256 で
// 検証してあるので、loose の写しが冗長なのは証明できている。
function cleanOrphanedLoose(saveFolder: string, sqlite: Database.Database): number {
  const dir = inboxNewDir(saveFolder);
  const rows = sqlite.prepare('SELECT eventId FROM inbox_events WHERE sourceSegment IS NOT NULL').all() as Array<{ eventId: string }>;
  let removed = 0;
  for (const row of rows) {
    try {
      fs.unlinkSync(path.join(dir, `${row.eventId}.json`));
      removed++;
    } catch {
      /* すでに無い＝これが普通 */
    }
  }
  return removed;
}

// まだセグメント化されていない適用済みの loose イベントのうち古いものから、
// SEGMENT_EVENT_CAP 件（または SEGMENT_BYTE_CAP バイト、先に当たった方）までを検証済みの
// JSON Lines セグメント1本へ畳み、畳んだ分の loose ファイルだけを消す。loose イベントが
// COMPACT_THRESHOLD 件に満たなければ何もしない＝設計が言う、最初の圧縮のあとの loose の
// 上限「未処理・異常分＋999件」。
function compactInbox(saveFolder: string, sqlite: Database.Database, now: () => string = () => new Date().toISOString()): CompactReport {
  const orphanCleaned = cleanOrphanedLoose(saveFolder, sqlite);

  const loose = sqlite.prepare('SELECT eventId FROM inbox_events WHERE sourceSegment IS NULL ORDER BY eventId').all() as Array<{ eventId: string }>;
  if (loose.length < COMPACT_THRESHOLD) {
    return { compacted: false, segmentId: null, eventCount: 0, looseRemoved: 0, orphanCleaned };
  }

  const dir = inboxNewDir(saveFolder);
  const lines: string[] = [];
  const includedIds: string[] = [];
  let bytes = 0;
  for (const { eventId } of loose) {
    if (includedIds.length >= SEGMENT_EVENT_CAP || bytes >= SEGMENT_BYTE_CAP) break;
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, `${eventId}.json`), 'utf8');
    } catch {
      continue; // loose ファイルはすでに無い＝その DB の行（投稿と受領記録）は永続化済み
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      continue; // loose ファイルが壊れている＝どちらにせよ適用済みの投稿と受領記録は残る
    }
    const line = JSON.stringify(envelope);
    lines.push(line);
    includedIds.push(eventId);
    bytes += Buffer.byteLength(line, 'utf8') + 1;
  }

  if (!includedIds.length) {
    return { compacted: false, segmentId: null, eventCount: 0, looseRemoved: 0, orphanCleaned };
  }

  const body = `${lines.join('\n')}\n`;
  const segmentId = createHash('sha256').update(body, 'utf8').digest('hex');

  fs.mkdirSync(inboxSegmentsDir(saveFolder), { recursive: true });
  fs.mkdirSync(inboxTmpDir(saveFolder), { recursive: true });
  const finalPath = path.join(inboxSegmentsDir(saveFolder), `${segmentId}.jsonl`);
  if (!fs.existsSync(finalPath)) {
    const tmpPath = path.join(inboxTmpDir(saveFolder), `segment.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, body, { flag: 'wx', flush: true });
    // セグメントを信用する前にファイル全体を検証する（設計コメント「ファイル全体の
    // SHA-256 検証を通してから、ハッシュを含む最終名へ rename する」）。
    const verify = createHash('sha256').update(fs.readFileSync(tmpPath, 'utf8'), 'utf8').digest('hex');
    if (verify !== segmentId) {
      fs.unlinkSync(tmpPath);
      throw new Error(`inbox segment write verification failed (expected ${segmentId}, got ${verify})`);
    }
    fs.renameSync(tmpPath, finalPath);
  }

  const importedAt = now();
  const insertSegment = sqlite.prepare('INSERT OR IGNORE INTO inbox_segments (segmentId, payloadSha256, importedAt) VALUES (?,?,?)');
  const markReceipt = sqlite.prepare('UPDATE inbox_events SET sourceSegment = ? WHERE eventId = ?');
  sqlite.exec('BEGIN');
  try {
    insertSegment.run(segmentId, segmentId, importedAt);
    for (const eventId of includedIds) markReceipt.run(segmentId, eventId);
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  // loose の元ファイルが消えるのはここに来てから＝セグメントを検証し、所定の名前へ
  // rename し、その受領記録を永続的にコミットし終えたあと。ここから最後の unlink までの
  // 間に落ちると loose ファイルがいくつか残るが、次の呼び出しで cleanOrphanedLoose が
  // 掃除する。
  let looseRemoved = 0;
  for (const eventId of includedIds) {
    try {
      fs.unlinkSync(path.join(dir, `${eventId}.json`));
      looseRemoved++;
    } catch {
      /* すでに無いか、後の呼び出しの cleanOrphanedLoose が拾う */
    }
  }

  return { compacted: true, segmentId, eventCount: includedIds.length, looseRemoved, orphanCleaned };
}

export { compactInbox, cleanOrphanedLoose, SEGMENT_EVENT_CAP, SEGMENT_BYTE_CAP, COMPACT_THRESHOLD };
