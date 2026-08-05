// The durable intake queue (#5 St6 / #299): native-host writes a capture here
// instead of a sidecar JSON, and the app's main process is the only reader/
// writer of hologram.db (lib-db.ts's single-writer invariant) — it drains this
// queue into the DB at startup and on change. Confirmed design: issue #299's
// 2026-07-25 comment ("disk format" / "native-host's publishing procedure").
//
// Kept Electron-free (node builtins only) so both native-host/bridge.cts
// (CJS, via require) and app/src/main's inbox consumer (ESM) share ONE
// envelope format and ONE atomic-write implementation — the same
// cross-boundary role post-record.mts and post-key.mts already play, and the
// same reason this is .mts while its native-host siblings are .cts.
//
// Disk layout, under <saveFolder>/.hologram-inbox/:
//   tmp/       in-progress writes. Never read by the consumer or the mirror.
//   new/       one JSON envelope per capture, kept after import (the
//              "retain" the design comment requires — see the module comment
//              this file's consumer half will carry).
//   segments/  compacted JSON-Lines bundles of already-imported envelopes
//              (this file just knows the directory; segment writing is the
//              app-side consumer's job, since only it decides when 1,000
//              receipted events have accumulated).
//   failed/    envelopes whose apply threw (#920). Written only by the
//              consumer, never by a producer, and never created until the
//              first failure — so ensureInboxDirs leaves it out. Quarantining
//              is what keeps ONE poison envelope from stopping the whole
//              drain forever; the bytes are kept for diagnosis, and moving a
//              file back into new/ is how a fixed envelope is retried.

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PostRecordShape } from './post-record.mts';

const INBOX_DIRNAME = '.hologram-inbox';
const ENVELOPE_FORMAT = 'hologram-inbox';
const ENVELOPE_VERSION = 1;

// A post.capture eventId IS the record's captureId (bridge.cts's uniqueBase
// output: "<epochMillis>-<hex>", optionally suffixed "-<n>" on collision) —
// the same SAFE_ID shape bridge.cts already enforces before a capture reaches
// this module, checked again here since this module has its own callers
// (the consumer parses envelopes bridge.cts never touches).
const SAFE_EVENT_ID = /^[0-9]{1,20}-[0-9a-f]{1,8}(?:-\d+)?$/i;

interface InboxEnvelope {
  format: typeof ENVELOPE_FORMAT;
  version: typeof ENVELOPE_VERSION;
  eventId: string;
  kind: string;
  createdAt: string;
  payloadSha256: string;
  record: PostRecordShape;
}

function inboxDir(saveFolder: string): string {
  return path.join(saveFolder, INBOX_DIRNAME);
}
function inboxTmpDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'tmp');
}
function inboxNewDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'new');
}
function inboxSegmentsDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'segments');
}
function inboxFailedDir(saveFolder: string): string {
  return path.join(inboxDir(saveFolder), 'failed');
}

