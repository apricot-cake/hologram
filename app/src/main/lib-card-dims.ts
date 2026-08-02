'use strict';

// Card-image pixel size (shotW/shotH), measured once when a record enters the DB.
//
// The renderer reserves each masonry card's height from shotW/shotH BEFORE its
// lazy image loads, so the grid doesn't settle/jitter as images arrive. #5's
// 2026-07-21 design comment pins this as a column that survives the migration.
//
// Why write time: until #302 this was a side effect of the sidecar scan — the
// index measured any record whose shotW was still null on every pass. With the
// scan gone, the measurement belongs to the moment a record is written, which is
// also the only moment the numbers can be wrong for a *new* reason (the file just
// landed next to it). Every DB producer that has the save folder in hand calls
// fillCardDims() before writePost(): the inbox consumer, the legacy ZIP import /
// import-images, the complete-ZIP importer, and orphan recovery.
//
// Kept Electron-free (fs/path only) so it unit-tests in plain node.

import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from './lib-imgsize.ts';

const IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;
// Media files that carry no measurable still: a video, and a pixiv ugoira
// archive (#119 St3). Mirrors records.ts's isVideoFile/isUgoiraFile.
const UNMEASURABLE_EXT = /\.(mp4|webm|mov|m4v|zip)$/i;
const HEADER_BYTES = 65536; // covers a JPEG SOF past JFIF/short EXIF, plus PNG/GIF/WebP
const HEADER_BYTES_2 = 262144; // retry window for big-EXIF JPEGs (eagle migrations)

// The file shown in CARD view — mirrors the renderer's densityImage('card'): the
// downloaded original (first media file) leads, else a dragged/migrated artwork,
// else the capture screenshot (posts whose original didn't download). Keep this in
// lockstep with services/records.ts's densityImage()/artworkFile() so the height
// reservation sizes the SAME image the card actually shows. A video's poster
// substitutes for its (unmeasurable) file (#119 St1/St3); with no poster, fall through
// to the capture screenshot like a still that failed to download.
function cardImageFile(rec: any): string {
  const media = Array.isArray(rec?.media) ? rec.media.filter((m: any) => m && m.file) : [];
  if (media.length) {
    const first = media[0];
    if (first.posterFile) return first.posterFile;
    if (UNMEASURABLE_EXT.test(first.file)) return rec.image || '';
    return first.file;
  }
  return rec?.image || '';
}

// Clamp a record-derived filename to WITHIN `folder` before opening it. The card
// image is attacker-influenced (a hostile export ZIP's record is read verbatim —
// zip-slip guards only vet entry names, not the values inside a record), so an
// `"image": "../../../x.png"` must not escape the folder. Resolve then
// containment-check, skipping anything outside — the same rule resolveInFolder
// (asset route) and delete-post's path.basename already apply to these exact
// rec.image / media[].file values. #216.
function resolveWithin(folder: string, file: string): string | null {
  const root = path.resolve(folder);
  const full = path.resolve(root, String(file));
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

// Read just the image header (no decode) and return { width, height } or null.
function readImageDims(folder: string, file: string): { width: number; height: number } | null {
  const full = resolveWithin(folder, file);
  if (!full) return null; // escapes the save folder -> skip (never opened)
  let fd: number | null = null;
  try {
    fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    let dim = imageSize(buf.subarray(0, bytesRead));
    if (!dim && bytesRead === HEADER_BYTES) {
      // SOF past the first window (big EXIF) — read more
      const buf2 = Buffer.alloc(HEADER_BYTES_2);
      const read2 = fs.readSync(fd, buf2, 0, HEADER_BYTES_2, 0);
      dim = imageSize(buf2.subarray(0, read2));
    }
    return dim;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

// Fills shotW/shotH on `rec` when they're absent, and returns the same record so
// callers can inline it into writePost(). Sentinel 0/0 means "tried, unsizable"
// (video with no poster, corrupt, or missing file) — a real value, not a retry
// marker, so the renderer falls back to its learned aspect cache exactly once
// rather than re-measuring forever. A record that already carries dimensions
// (a complete-export ZIP round-trip) keeps them untouched.
function fillCardDims<T extends { shotW?: number | null; shotH?: number | null }>(folder: string | null | undefined, rec: T): T {
  if (!rec || rec.shotW != null || !folder) return rec;
  const file = cardImageFile(rec);
  const dim = file && IMG_EXT.test(file) ? readImageDims(folder, file) : null;
  rec.shotW = dim && dim.width > 0 ? dim.width : 0;
  rec.shotH = dim && dim.height > 0 ? dim.height : 0;
  return rec;
}

// IMG_EXT/resolveWithin are also reused by lib-media-dims.ts (#162's
// mediaMaxW/H/Bytes) — same "measurable still image" gate and the same
// zip-slip guard against an attacker-influenced record field, not a second
// copy of either.
export { cardImageFile, fillCardDims, readImageDims, resolveWithin, IMG_EXT };
