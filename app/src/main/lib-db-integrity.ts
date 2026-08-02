'use strict';

// DB<->media mutual reconciliation (#5 St8 / #301): the two directions a
// single-DB-file architecture can drift apart in.
//   - orphan media: a file survives on disk but its posts row is gone (DB
//     loss, or a write path that never left a DB-recoverable trail — see
//     below). Recovered from the capture's own <captureId>.json when one is
//     lying beside it, and only otherwise by SYNTHESIZING a minimal record.
//   - missing media: a posts row survives but its file is gone (accidental
//     deletion outside the app, a sync client still catching up). Reported
//     only — there is no file to synthesize.
//
// This is the shared detection #100 (library-health dashboard) is meant to
// call rather than reimplement (#301 design comment, "share the detection
// mechanism with #100's item 1, don't duplicate the implementation").
//
// Why orphan media exists at all despite #299's inbox-replay recovery:
// ipc-transfer.ts's ZIP-import and drag-import handlers write posts directly
// via writePost (lib-db-record-writer.ts), bypassing BOTH the sidecar (a
// normal save no longer writes one — see bridge.cts's handleSave) and the
// inbox queue (its own comment: "no sidecar/inbox event for it to notice").
// A DB loss leaves their media files with no trail to replay — captureId's
// own naming convention (epochMillis-hex, native-host/bridge.cts's SAFE_ID)
// is the only recoverable fact, hence "minimal record synthesis".
//
// Electron-free (better-sqlite3 + node builtins only), mirroring lib-db-inbox.ts.

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { PostRecordShape } from '../../../native-host/post-record.mts';
import { normalizePostRecord, recordHoldsContent } from '../../../native-host/post-record.mts';
import { missingMediaReason } from './lib-db-inbox.ts';
import { resolveInSaveFolder } from './lib-save-folder-path.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { parseJsonLoose } from './lib-json.ts';

// Mirrors native-host/bridge.cts's SAFE_ID — the captureId shape every
// producer writes as a bare filename base (<captureId>.<ext>). Attached-media
// files (<base>-media-N.<ext>, <base>-poster.<ext>) never match this alone,
// so they are never mistaken for an orphan POST's own primary artifact.
const SAFE_ID = /^([0-9]{1,20})-[0-9a-f]{1,8}$/i;

const TRASH_SUBDIR = '.trash';
const AVATAR_SUBDIR = 'avatars';
// #290: the shared custom-emoji store — same shared-store exclusion as
// AVATAR_SUBDIR (a file referenced by zero posts is a different question than
// this module's per-capture orphan detection asks).
const EMOJI_SUBDIR = 'emoji';
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

interface OrphanMedia {
  captureId: string;
  file: string; // filename relative to saveFolder
}
interface MissingMedia {
  captureId: string;
  file: string;
}
// How an orphan got its posts row back — see recoverOrphanRecords.
interface RecoveredOrphan extends OrphanMedia {
  via: 'sidecar' | 'synthesized';
}

// Root-level files only (mirrors runBackup's own srcFiles scan) — attached
// media/poster/avatar files live under their owning post's captureId and are
// not independently a "post", so they are deliberately not walked here.
function listRootFiles(saveFolder: string): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(saveFolder);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    if (name === TRASH_SUBDIR || name === AVATAR_SUBDIR || name === EMOJI_SUBDIR) continue;
    if (name.startsWith('.')) continue; // .hologram-inbox, .trash, dotfiles
    if (/\.tmp(-\d+)?$/i.test(name)) continue;
    try {
      if (fs.statSync(path.join(saveFolder, name)).isFile()) out.push(name);
    } catch {
      /* skip inaccessible entries */
    }
  }
  return out;
}

// A root <captureId>.json is that capture's RECORD, never one of its media
// files. Nothing has written one since #302, but a library can still hold
// them — every pre-#302 save left one behind, and a native-host bundle older
// than #299 goes on producing them (#511: that is how the two orphans that
// issue reports were made, from a deployed bridge.js predating the inbox while
// the app had already stopped reading sidecars). Telling the two apart matters
// twice over:
//   - counted as media, the sidecar becomes the orphan's own "file", and
//     recovery writes a record whose image points at a .json while the mp4 and
//     poster that record describes stay referenced by nothing.
//   - read as a record, it IS the complete post — url, text, author, media[] —
//     which is strictly better than anything synthesis can invent.
function isSidecarName(name: string): boolean {
  return name.toLowerCase().endsWith('.json');
}

