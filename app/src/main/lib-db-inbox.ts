'use strict';

// The durable intake queue's consumer (#5 St6 / #299): applies inbox
// envelopes into the DB, exactly once each, inside one SQLite transaction per
// event — post + media + post_tags + FTS + an inbox_events receipt commit
// together, so a mid-apply crash leaves NEITHER the post nor the receipt (the
// source file is simply retried on the next drain).
//
// Two sources feed the same apply logic:
//   - .hologram-inbox/new/*.json — loose envelopes (native-host/inbox.mts's
//     writeInboxEvent output), the normal steady-state path.
//   - .hologram-inbox/segments/*.jsonl — compacted bundles
//     (lib-db-inbox-compact.ts's output). A segment whose inbox_segments
//     receipt already exists is skipped WITHOUT opening it (the normal case
//     once the DB is healthy); one with no receipt is replayed line-by-line —
//     the DB-loss recovery path (#299 acceptance criterion: "can reconstruct
//     1,500 items via loose+segment replay to an empty DB"), since segments hold the
//     bulk of an established library's history once compaction has run.
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in
// plain node, mirroring lib-db-import.ts. Loose files are never deleted here
// — the inbox is retained after import (#299 design comment, "retention") as the
// replay source; compaction into segments (lib-db-inbox-compact.ts) is the
// only thing that ever removes a loose file, and only once its content is
// durably folded into a verified segment.
//
// Idempotency and conflict rules are #299's confirmed design (2026-07-25
// comment, "app-side consumer and idempotency"):
//   - a receipt for this eventId+hash already exists: no-op (already applied).
//   - a receipt for this eventId exists with a DIFFERENT hash: conflict,
//     report, leave both the existing post and the file alone.
//   - no receipt, and no posts row for this captureId: full insert.
//   - no receipt, and a posts row for this captureId already exists (e.g. a
//     DB restore re-derived it some other way before this replay ran): add
//     the receipt ONLY if the URL and every claimed media filename match the
//     existing row — never overwrite an existing post from a replay. A
//     mismatch is a conflict, reported and left untouched.
//   - the record's required media (image/video/media[].file) is missing from
//     saveFolder, or any filename escapes the folder: skip WITHOUT a receipt
//     (retried on the next drain — useful when a sync client is still
//     catching media up), report the reason, and keep going with other files.
//   - the apply throws anything else at all (#920): skip it the same way, and
//     QUARANTINE the envelope into .hologram-inbox/failed/. The rules above
//     enumerate the failures we predicted; this one catches the rest, because
//     "one envelope stops the whole intake" is the failure that hurts — the
//     posts queued behind it never appear and every later drain dies on the
//     same file, so the library simply looks empty. Quarantining (rather than
//     leaving it in new/) is what makes the skip stick: the poison is not
//     re-read next drain, so the log records it once instead of every pass.
//     The exception's type is never inspected — the point is to survive the
//     failures we did NOT foresee, and a type allowlist would leave the same
//     hole open for the next one.

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { SAFE_EVENT_ID, inboxFailedDir, inboxNewDir, inboxSegmentsDir, parseInboxEnvelope } from '../../../native-host/inbox.mts';
import type { InboxEnvelope } from '../../../native-host/inbox.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';

export interface InboxDrainReport {
  scanned: number; // envelopes looked at this call (loose + replayed segment lines)
  applied: string[]; // eventIds newly written to posts (fresh inserts)
  receiptOnly: string[]; // eventIds where only a receipt was added (post already existed and matched)
  noop: number; // already-applied (matching receipt) — no DB write
  skipped: Array<{ file: string; reason: string; detail?: string }>;
  segmentsReplayed: string[]; // segmentIds opened this call (no receipt yet — the DB-loss path)
}

// The record's own display artifacts — what a viewer needs to show this post
// at all. avatarFile is deliberately excluded: it is best-effort everywhere
// else in the codebase (bridge.cts's download, the legacy ZIP import), and its absence
// already degrades gracefully (the viewer hides a missing avatar) rather than
// blocking the post.
function requiredMediaFiles(record: PostRecordShape): string[] {
  const files: string[] = [];
  if (record.image) files.push(record.image);
  if (record.video) files.push(record.video);
  for (const m of record.media) if (m.file) files.push(m.file);
  return files;
}

// null = every required file is present and contained; otherwise the reason.
function missingMediaReason(saveFolder: string, record: PostRecordShape): string | null {
  for (const name of requiredMediaFiles(record)) {
    const resolved = resolveInSaveFolder(saveFolder, name);
    if (!resolved) return `media path escapes save folder: ${name}`;
    if (!fs.existsSync(resolved)) return `missing media: ${name}`;
  }
  return null;
}

