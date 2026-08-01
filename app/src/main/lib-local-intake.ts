'use strict';

// Local intake — the one definition of what a record made from a LOCAL image
// looks like, shared by every door that isn't the browser extension (#84's
// 2026-07-16 implementation design comment's shared helper `importLocalImage`).
//
// The doors, and what each one supplies:
//   * the file dialog (`import-images`, ipc-transfer.ts) — a path, `drag-`/'drag'
//   * the clipboard (`import-clipboard`, #85)            — bytes, `clip-`/'clipboard'
//   * a watch folder (#84, not built yet)                — a path, `watch-`/'watch'
//   * drag & drop onto the window (#234, not built yet)  — a path, `drag-`/'drag'
// They differ in where the pixels come from and in three field values; everything
// else about the record — url:null, the timestamps, mediaType, where the file
// lands, that the card dimensions are measured before the row is written — is the
// same, and is stated once here.
//
// #84's design comment describes this helper as "sidecar composition" because it was
// written while sidecars were still the library's storage. They are gone (#299/
// #300/#302): the record goes straight into the DB through the shared writer
// (lib-db-record-writer.ts) and only the media file lands in the save folder.
// The rest of that comment — the field values, the captureId prefixes, the
// per-door `source` — is what this module implements.
//
// **`url` stays null.** `kind` is not stored; the query layer derives it from
// whether a record has a url, so a locally-imported image with a url set would
// present itself as an SNS post (and group by postKey with real ones). That is
// the reason #85 dropped "pull a URL out of the clipboard's text/html" and #234
// dropped the same for drops — see #85's 2026-07-16 comment.
//
// Electron-free (fs/path + better-sqlite3 only), like lib-card-dims.ts, so it
// unit-tests in plain node.

import fs from 'node:fs';
import path from 'node:path';

import { fillCardDims } from './lib-card-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import type Database from 'better-sqlite3';
import type { PostRecordInput } from '../../../native-host/post-record.mts';

// Import arbitrary media files as library items (the user's own files are fine).
// Also serves as the import path for Hologram's media-only export. Lives here
// rather than in ipc-transfer.ts because every local-intake door filters by the
// same list (#84's design comment: "reuse IMPORTABLE_MEDIA for target extensions").
export const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
export const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
export const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);

/**
 * A captureId for a locally-imported item: `<prefix>-<stamp>-<4-digit sequence>`.
 * `stamp` is per BATCH (one dialog selection, one watch-folder sweep) so a batch's
 * ids sort together; `seq` orders within it.
 */
export function localCaptureId(prefix: string, stamp: number, seq: number): string {
  return `${prefix}-${stamp}-${String(seq).padStart(4, '0')}`;
}

export interface LocalRecordArgs {
  captureId: string;
  /** The file's name INSIDE the save folder (`<captureId>.<ext>`). */
  file: string;
  /** Lower-case, no dot. Decides image vs video. */
  ext: string;
  /** `'drag'` / `'clipboard'` / `'watch'` — see the module comment. */
  source: string;
  /** Shown as the card's title. The original basename, or a generated label. */
  title: string | null;
  /**
   * The record's `date` (the axis the grid sorts and filters on). A file's mtime
   * where there is one; omitted where there isn't, which settles to now — the
   * clipboard has no origin date to carry (#85).
   */
  date?: string | null;
  /** Injected so a test can pin the capture timestamps. */
  now?: string;
}

/**
 * The record a local image becomes. Split out from importLocalImage so a batch
 * door (the dialog import) can build many and write them in ONE transaction,
 * while a single-item door (the clipboard) takes the whole helper below.
 */
export function buildLocalRecord(args: LocalRecordArgs): PostRecordInput {
  const nowIso = args.now || new Date().toISOString();
  const isVid = IMPORTABLE_VID.includes(args.ext);
  return {
    captureId: args.captureId,
    source: args.source,
    // Never a url — see the module comment.
    url: null,
    platform: null,
    title: args.title,
    text: null,
    displayName: null,
    screenName: null,
    mediaType: isVid ? 'video' : 'image',
    capturedAt: nowIso,
    date: args.date || nowIso,
    updatedAt: nowIso,
    media: [],
    tags: [],
    hashtags: [],
    image: isVid ? null : args.file,
    video: isVid ? args.file : null,
  };
}

export interface ImportLocalImageArgs extends Omit<LocalRecordArgs, 'captureId' | 'file'> {
  folder: string;
  sqlite: Database.Database;
  /** captureId prefix — `clip` / `watch` / `drag`. */
  idPrefix: string;
  /** Pixels already in hand (the clipboard hands over a PNG buffer). */
  bytes?: Buffer;
  /** A file to copy in (the dialog / a watch folder). Ignored when `bytes` is set. */
  srcPath?: string;
  stamp?: number;
  seq?: number;
}

/**
 * Land ONE local image in the library: the media file into the save folder, the
 * record into the DB. Rejects rather than half-finishing — the row is only written
 * once the file is on disk, so a failed import never leaves a record pointing at
 * nothing (the reverse, a file with no record, is what orphan recovery is for).
 */
export async function importLocalImage(args: ImportLocalImageArgs): Promise<{ captureId: string; file: string }> {
  const captureId = localCaptureId(args.idPrefix, args.stamp ?? Date.now(), args.seq ?? 0);
  const file = `${captureId}.${args.ext}`;
  const dest = path.join(args.folder, file);
  await fs.promises.mkdir(args.folder, { recursive: true });
  if (args.bytes) await fs.promises.writeFile(dest, args.bytes);
  else if (args.srcPath) await fs.promises.copyFile(args.srcPath, dest);
  else throw new Error('importLocalImage: neither bytes nor srcPath');

  const rec = buildLocalRecord({ captureId, file, ext: args.ext, source: args.source, title: args.title, date: args.date, now: args.now });
  const stmts = preparePostStmts(args.sqlite);
  const resolveTagId = makeTagResolver(args.sqlite);
  args.sqlite.exec('BEGIN');
  try {
    writePost(stmts, resolveTagId, fillCardDims(args.folder, rec));
    args.sqlite.exec('COMMIT');
  } catch (err) {
    args.sqlite.exec('ROLLBACK');
    // The row never landed, so neither should the file it would have named.
    try {
      await fs.promises.unlink(dest);
    } catch {
      /* nothing to clean up */
    }
    throw err;
  }
  return { captureId, file };
}