// The one file that stands for this record in an orphan report: its own
// display artifact, in the same image-then-video-then-media[] order the
// renderer's card face resolves (records.ts's artworkFile).
function primaryArtifactOf(record: PostRecordShape): string | null {
  if (record.image) return record.image;
  if (record.video) return record.video;
  for (const m of record.media) if (m.file) return m.file;
  return null;
}

// <saveFolder>/<captureId>.json read as a post record — or null when there is
// none, it will not parse, it holds nothing of the post, or it describes files
// that are not on disk. Those last two gates are the SAME rules the inbox
// consumer applies to an envelope (recordHoldsContent from #492,
// missingMediaReason from lib-db-inbox.ts), imported rather than restated so a
// sidecar can never be adopted on terms an envelope would be refused on.
//
// captureId is forced to the orphan's own base: the filename is the fact that
// tied these files together, not a field inside a file that may have been
// hand-edited or copied from elsewhere. trashedAt is cleared for the same
// reason — these files sit at the library ROOT, which is where a LIVE capture's
// files live (a trashed capture's are under .trash/), so the disk contradicts
// the flag and the disk is why we are recovering at all. ipc-trash.ts's
// restore-post drops trashedAt when it re-creates a posts row for exactly this
// reason.
function readSidecarRecord(saveFolder: string, captureId: string): PostRecordShape | null {
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(fs.readFileSync(path.join(saveFolder, `${captureId}.json`), 'utf8'));
  } catch {
    return null; // absent, unreadable, or not JSON — synthesis is the fallback
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = normalizePostRecord({ ...(parsed as Record<string, unknown>), captureId, trashedAt: null });
  if (!recordHoldsContent(record)) return null;
  if (missingMediaReason(saveFolder, record)) return null;
  return record;
}

// Captures at saveFolder root with files on disk and no posts row at all
// (trashed posts still have a row — trashedAt, not a missing one — so they are
// correctly excluded without special-casing). One entry per captureId, keyed on
// the base name every producer writes: a bare-captureId media file, or a bare
// <captureId>.json sidecar that names its media itself.
// `knownFiles` lets a caller that already enumerated the folder (runBackup's
// srcSet) skip the readdir — the "piggyback" the design calls for.
function findOrphanMedia(saveFolder: string, sqlite: Database.Database, knownFiles?: Set<string>): OrphanMedia[] {
  const files = knownFiles ? [...knownFiles] : listRootFiles(saveFolder);
  const hasPost = sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?');
  // media wins over sidecar for the reported `file`: when a capture has both
  // (a screenshot plus the leftover .json describing it) the picture is what a
  // report about "orphan media" should name.
  const byBase = new Map<string, { media: string | null; sidecar: boolean }>();
  for (const file of files) {
    const base = file.replace(/\.[^.]+$/, '');
    if (!SAFE_ID.test(base)) continue;
    const entry = byBase.get(base) || { media: null, sidecar: false };
    if (isSidecarName(file)) entry.sidecar = true;
    else if (!entry.media) entry.media = file;
    byBase.set(base, entry);
  }
  const out: OrphanMedia[] = [];
  for (const [captureId, entry] of byBase) {
    if (hasPost.get(captureId)) continue;
    if (entry.media) {
      out.push({ captureId, file: entry.media });
      continue;
    }
    if (!entry.sidecar) continue;
    // Sidecar with no bare-captureId media file of its own: a video or
    // bulk-intake save keeps its media as <captureId>-media-N.<ext>, which
    // listRootFiles deliberately never treats as a post in its own right. Only
    // the record knows those names, so without reading it the capture would not
    // be reported as an orphan AT ALL — and the report is what leads a user to
    // recovery in the first place.
    const record = readSidecarRecord(saveFolder, captureId);
    const file = record && primaryArtifactOf(record);
    if (file) out.push({ captureId, file });
  }
  return out;
}