function ownedMediaSet(record: PostRecordShape): Set<string> {
  const files = new Set<string>();
  if (record.image) files.add(record.image);
  if (record.video) files.add(record.video);
  for (const m of record.media) if (m.file) files.add(m.file);
  return files;
}

interface ExistingPostRow {
  url: string | null;
  image: string | null;
  video: string | null;
}

// "Same post" for the receipt-only path: same URL, and the exact same set of
// media files claimed. Anything looser risks silently attaching a replayed
// event's receipt to an unrelated post that happens to share a captureId.
function existingMatches(existing: ExistingPostRow, existingMediaFiles: string[], envelope: InboxEnvelope): boolean {
  if ((existing.url || null) !== (envelope.record.url || null)) return false;
  const existingOwned = new Set<string>(existingMediaFiles);
  if (existing.image) existingOwned.add(existing.image);
  if (existing.video) existingOwned.add(existing.video);
  const claimed = ownedMediaSet(envelope.record);
  if (existingOwned.size !== claimed.size) return false;
  for (const f of claimed) if (!existingOwned.has(f)) return false;
  return true;
}

// Shared prepared-statement bundle both the loose and segment-replay loops
// use, so there is exactly one place that knows how to apply ONE envelope.
interface InboxApplyCtx {
  saveFolder: string;
  sqlite: Database.Database;
  stmts: ReturnType<typeof preparePostStmts>;
  resolveTagId: (name: string) => number;
  selectReceipt: Database.Statement;
  insertReceipt: Database.Statement;
  selectExistingPost: Database.Statement;
  selectExistingMedia: Database.Statement;
}

function makeApplyCtx(saveFolder: string, sqlite: Database.Database): InboxApplyCtx {
  return {
    saveFolder,
    sqlite,
    stmts: preparePostStmts(sqlite),
    resolveTagId: makeTagResolver(sqlite),
    selectReceipt: sqlite.prepare('SELECT payloadSha256, importedAt FROM inbox_events WHERE eventId = ?'),
    insertReceipt: sqlite.prepare('INSERT INTO inbox_events (eventId, captureId, payloadSha256, importedAt, sourceSegment) VALUES (?,?,?,?,?)'),
    selectExistingPost: sqlite.prepare('SELECT url, image, video FROM posts WHERE captureId = ?'),
    selectExistingMedia: sqlite.prepare('SELECT file FROM media WHERE postId = ?'),
  };
}

type ApplyOutcome = 'applied' | 'receiptOnly' | 'noop' | { skipped: { reason: string; detail?: string } };

// Applies ONE already-parsed envelope. sourceSegment is the segment's id when
// called from replaySegments, NULL for a loose event not yet compacted —
// recorded on the receipt so a later compaction knows which loose files are
// already folded into a segment (lib-db-inbox-compact.ts's ORDER BY eventId
// WHERE sourceSegment IS NULL scan).
function applyEnvelope(ctx: InboxApplyCtx, envelope: InboxEnvelope, sourceSegment: string | null): ApplyOutcome {
  const receipt = ctx.selectReceipt.get(envelope.eventId) as { payloadSha256: string } | undefined;
  if (receipt) {
    if (receipt.payloadSha256 === envelope.payloadSha256) return 'noop';
    return { skipped: { reason: 'hash-conflict', detail: `eventId ${envelope.eventId} already applied with a different payload` } };
  }

  const missing = missingMediaReason(ctx.saveFolder, envelope.record);
  if (missing) return { skipped: { reason: 'missing-media', detail: missing } };

  const now = new Date().toISOString();
  const existing = ctx.selectExistingPost.get(envelope.eventId) as ExistingPostRow | undefined;
  if (existing) {
    const existingMediaFiles = (ctx.selectExistingMedia.all(envelope.eventId) as Array<{ file: string }>).map((r) => r.file);
    if (!existingMatches(existing, existingMediaFiles, envelope)) {
      return { skipped: { reason: 'post-conflict', detail: `captureId ${envelope.eventId} already exists with a different URL/media` } };
    }
    ctx.sqlite.exec('BEGIN');
    try {
      ctx.insertReceipt.run(envelope.eventId, envelope.record.captureId, envelope.payloadSha256, now, sourceSegment);
      ctx.sqlite.exec('COMMIT');
    } catch (err) {
      ctx.sqlite.exec('ROLLBACK');
      throw err;
    }
    return 'receiptOnly';
  }

  ctx.sqlite.exec('BEGIN');
  try {
    writePost(ctx.stmts, ctx.resolveTagId, fillMediaDims(ctx.saveFolder, fillCardDims(ctx.saveFolder, envelope.record)));
    ctx.insertReceipt.run(envelope.eventId, envelope.record.captureId, envelope.payloadSha256, now, sourceSegment);
    ctx.sqlite.exec('COMMIT');
  } catch (err) {
    ctx.sqlite.exec('ROLLBACK');
    throw err;
  }
  return 'applied';
}

