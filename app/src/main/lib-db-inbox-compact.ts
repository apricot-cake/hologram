'use strict';

// Compacts the durable intake queue's loose, already-applied envelopes into
// append-only JSON-Lines segments (#5 St6 / #299 design comment, "retention
// volume and compaction"). Bounds the LOOSE file count (drainInbox's readdir cost,
// the mirror's per-file overhead) without ever discarding history: a segment
// is one more replay source, never a summary that could lose a field. "delete
// because it's been ingested" never happens — only a verified, receipted segment lets its
// loose members go.
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in
// plain node, mirroring lib-db-inbox.ts.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { inboxNewDir, inboxSegmentsDir, inboxTmpDir } from '../../../native-host/inbox.mts';

const SEGMENT_EVENT_CAP = 1000;
const SEGMENT_BYTE_CAP = 16 * 1024 * 1024; // 16 MiB
const COMPACT_THRESHOLD = 1000; // loose receipted events before compaction kicks in

export interface CompactReport {
  compacted: boolean;
  segmentId: string | null;
  eventCount: number;
  looseRemoved: number;
  orphanCleaned: number; // pre-existing loose files whose segment already covers them (crash recovery)
}

// Crash recovery: an event whose receipt already names a segment, but whose
// loose file is still on disk — the process died between the segment rename
// and the loose unlink (design comment: "if it crashes after segment issuance
// and before loose deletion, both remain, but the event receipt makes it a no-op").
// Safe to delete now: the
// segment write was already whole-file SHA-256 verified before its receipt
// was committed, so the loose copy is provably redundant.
function cleanOrphanedLoose(saveFolder: string, sqlite: Database.Database): number {
  const dir = inboxNewDir(saveFolder);
  const rows = sqlite.prepare('SELECT eventId FROM inbox_events WHERE sourceSegment IS NOT NULL').all() as Array<{ eventId: string }>;
  let removed = 0;
  for (const row of rows) {
    try {
      fs.unlinkSync(path.join(dir, `${row.eventId}.json`));
      removed++;
    } catch {
      /* already gone — the common case */
    }
  }
  return removed;
}

// Folds up to SEGMENT_EVENT_CAP (or SEGMENT_BYTE_CAP, whichever first) of the
// oldest not-yet-segmented, already-applied loose events into one verified
// JSON-Lines segment, then removes exactly those loose files. No-ops below
// COMPACT_THRESHOLD loose events — the design's "unprocessed/abnormal portion + 999 items" loose
// ceiling after a first compaction.
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
      continue; // loose file already gone — its DB row (post + receipt) is already durable
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      continue; // corrupt loose file — the applied post + receipt survive it either way
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
    // Whole-file verification before the segment is trusted (design comment:
    // "after whole-file SHA-256 verification, rename to the final name that includes the hash").
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

  // Only NOW — segment verified, renamed into place, and its receipt durably
  // committed — do the loose originals go. A crash between here and the last
  // unlink leaves some loose files behind; cleanOrphanedLoose sweeps them on
  // the next call.
  let looseRemoved = 0;
  for (const eventId of includedIds) {
    try {
      fs.unlinkSync(path.join(dir, `${eventId}.json`));
      looseRemoved++;
    } catch {
      /* already gone, or a future call's cleanOrphanedLoose will catch it */
    }
  }

  return { compacted: true, segmentId, eventCount: includedIds.length, looseRemoved, orphanCleaned };
}

export { compactInbox, cleanOrphanedLoose, SEGMENT_EVENT_CAP, SEGMENT_BYTE_CAP, COMPACT_THRESHOLD };
