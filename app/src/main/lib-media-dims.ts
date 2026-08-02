'use strict';

// Per-record MEDIA-size aggregates (mediaMaxW/mediaMaxH/mediaMaxBytes) — the
// #162 companion to lib-card-dims.ts's shotW/shotH, measured once when a
// record enters the DB (same write-time-only convention, same reason: #302
// retired the periodic sidecar scan that used to re-measure anything still
// null, so measuring happens at the moment a record is written, not swept up
// later — see lib-card-dims.ts's own "Why write time" comment).
//
// What this aggregates, and why MAX (not sum): the dimension/file-size facet's
// Why (#162) is "見せてほしいのは原寸の高解像度だけ／軽い画像だけ" — the
// record's BEST original-resolution asset, not the total weight of everything
// attached. Sum would answer "how heavy is this whole post", a different
// question the facet was never asked.
//
// The no-media fallback (a screenshot capture or a dragged/imported artwork
// with no separately-downloaded original): the card image IS the record's own
// asset, so its already-measured shotW/shotH stand in for width/height rather
// than re-reading the header, and its file (cardImageFile — the SAME file
// fillCardDims itself measures, including its "video-only record with no
// image" limitation) is what gets stat'd for size. fillMediaDims must
// therefore run AFTER fillCardDims when both run on one record.
//
// A video/ugoira-archive media item contributes to mediaMaxBytes (fs.stat
// sees any file) but NOT to mediaMaxW/mediaMaxH — its poster frame is a
// stand-in thumbnail, not the item's own resolution, and substituting it is
// #119's territory (mirrors fillCardDims's own poster-substitution note), not
// this one's. 0 means "measured, found nothing sizable" (a video-only record,
// or an unreadable header) — the same sentinel convention as shotW/shotH,
// never a retry marker.
//
// #162's design decision (Issue comment, 2026-07-18): "既存 augment の逐次処理
// に乗せ" — ride the SAME write-time mechanism as shotW/shotH rather than a
// dedicated backfill scan. A record saved before this shipped keeps
// mediaMaxW/H/Bytes null until it is next written for any other reason (an
// edit, a trash/restore, orphan recovery); until then the facet simply finds
// nothing to match for it (0/null = unsatisfied is the facet's own decision on
// absent data, query.ts's makePostPredOf 'dimension' case). No progress UI, no
// one-time sweep.
//
// Kept Electron-free (fs only) so it unit-tests in plain node, same as
// lib-card-dims.ts.

import fs from 'node:fs';
import { cardImageFile, readImageDims, resolveWithin, IMG_EXT } from './lib-card-dims.ts';

// Byte size of `file` (relative to `folder`), 0 when unreadable or outside the
// folder — resolveWithin is the same zip-slip guard readImageDims uses,
// necessary here for the same reason: an imported/exported record's file
// fields are attacker-influenced (#216).
function fileBytes(folder: string, file: string | null | undefined): number {
  if (!file) return 0;
  const full = resolveWithin(folder, file);
  if (!full) return 0;
  try {
    return fs.statSync(full).size;
  } catch {
    return 0;
  }
}

// Fills mediaMaxW/mediaMaxH/mediaMaxBytes on `rec` when absent, and returns the
// same record so callers can inline it into writePost() (mirrors
// fillCardDims's own shape). The once-only gate (mediaMaxW != null) matches
// shotW/shotH: a record that already carries values (a complete-export ZIP
// round-trip) keeps them untouched.
function fillMediaDims<T extends { media?: unknown; image?: string | null; mediaMaxW?: number | null; mediaMaxH?: number | null; mediaMaxBytes?: number | null; shotW?: number | null; shotH?: number | null }>(folder: string | null | undefined, rec: T): T {
  if (!rec || rec.mediaMaxW != null || !folder) return rec;
  const media = Array.isArray(rec.media) ? (rec.media as Array<{ file?: string }>).filter((m) => m && m.file) : [];
  if (!media.length) {
    rec.mediaMaxW = rec.shotW && rec.shotW > 0 ? rec.shotW : 0;
    rec.mediaMaxH = rec.shotH && rec.shotH > 0 ? rec.shotH : 0;
    rec.mediaMaxBytes = fileBytes(folder, cardImageFile(rec));
    return rec;
  }
  let maxW = 0;
  let maxH = 0;
  let maxBytes = 0;
  for (const m of media) {
    const file = m.file as string;
    const bytes = fileBytes(folder, file);
    if (bytes > maxBytes) maxBytes = bytes;
    if (IMG_EXT.test(file)) {
      const dim = readImageDims(folder, file);
      if (dim) {
        if (dim.width > maxW) maxW = dim.width;
        if (dim.height > maxH) maxH = dim.height;
      }
    }
  }
  rec.mediaMaxW = maxW;
  rec.mediaMaxH = maxH;
  rec.mediaMaxBytes = maxBytes;
  return rec;
}

export { fillMediaDims, fileBytes };