// applyEnvelope, but an unexpected throw becomes a skip instead of taking the
// whole drain down with it (#920). `quarantine` runs on exactly that path — it
// is what makes the skip stick (the envelope leaves new/, so the next drain
// does not read it again) and returns the note appended to the report's detail.
function applyEnvelopeIsolated(ctx: InboxApplyCtx, envelope: InboxEnvelope, sourceSegment: string | null, quarantine: () => string): ApplyOutcome {
  try {
    return applyEnvelope(ctx, envelope, sourceSegment);
  } catch (err: any) {
    // applyEnvelope rolls its own transaction back, but a throw from the
    // ROLLBACK itself would leave the connection inside a transaction — and
    // then every LATER envelope fails too, which is exactly the "one bad file
    // stops the rest" this isolation exists to prevent.
    if (ctx.sqlite.inTransaction) {
      try {
        ctx.sqlite.exec('ROLLBACK');
      } catch {
        /* nothing left to undo */
      }
    }
    return { skipped: { reason: 'apply-failed', detail: `${err?.message || String(err)} (${quarantine()})` } };
  }
}

// A free name under failed/. A second failure of the same eventId means the
// file was rewritten between drains, so both sets of bytes are evidence —
// renaming over the first one would throw the earlier evidence away.
function freeFailedPath(saveFolder: string, name: string): string {
  const base = path.join(inboxFailedDir(saveFolder), name);
  if (!fs.existsSync(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}.${n}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  return `${base}.${Date.now()}`;
}

// Moves a poison loose envelope out of new/, keeping its bytes (a failed
// envelope is saved content that never reached the DB — it is moved, never
// deleted). Returns a note for the report's detail; a quarantine that itself
// fails is reported too, since then the next drain WILL read the file again.
function quarantineLoose(saveFolder: string, name: string): string {
  try {
    fs.mkdirSync(inboxFailedDir(saveFolder), { recursive: true });
    const dest = freeFailedPath(saveFolder, name);
    fs.renameSync(path.join(inboxNewDir(saveFolder), name), dest);
    return `moved to failed/${path.basename(dest)}`;
  } catch (err: any) {
    return `quarantine failed: ${err?.message || String(err)}`;
  }
}

// The segment equivalent: a line cannot be moved out of its bundle, and the
// segment's receipt is written once the pass is done, so the failing envelope
// is copied into failed/ to stay retryable and diagnosable on its own. The
// segment file itself is untouched — it is the replay source for a DB loss.
function quarantineSegmentLine(saveFolder: string, eventId: string, line: string): string {
  try {
    fs.mkdirSync(inboxFailedDir(saveFolder), { recursive: true });
    const dest = freeFailedPath(saveFolder, `${eventId}.json`);
    fs.writeFileSync(dest, line);
    return `copied to failed/${path.basename(dest)}`;
  } catch (err: any) {
    return `quarantine failed: ${err?.message || String(err)}`;
  }
}

function recordOutcome(report: InboxDrainReport, file: string, outcome: ApplyOutcome, eventId: string) {
  if (outcome === 'noop') report.noop++;
  else if (outcome === 'applied') report.applied.push(eventId);
  else if (outcome === 'receiptOnly') report.receiptOnly.push(eventId);
  else report.skipped.push({ file, reason: outcome.skipped.reason, detail: outcome.skipped.detail });
}

// Replays any segment whose inbox_segments receipt is missing — normally
// none (a healthy DB already has every segment's receipt, so this is one
// indexed lookup per segment file and nothing more); after a DB loss, every
// segment, oldest first by filename (segment ids are content hashes, not
// time-ordered, but application order does not matter — each line is
// independently idempotent). The segment's OWN receipt is committed only
// after every line in it has been applied, so a crash mid-replay just
// re-replays the same segment next time (each line's own receipt makes that
// a no-op sweep, not re-work).
function replaySegments(ctx: InboxApplyCtx, report: InboxDrainReport) {
  const dir = inboxSegmentsDir(ctx.saveFolder);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return; // no segments yet
  }
  const selectSegmentReceipt = ctx.sqlite.prepare('SELECT 1 FROM inbox_segments WHERE segmentId = ?');
  const insertSegmentReceipt = ctx.sqlite.prepare('INSERT OR IGNORE INTO inbox_segments (segmentId, payloadSha256, importedAt) VALUES (?,?,?)');

  for (const f of files.filter((f) => f.toLowerCase().endsWith('.jsonl')).sort()) {
    const segmentId = f.slice(0, -'.jsonl'.length);
    if (selectSegmentReceipt.get(segmentId)) continue; // already replayed — never opened

    report.segmentsReplayed.push(segmentId);
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), 'utf8');
    } catch (err: any) {
      report.skipped.push({ file: f, reason: 'unreadable', detail: err?.message });
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      report.scanned++;
      const parsed = parseInboxEnvelope(line);
      if (!parsed.ok) {
        report.skipped.push({ file: f, reason: parsed.reason, detail: parsed.detail });
        continue;
      }
      const outcome = applyEnvelopeIsolated(ctx, parsed.envelope, segmentId, () => quarantineSegmentLine(ctx.saveFolder, parsed.envelope.eventId, line));
      recordOutcome(report, f, outcome, parsed.envelope.eventId);
    }
    insertSegmentReceipt.run(segmentId, segmentId, new Date().toISOString());
  }
}

