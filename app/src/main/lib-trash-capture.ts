'use strict';

// Moving ONE capture's files into .trash/ and leaving the self-describing
// record next to them. Extracted from ipc-trash.ts's delete-post when #34 gave
// it a second caller: the duplicate-save warning's "replace" answer retires the
// capture it replaced, and a replacement that trashed a DIFFERENT set of files
// than a delete would be a second, quietly diverging definition of "remove this
// post".
//
// The trash-side JSON is what makes the trash self-describing (see ipc-trash.ts
// for why the library itself no longer keeps per-post JSON): a trashed post has
// no posts row, so its record has to live beside the files it describes —
// freedesktop.org's .trashinfo and digiKam's .dtrashinfo pair the same way.
//
// Electron-free (node builtins only) so it unit-tests in plain node, like the
// lib-db-* modules it sits next to. The DB side of a delete is the caller's:
// this module only touches the filesystem.

import fs from 'node:fs';
import path from 'node:path';
import { resolveMediaPath } from './lib-db-inbox.ts';
import { parseJsonLoose } from './lib-json.ts';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';

export interface TrashCaptureFlags {
  tags?: string[];
  userKind?: string | null;
  tagReviewed?: boolean | null;
}

// Every file in the save folder this capture owns. Three sources, because a
// capture's files are named three different ways:
//   - <captureId>.<ext> for every media extension the library can hold
//   - whatever the record itself names (image / video / media[].file / poster)
//   - the <captureId>-media-N / -poster. / -avatar. families, found by listing
// A shared-store avatar (avatars/<urlhash>.<ext>) is deliberately left alone:
// every capture of that author references it, so trashing one post must not
// take the icon away from the rest.
async function ownedFiles(folder: string, captureId: string, record: any | null, mediaExts: readonly string[]): Promise<Set<string>> {
  const targets = new Set<string>();
  for (const e of mediaExts) targets.add(`${captureId}.${e}`);
  if (record) {
    if (record.image) targets.add(path.basename(record.image));
    if (record.video) targets.add(path.basename(record.video));
    if (record.avatarFile && !/^avatars[\\/]/.test(record.avatarFile)) targets.add(path.basename(record.avatarFile));
    for (const m of record.media || []) {
      if (m?.file) targets.add(path.basename(m.file));
      if (m?.posterFile) targets.add(path.basename(m.posterFile)); // #119 St1
    }
  }
  try {
    for (const f of await fs.promises.readdir(folder)) {
      if (f.startsWith(`${captureId}-media-`) || f.startsWith(`${captureId}-poster.`) || f.startsWith(`${captureId}-avatar.`)) targets.add(f);
    }
  } catch {
    /* folder unreadable — the named targets above are still worth trying */
  }
  return targets;
}

// Moves this capture's files into trashDir and writes <captureId>.json beside
// them, stamped with trashedAt (auto-purge reads it) and carrying the DB-only
// state (tags / userKind / tagReviewed) restore-post cannot get anywhere else.
//
// Best-effort throughout: a file that is already gone is simply not moved, and
// a failed record write leaves the files trashed but not auto-purgeable. The
// caller's DB half is what makes the post disappear from the library; this must
// never throw and undo that.
export async function trashCapture(opts: { folder: string; trashDir: string; mediaExts: readonly string[]; captureId: string; record: any | null; flags?: TrashCaptureFlags | null }): Promise<void> {
  const { folder, trashDir, mediaExts, captureId, record, flags } = opts;
  await fs.promises.mkdir(trashDir, { recursive: true });
  for (const name of await ownedFiles(folder, captureId, record, mediaExts)) {
    const src = resolveMediaPath(folder, name);
    if (!src) continue;
    try {
      await fs.promises.rename(src, path.join(trashDir, name));
    } catch {
      /* not found (or already moved) */
    }
  }
  if (!record) return;
  const r: any = { ...record, trashedAt: new Date().toISOString() };
  if (flags) {
    if (flags.tags) r.tags = flags.tags;
    if (flags.userKind != null) r.userKind = flags.userKind;
    if (flags.tagReviewed != null) r.tagReviewed = flags.tagReviewed;
  }
  try {
    await fs.promises.writeFile(path.join(trashDir, `${captureId}.json`), JSON.stringify(r, null, 2), 'utf8');
  } catch {
    /* best-effort — trash still works but won't auto-purge/dedup */
  }
}

// The trash listing the renderer draws (ipc-trash.ts's list-trash), normalized.
//
// This is the ONE record shape that still reaches the renderer straight off
// disk. Since #302 the library folder holds media only, so every other record
// the UI sees has passed normalizePostRecord on its way into the DB (writePost)
// — a trashed post has no posts row, so its record has to live beside its files
// (module comment above) and never meets that builder.
//
// Which matters because the trash directory is writable from OUTSIDE the app:
// importCompleteZipToDb copies a complete-export archive's `.trash/` entries to
// disk verbatim (the zip-slip rules vet entry NAMES; nothing vets the field
// shapes inside an entry). Renderer code reads these fields as strings and
// arrays, so a planted `"title": {}` renders an object as a React child, which
// takes the whole component tree down — and a relaunch reads the same file
// again, so it stays down (#324).
//
// So the trust boundary is here, in the same builder every DB producer uses,
// rather than in each consumer's own defensive check. The returned records are
// PostRecordShape exactly: the DB-only flags a trash record also carries
// (userKind / tagReviewed) are deliberately not in it — restore-post reads those
// off the file itself, and no renderer surface shows them.
export async function listTrashRecords(trashDir: string): Promise<PostRecordShape[]> {
  let names: string[];
  try {
    names = await fs.promises.readdir(trashDir);
  } catch {
    return [];
  }
  const records: PostRecordShape[] = [];
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    try {
      const rec = parseJsonLoose(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue; // a record is an object; an array of them is not a record
      // The filename IS the captureId (trashCapture writes `<captureId>.json`),
      // which is what restore / permanent-delete address the record by — so a
      // record whose own captureId field is missing or not a string is listed
      // under its filename rather than dropped.
      const captureId = typeof rec.captureId === 'string' && rec.captureId ? rec.captureId : f.replace(/\.json$/i, '');
      records.push(normalizePostRecord({ ...rec, captureId }));
    } catch {
      /* skip corrupt record */
    }
  }
  records.sort((a, b) => new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime());
  return records;
}