// posts rows (not trashed — a trashed post's media has been physically moved
// into .trash/, so checking the root for it would be a false positive) whose
// image/video/media[].file does not exist under saveFolder.
function findMissingMedia(saveFolder: string, sqlite: Database.Database): MissingMedia[] {
  const out: MissingMedia[] = [];
  const posts = sqlite.prepare('SELECT captureId, image, video FROM posts WHERE trashedAt IS NULL').all() as Array<{ captureId: string; image: string | null; video: string | null }>;
  const mediaByPost = sqlite.prepare('SELECT file FROM media WHERE postId = ?');
  for (const p of posts) {
    const files = [p.image, p.video, ...(mediaByPost.all(p.captureId) as Array<{ file: string }>).map((m) => m.file)].filter((f): f is string => !!f);
    for (const f of files) {
      const resolved = resolveInSaveFolder(saveFolder, f);
      if (!resolved || !fs.existsSync(resolved)) out.push({ captureId: p.captureId, file: f });
    }
  }
  return out;
}

function checkOrphans(saveFolder: string, sqlite: Database.Database, knownFiles?: Set<string>): { orphanMedia: OrphanMedia[]; missingMedia: MissingMedia[] } {
  return { orphanMedia: findOrphanMedia(saveFolder, sqlite, knownFiles), missingMedia: findMissingMedia(saveFolder, sqlite) };
}

// captureId's own timestamp prefix (epochMillis-hex) — the one fact recoverable
// with no sidecar/inbox trail at all. Falls back to "now" only if the prefix
// somehow fails to parse (SAFE_ID already guarantees digits, so this is belt
// and suspenders, not an expected path).
function capturedAtFromId(captureId: string): string {
  const m = captureId.match(SAFE_ID);
  const ms = m ? Number(m[1]) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
}

// Gives every orphan media file a posts row back, so it becomes a visible post
// again. Two ways in, and the order is the whole point (#511):
//
//   'sidecar'     — a <captureId>.json is lying beside the files and reads as a
//                   real record. Adopted as-is: url, text, author, engagement,
//                   media[] and tags all survive. Synthesis cannot reconstruct
//                   any of that, so a recovery that synthesized over an
//                   available sidecar would be a LOSS dressed up as a repair.
//   'synthesized' — no usable sidecar. A minimal record: captureId, the file
//                   itself in image/video by extension, and the capturedAt
//                   decoded from the id. It shows up as "Imported images" (kind=image,
//                   since url stays null — see i18n.ts's kindImage), and
//                   source:'orphan-recovery' marks the provenance the same way
//                   eagleName/description do for the Eagle-migration path — a
//                   plain free-text field, not a schema flag, so no migration is
//                   needed to add it. This is the case #301 designed for: the
//                   ZIP-import and drag-import handlers write posts directly via
//                   writePost, leaving neither a sidecar nor an inbox envelope.
//
// Manual-trigger only (see #301 design comment on ipc-backup.ts's
// run-orphan-recovery) — never called from the automatic startup/backup
// integrity passes, so a save still mid-flight (media written, DB write not
// yet committed) is never misread as a permanent loss. That decision covers
// sidecar adoption too (2026-07-30): the library root is the library's own
// storage, not a designated intake location, and treating it as one would make
// every startup import whatever happens to be lying there. Lightroom Classic
// draws the same line — files dropped into a managed folder are picked up by the
// manual "Synchronize Folder" command, while automatic pickup is reserved for a
// watched folder set aside for it.
function recoverOrphanRecords(saveFolder: string, sqlite: Database.Database): RecoveredOrphan[] {
  const orphans = findOrphanMedia(saveFolder, sqlite);
  if (!orphans.length) return [];
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const written: RecoveredOrphan[] = [];
  sqlite.exec('BEGIN');
  try {
    for (const o of orphans) {
      const adopted = readSidecarRecord(saveFolder, o.captureId);
      const ext = path.extname(o.file).slice(1).toLowerCase();
      const isVideo = VIDEO_EXTS.has(ext);
      const record =
        adopted ||
        normalizePostRecord({
          captureId: o.captureId,
          image: isVideo ? null : o.file,
          video: isVideo ? o.file : null,
          capturedAt: capturedAtFromId(o.captureId),
          source: 'orphan-recovery',
        });
      writePost(stmts, resolveTagId, fillCardDims(saveFolder, record));
      written.push({ ...o, via: adopted ? 'sidecar' : 'synthesized' });
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  return written;
}

export { checkOrphans, findOrphanMedia, findMissingMedia, recoverOrphanRecords, readSidecarRecord, capturedAtFromId, SAFE_ID };
export type { OrphanMedia, MissingMedia, RecoveredOrphan };
