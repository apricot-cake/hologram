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
import { TRASH_SUBDIR, resolveInSaveFolder } from './lib-save-folder-path.ts';
import { parseJsonLoose } from './lib-json.ts';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import type { PostRecordShape } from '../../../native-host/post-record.mts';

// The DB-only state a trashed capture has to take with it: none of it lives in
// the record, and FK ON DELETE CASCADE removes all of it with the posts row.
// folders / manualGroups are #593 — a restored post used to come back belonging
// to nothing.
export interface TrashCaptureFlags {
  tags?: string[];
  userKind?: string | null;
  tagReviewed?: boolean | null;
  folders?: string[];
  manualGroups?: Array<{ groupId: number; seq: number }>;
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
    // #236: a collected (assetClass:'file') record's own file — the third
    // slot alongside image/video, never filled at the same time as either.
    if (record.file) targets.add(path.basename(record.file));
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
    const src = resolveInSaveFolder(folder, name);
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
    // Written only when non-empty: a post in no folder should not leave an empty
    // array behind for a reader to interpret.
    if (flags.folders?.length) r.folders = flags.folders;
    if (flags.manualGroups?.length) r.manualGroups = flags.manualGroups;
  }
  try {
    await fs.promises.writeFile(path.join(trashDir, `${captureId}.json`), JSON.stringify(r, null, 2), 'utf8');
  } catch {
    /* best-effort — trash still works but won't auto-purge/dedup */
  }
}

// Every filename that leaves the app is read as save-folder-relative: the
// renderer turns it into `asset://img/<name>` and main resolves it back with the
// one containment rule (lib-save-folder-path.ts). A trashed capture's record was
// written while its files were still in the library, so the names inside it are
// relative to the folder ROOT — but the files themselves have since moved into
// `.trash/`. Rebase them as the listing is built, and the trash view can draw the
// library's own cards without knowing where the trash is (#267); leave them bare
// and every trash thumbnail points at a path where the file no longer is.
//
// The one name left alone is a shared-store avatar: trashCapture deliberately
// does not move `avatars/<urlhash>.<ext>` (see ownedFiles), so it is still
// exactly where the record says it is.
//
// This assumes trashDir is `<saveFolder>/<TRASH_SUBDIR>` — which is what makes it
// resolvable at all, and is how the app builds it (index.ts's getTrashDir).
function rebaseOntoTrash(rec: PostRecordShape): PostRecordShape {
  const inTrash = (name: string) => `${TRASH_SUBDIR}/${path.basename(name)}`;
  const sharedAvatar = !!rec.avatarFile && /^avatars[\\/]/.test(rec.avatarFile);
  return {
    ...rec,
    image: rec.image ? inTrash(rec.image) : rec.image,
    video: rec.video ? inTrash(rec.video) : rec.video,
    // #236: same rebase as image/video — a trashed collected item's card still
    // has to resolve its file (generic-card fallback aside) through .trash/.
    file: rec.file ? inTrash(rec.file) : rec.file,
    avatarFile: rec.avatarFile && !sharedAvatar ? inTrash(rec.avatarFile) : rec.avatarFile,
    media: rec.media.map((m) => ({ ...m, file: m.file ? inTrash(m.file) : m.file, posterFile: m.posterFile ? inTrash(m.posterFile) : m.posterFile })),
  };
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
// off the file itself, and no renderer surface shows them. The filenames are the
// one thing rewritten on the way out (rebaseOntoTrash above).
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
      // The acquisition originals are dropped on the way out (#593): a trash
      // record now carries them so a restore can put them back, but nothing
      // downstream of here displays originals (#292 leaves a disclosure surface
      // out of scope), and otherwise every trashed post's base64 would ride the
      // list-trash IPC on every open of the trash view.
      records.push({ ...rebaseOntoTrash(normalizePostRecord({ ...rec, captureId })), raw: [] });
    } catch {
      /* skip corrupt record */
    }
  }
  records.sort((a, b) => new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime());
  return records;
}
