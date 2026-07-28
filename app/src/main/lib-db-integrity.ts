'use strict';

// DB<->media mutual reconciliation (#5 St8 / #301): the two directions a
// single-DB-file architecture can drift apart in.
//   - orphan media: a file survives on disk but its posts row is gone (DB
//     loss, or a write path that never left a DB-recoverable trail — see
//     below). Recoverable only by SYNTHESIZING a minimal record.
//   - missing media: a posts row survives but its file is gone (accidental
//     deletion outside the app, a sync client still catching up). Reported
//     only — there is no file to synthesize.
//
// This is the shared detection #100 (library-health dashboard) is meant to
// call rather than reimplement (#301 design comment, "検出機構は#100の品目1
// と共用し二重実装しない").
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
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import { resolveMediaPath } from './lib-db-inbox.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';

// Mirrors native-host/bridge.cts's SAFE_ID — the captureId shape every
// producer writes as a bare filename base (<captureId>.<ext>). Attached-media
// files (<base>-media-N.<ext>, <base>-poster.<ext>) never match this alone,
// so they are never mistaken for an orphan POST's own primary artifact.
const SAFE_ID = /^([0-9]{1,20})-[0-9a-f]{1,8}$/i;

const TRASH_SUBDIR = '.trash';
const AVATAR_SUBDIR = 'avatars';
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);

interface OrphanMedia {
  captureId: string;
  file: string; // filename relative to saveFolder
}
interface MissingMedia {
  captureId: string;
  file: string;
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
    if (name === TRASH_SUBDIR || name === AVATAR_SUBDIR) continue;
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

// Media files at saveFolder root whose base name is a bare captureId and has
// no posts row at all (trashed posts still have a row — trashedAt, not a
// missing one — so they are correctly excluded without special-casing).
// `knownFiles` lets a caller that already enumerated the folder (runBackup's
// srcSet) skip the readdir — the "相乗り" (piggyback) the design calls for.
function findOrphanMedia(saveFolder: string, sqlite: Database.Database, knownFiles?: Set<string>): OrphanMedia[] {
  const files = knownFiles ? [...knownFiles] : listRootFiles(saveFolder);
  const hasPost = sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?');
  const out: OrphanMedia[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const base = file.replace(/\.[^.]+$/, '');
    if (!SAFE_ID.test(base) || seen.has(base)) continue;
    if (hasPost.get(base)) continue;
    seen.add(base);
    out.push({ captureId: base, file });
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
      const resolved = resolveMediaPath(saveFolder, f);
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

// Writes one minimal PostRecordInput per orphan media file so it becomes a
// visible ("取り込み画像"／kind=image, since url stays null — see i18n.ts's
// kindImage) post again. source:'orphan-recovery' marks provenance the same
// way eagleName/description do for the Eagle-migration path — a plain
// free-text field, not a schema flag, so no migration is needed to add it.
// Manual-trigger only (see #301 design comment on ipc-backup.ts's
// run-orphan-recovery) — never called from the automatic startup/backup
// integrity passes, so a save still mid-flight (media written, DB write not
// yet committed) is never misread as a permanent loss.
function synthesizeOrphanRecords(saveFolder: string, sqlite: Database.Database): OrphanMedia[] {
  const orphans = findOrphanMedia(saveFolder, sqlite);
  if (!orphans.length) return [];
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const written: OrphanMedia[] = [];
  sqlite.exec('BEGIN');
  try {
    for (const o of orphans) {
      const ext = path.extname(o.file).slice(1).toLowerCase();
      const isVideo = VIDEO_EXTS.has(ext);
      const rec = normalizePostRecord({
        captureId: o.captureId,
        image: isVideo ? null : o.file,
        video: isVideo ? o.file : null,
        capturedAt: capturedAtFromId(o.captureId),
        source: 'orphan-recovery',
      });
      writePost(stmts, resolveTagId, fillCardDims(saveFolder, rec));
      written.push(o);
    }
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  return written;
}

export { checkOrphans, findOrphanMedia, findMissingMedia, synthesizeOrphanRecords, capturedAtFromId, SAFE_ID };
export type { OrphanMedia, MissingMedia };