// Called before the first write of a session (and safe to call every time —
// mkdir recursive is a no-op once the tree exists). tmp/new/segments are
// siblings under ONE parent so tmp->new renames stay on the same filesystem
// (cross-filesystem rename is not atomic — the whole point of the tmp+rename
// pattern).
function ensureInboxDirs(saveFolder: string): void {
  fs.mkdirSync(inboxTmpDir(saveFolder), { recursive: true });
  fs.mkdirSync(inboxNewDir(saveFolder), { recursive: true });
  fs.mkdirSync(inboxSegmentsDir(saveFolder), { recursive: true });
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

// Builds the envelope for a normalized record. The caller (bridge.cts) has
// already run the record through normalizePostRecord — this module does not
// re-normalize, so a producer that skips normalization gets whatever it
// handed in verified back to it, not silently patched.
function buildEnvelope(record: PostRecordShape, opts: { kind?: string; now?: () => string } = {}): InboxEnvelope {
  const kind = opts.kind || 'post.capture';
  const createdAt = (opts.now || (() => new Date().toISOString()))();
  const recordJson = JSON.stringify(record);
  return {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    eventId: record.captureId,
    kind,
    createdAt,
    payloadSha256: sha256Hex(recordJson),
    record,
  };
}

// Writes one envelope durably: create the tmp file EXCLUSIVELY (a name
// collision would mean a duplicate eventId — surfaced as a thrown error
// rather than silently overwritten), write + fsync it, then rename into
// new/. The rename is the commit point — nothing before it is visible to a
// reader of new/, nothing after it needs to happen for the event to be safe.
// `flush: true` (Node >=20.10) fsyncs the fd before close, so a write that
// returns has actually reached disk, not just the page cache — the design
// comment's citation of Node's fs docs for this guarantee.
async function writeInboxEvent(saveFolder: string, envelope: InboxEnvelope): Promise<void> {
  if (!SAFE_EVENT_ID.test(envelope.eventId)) throw new Error(`invalid eventId: ${envelope.eventId}`);
  ensureInboxDirs(saveFolder);
  const finalPath = path.join(inboxNewDir(saveFolder), `${envelope.eventId}.json`);
  const tmpPath = path.join(inboxTmpDir(saveFolder), `${envelope.eventId}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const json = JSON.stringify(envelope, null, 2);
  await fs.promises.writeFile(tmpPath, json, { flag: 'wx', flush: true });
  try {
    await fs.promises.rename(tmpPath, finalPath);
  } catch (err) {
    try {
      await fs.promises.unlink(tmpPath);
    } catch {
      /* best-effort cleanup of the orphaned tmp file */
    }
    throw err;
  }
}

type ParsedEnvelope = { ok: true; envelope: InboxEnvelope } | { ok: false; reason: 'invalid-json' | 'malformed' | 'unknown-format' | 'unknown-version' | 'unknown-kind' | 'id-mismatch' | 'hash-mismatch'; detail?: string };

// Validates a raw new/<eventId>.json file's contents for the consumer side.
// Never throws — every failure mode is a reason the caller can report and
// skip (the design comment's "other events continue"), not a crash.
function parseInboxEnvelope(raw: string): ParsedEnvelope {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch (err: any) {
    return { ok: false, reason: 'invalid-json', detail: err?.message };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'malformed', detail: 'not an object' };
  if (obj.format !== ENVELOPE_FORMAT) return { ok: false, reason: 'unknown-format', detail: String(obj.format) };
  if (obj.version !== ENVELOPE_VERSION) return { ok: false, reason: 'unknown-version', detail: String(obj.version) };
  if (obj.kind !== 'post.capture') return { ok: false, reason: 'unknown-kind', detail: String(obj.kind) };
  if (typeof obj.eventId !== 'string' || !SAFE_EVENT_ID.test(obj.eventId)) return { ok: false, reason: 'malformed', detail: 'invalid eventId' };
  if (!obj.record || typeof obj.record !== 'object' || obj.record.captureId !== obj.eventId) return { ok: false, reason: 'id-mismatch' };
  if (typeof obj.payloadSha256 !== 'string') return { ok: false, reason: 'malformed', detail: 'missing payloadSha256' };
  const recomputed = sha256Hex(JSON.stringify(obj.record));
  if (recomputed !== obj.payloadSha256) return { ok: false, reason: 'hash-mismatch' };
  return {
    ok: true,
    envelope: {
      format: obj.format,
      version: obj.version,
      eventId: obj.eventId,
      kind: obj.kind,
      createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : '',
      payloadSha256: obj.payloadSha256,
      record: obj.record,
    },
  };
}

export { INBOX_DIRNAME, ENVELOPE_FORMAT, ENVELOPE_VERSION, SAFE_EVENT_ID, inboxDir, inboxTmpDir, inboxNewDir, inboxSegmentsDir, inboxFailedDir, ensureInboxDirs, sha256Hex, buildEnvelope, writeInboxEvent, parseInboxEnvelope };
export type { InboxEnvelope, ParsedEnvelope };