// True when the file is provably covered by a receipt that is newer than the
// file itself — the drain can then count it as already applied WITHOUT opening
// it. The file name is the eventId (native-host/inbox.mts writes
// new/<eventId>.json), so the receipt can be found before any read.
//
// The mtime comparison is what keeps the hash-conflict contract: a receipt says
// "this eventId was imported at T", not "the bytes on disk are still the ones
// that were imported". A file rewritten after T is read in full and goes down
// the normal path, which is where a differing payload is reported. Only a file
// that has not been touched since its own import is taken on the receipt's word.
// stat() is metadata-only and ~12x cheaper than read + SHA-256 on a cold file
// cache (measured on ~1,000 envelopes), and the drain never reads what it does
// not have to.
function receiptCoversUntouchedFile(ctx: InboxApplyCtx, dir: string, name: string): boolean {
  const eventId = name.slice(0, -'.json'.length);
  // Anything not shaped like one of our event ids is left to the reader, so a
  // stray file still gets its reason reported instead of vanishing from the report.
  if (!SAFE_EVENT_ID.test(eventId)) return false;
  const receipt = ctx.selectReceipt.get(eventId) as { payloadSha256: string; importedAt: string } | undefined;
  if (!receipt) return false;
  const importedAt = Date.parse(receipt.importedAt || '');
  if (!Number.isFinite(importedAt)) return false;
  try {
    return fs.statSync(path.join(dir, name)).mtimeMs <= importedAt;
  } catch {
    return false; // unreadable metadata — fall through and let the read report it
  }
}

// Applies every loose envelope in .hologram-inbox/new not yet receipted.
//
// Already-imported envelopes are skipped on their receipt alone (see above).
// They are the overwhelming majority: loose files are RETAINED after import as
// the replay source (this module's header), so without the skip every drain
// re-read and re-hashed the entire retained archive — and drainInbox runs on the
// critical path of the first post list, plus on every inbox watch event. This is
// the same rule replaySegments already applies to segments ("already replayed —
// never opened"); the loose path simply never had it.
function drainLoose(ctx: InboxApplyCtx, report: InboxDrainReport) {
  const dir = inboxNewDir(ctx.saveFolder);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return; // no inbox yet — nothing has ever been saved through it
  }
  for (const name of files.filter((f) => f.toLowerCase().endsWith('.json')).sort()) {
    report.scanned++;
    if (receiptCoversUntouchedFile(ctx, dir, name)) {
      report.noop++;
      continue;
    }
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch (err: any) {
      report.skipped.push({ file: name, reason: 'unreadable', detail: err?.message });
      continue;
    }
    const parsed = parseInboxEnvelope(raw);
    if (!parsed.ok) {
      report.skipped.push({ file: name, reason: parsed.reason, detail: parsed.detail });
      continue;
    }
    const outcome = applyEnvelopeIsolated(ctx, parsed.envelope, null, () => quarantineLoose(ctx.saveFolder, name));
    recordOutcome(report, name, outcome, parsed.envelope.eventId);
  }
}

// Replays any unreceipted segments, THEN drains loose envelopes. Safe to call
// repeatedly (at startup, on watch events, on overflow reconcile) —
// already-applied events cost one indexed SELECT each and nothing else.
function drainInbox(saveFolder: string, sqlite: Database.Database): InboxDrainReport {
  const report: InboxDrainReport = { scanned: 0, applied: [], receiptOnly: [], noop: 0, skipped: [], segmentsReplayed: [] };
  const ctx = makeApplyCtx(saveFolder, sqlite);
  replaySegments(ctx, report);
  drainLoose(ctx, report);
  return report;
}

export { drainInbox, missingMediaReason };
