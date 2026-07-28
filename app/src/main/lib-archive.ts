'use strict';

// Complete library archive: build a directly-re-importable ZIP snapshot of the
// library, and restore one. Kept dependency-free (fs/path + a JSZip ctor passed
// in) so it can be unit-tested without spinning up Electron.
//
// ZIP layout:
//   library/<captureId>.jpg            screenshot (disk-truth, copied as-is)
//   library/<captureId>.json           sidecar, REGENERATED FROM THE DB (#300/St7)
//   library/<captureId>-media-N.<ext>  original media (disk-truth, copied as-is)
//   library/avatars/<urlhash>.<ext>    shared avatar store (one file per avatar URL)
//   library/folders.json|tag-types.json|ungrouped.json|manual-groups.json|
//           poster-folders.json|poster-tags.json|tabs.json|tag-parents.json
//                                       organization layer, all DB-regenerated;
//                                       tag-parents.json/tabs.json omitted when empty
//   .trash/<name>                      trashed captures, opt-in (opts.includeTrash),
//                                       filesystem-only snapshot (trash isn't in the DB)
//   hologram-export.json               manifest { app, kind:'complete', version,
//                                       source, includesTrash, exportedAt, fileCount }
//
// Why DB-regenerated, not disk-copied: since #298 (St5) flipped the DB to be the
// write truth, in-app edits (post tags, folders, ...) never touch the on-disk
// sidecar/organization JSON again -- those files are frozen or entirely absent for
// anything captured/imported/edited since the flip. A disk copy would silently
// omit or stale-date most of a live library. Binaries (screenshots/media/avatars)
// stay disk-truth: the DB never held their bytes.
//
// Excluded from the snapshot: config.json (machine-specific: paths, extension id)
// and .index.json (cache). On import, captures are copied SKIPPING existing files
// (idempotent / non-clobbering) and the organization JSONs are MERGED (union) so
// importing into a non-empty library never wipes current folders/tags.

import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { ZipFile } from 'yazl';
import type Database from 'better-sqlite3';
import { parseJsonLoose } from './lib-json.ts';
import { postCapturedVia, postsFromDb, tagParentsFromDb, tagsFromDb } from './lib-db-query.ts';
import { createDbWriter } from './lib-db-write.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { importTagParents } from './lib-db-import.ts';

const EXPORT_SKIP = new Set(['config.json', '.index.json']);
const ORG_MERGE = ['folders.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json'];

function isVolatile(name) {
  return /\.tmp(-|$)/i.test(name) || /\.bak$/i.test(name);
}

// --- Zip-bomb / unbounded-expansion guard -------------------------------------
// A `hologram-export.zip` is shared between machines, so a malicious/corrupt one can
// declare a tiny compressed payload that expands to gigabytes (zip bomb) and exhaust
// memory on import (DoS). Cap entry count, total uncompressed bytes, and any single
// entry's uncompressed size BEFORE extracting, using the sizes declared in the ZIP
// central directory (cheap to read, no decompression). The per-entry cap is also
// re-enforced while streaming so a lying central-directory header can't slip past.
//
// Sizing vs. a real library (~7,600 captures today, each = screenshot + sidecar +
// 0..N original media + avatar, so tens of thousands of entries and many GB of
// original media), with generous headroom for growth — these reject only inputs
// that are clearly abnormal, never a legitimate complete export.
const MAX_ZIP_ENTRIES = 200000; // ~25k captures × a handful of files each, w/ headroom
const MAX_ZIP_ENTRY_BYTES = 1024 * 1024 * 1024; // 1 GiB: no single screenshot/sidecar/media is this big
const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024 * 1024; // 64 GiB total uncompressed across the whole archive
class ZipLimitError extends Error {}
function entryUncompressedSize(entry) {
  const n = entry && entry._data ? entry._data.uncompressedSize : undefined;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// --- Zip-Slip guard ------------------------------------------------------------
// A malicious ZIP can carry entry names with traversal sequences (..) or
// BACKSLASH separators (a path separator on Windows, NOT caught by a
// forward-slash-only check) or absolute / drive-letter forms, landing writes
// OUTSIDE the save folder. Accept a library entry name only if it is a single
// path segment — its own basename, with no separator of either kind, not
// '.'/'..', not absolute. Legitimate exports only ever emit single-segment
// filenames (captureIds + `<id>-media-N.<ext>`), so this rejects nothing real.
function isSafeEntryName(name) {
  if (!name || name === '.' || name === '..') return false;
  if (/[\\/]/.test(name)) return false;
  if (path.isAbsolute(name)) return false;
  return name === path.basename(name);
}
// Library entries are single-segment EXCEPT the shared avatar store, which is
// exactly 'avatars/<basename>' (forward slash only — ZIP canonical form; one
// level, each segment held to the same single-segment rule).
function isSafeLibraryPath(name) {
  if (isSafeEntryName(name)) return true;
  const m = /^avatars\/(.+)$/.exec(name);
  return !!(m && isSafeEntryName(m[1]));
}
// .trash/<name> (#300/St7): same single-segment rule as a plain library entry —
// the export side only ever writes flat filenames under .trash/ (mirrors how
// trashDir itself has no subfolders), so this rejects nothing real.
function isSafeTrashPath(name) {
  return isSafeEntryName(name);
}
// Belt-and-suspenders: the resolved destination must stay inside destFolder.
function isWithin(parentDir, target) {
  const p = path.resolve(parentDir);
  const t = path.resolve(target);
  return t === p || t.startsWith(p + path.sep);
}

// --- Organization merges (union) ---------------------------------------------
// Shared id-union for the {id, name, <members>} list shape (poster folders'
// items): first occurrence wins the name (cur is passed before inc =
// local wins), duplicate ids set-union their members.
function unionById(curList, incList, memberKey) {
  const byId = new Map();
  for (const e of [...(curList || []), ...(incList || [])]) {
    if (!e || typeof e.id !== 'string') continue;
    const members = (e[memberKey] || []).map(String);
    const prev = byId.get(e.id);
    if (prev) for (const m of members) prev[memberKey].add(m);
    else byId.set(e.id, { id: e.id, name: String(e.name || e.id), [memberKey]: new Set(members) });
  }
  return [...byId.values()].map((e) => ({ id: e.id, name: e.name, [memberKey]: [...e[memberKey]] }));
}
// Poster folders: the plain { folders:[{id,name,items}] } shape. id-union on items,
// first-seen name wins. (defaultId is legacy/unused for posters but harmless.)
function mergePosterFolders(cur, inc) {
  const folders = unionById(cur.folders, inc.folders, 'items');
  const defaultId = folders.some((f) => f.id === cur.defaultId) ? cur.defaultId : folders.some((f) => f.id === inc.defaultId) ? inc.defaultId : null;
  return { folders, defaultId };
}
// The library folder store (folders.json). id-union on items; name/kind/created/tree
// are LOCAL-wins (cur put first, dup only unions items). activeId is legacy and stays
// local if it still points at a live folder.
function mergeFolders(cur, inc) {
  const byId = new Map();
  const put = (c) => {
    if (!c || typeof c.id !== 'string') return;
    if (byId.has(c.id)) {
      const e = byId.get(c.id);
      for (const it of c.items || []) e.items.add(String(it));
      return;
    }
    // parentId rides along LOCAL-wins with name/kind (#41): where a folder sits in
    // YOUR tree is your arrangement, not the exporting machine's. A parent that
    // only exists in the incoming half lands as a dangling id, which the reader's
    // repair turns into a root folder — visible and fixable, unlike a folder that
    // silently moved.
    const e: any = { id: c.id, name: String(c.name || c.id), kind: c.kind === 'dynamic' ? 'dynamic' : 'static', created: typeof c.created === 'number' ? c.created : null, parentId: c.kind !== 'dynamic' && typeof c.parentId === 'string' ? c.parentId : null, items: new Set((c.items || []).map(String)) };
    // The saved search rides along LOCAL-wins (like name/kind), so importing a ZIP
    // from another machine never overwrites the condition you edited here.
    if (c.kind === 'dynamic' && c.tree && typeof c.tree === 'object') e.tree = c.tree;
    byId.set(c.id, e);
  };
  for (const c of (cur && cur.folders) || []) put(c);
  for (const c of (inc && inc.folders) || []) put(c);
  const folders = [...byId.values()].map((c) => {
    const o: any = { id: c.id, name: c.name, kind: c.kind, created: c.created, parentId: c.parentId, items: [...c.items] };
    if (c.tree) o.tree = c.tree;
    return o;
  });
  const valid = new Set(folders.map((c) => c.id));
  const activeId = cur && valid.has(cur.activeId) ? cur.activeId : inc && valid.has(inc.activeId) ? inc.activeId : null;
  return { folders, activeId };
}
function mergeUngrouped(cur, inc) {
  return { keys: [...new Set([...(cur.keys || []), ...(inc.keys || [])].map(String))] };
}
// Tag → kind map (用語帳). Union of entries; the CURRENT library wins on a tag
// already classified locally (don't let an import overwrite a deliberate kind).
function mergeTagTypes(cur, inc) {
  const types = {};
  for (const [t, k] of Object.entries((inc && inc.types) || {})) if (k) types[String(t)] = String(k);
  for (const [t, k] of Object.entries((cur && cur.types) || {})) if (k) types[String(t)] = String(k);
  const labels = { ...((inc && inc.labels) || {}), ...((cur && cur.labels) || {}) };
  const out: any = { types };
  if (Object.keys(labels).length) out.labels = labels;
  return out;
}
// Manual reply-groups: bare arrays of captureIds with a ONE-group-per-captureId
// invariant. Merging is therefore not set-dedup: [A,B] (cur) + [B,C] (inc) must
// collapse into [A,B,C] — keeping both would leave B in two groups and make the
// downstream member→group lookup pick one arbitrarily. Union-find over members;
// output preserves first-seen member/group order (cur first = stable for locals).
function mergeManualGroups(cur, inc) {
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const order: any[] = [];
  for (const g of [...(cur.groups || []), ...(inc.groups || [])]) {
    if (!Array.isArray(g) || g.length < 2) continue;
    const arr = g.map(String);
    for (const id of arr) {
      if (!parent.has(id)) {
        parent.set(id, id);
        order.push(id);
      }
    }
    for (let i = 1; i < arr.length; i++) {
      const ra = find(arr[0]);
      const rb = find(arr[i]);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const byRoot = new Map();
  for (const id of order) {
    const r = find(id);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(id);
  }
  // <2 can only arise from a degenerate input group like [A,A]; drop it.
  return { groups: [...byRoot.values()].filter((g) => g.length >= 2) };
}
// Per-poster tags: { tags: { posterKey: [tag, …] } }. Union the tag lists per
// posterKey so importing never drops a poster's existing tags.
function mergePosterTags(cur, inc) {
  const out = {};
  const add = (src) => {
    for (const [k, list] of Object.entries((src && src.tags) || {})) {
      if (!Array.isArray(list)) continue;
      const set = out[k] || (out[k] = new Set());
      for (const t of list) set.add(String(t));
    }
  };
  add(cur);
  add(inc);
  const tags = {};
  for (const [k, set] of Object.entries(out)) tags[k] = [...(set as any[])];
  return { tags };
}
const MERGERS = {
  'folders.json': mergeFolders, // the library folder store
  'tag-types.json': mergeTagTypes,
  'ungrouped.json': mergeUngrouped,
  'manual-groups.json': mergeManualGroups,
  'poster-favorites.json': mergeUngrouped, // same { keys } shape → union merge
  'poster-folders.json': mergePosterFolders, // plain { folders } shape → id-union merge
  'poster-tags.json': mergePosterTags, // { tags:{posterKey:[…]} } → per-key union
};

// --- Build ---------------------------------------------------------------------
// Enumerate the exportable files in a save folder: skip internal/volatile entries
// and non-files, plus an optional name filter. Shared by both ZIP builders.
async function collectFiles(srcFolder, nameFilter?) {
  let names: any[] = [];
  try {
    names = await fs.promises.readdir(srcFolder);
  } catch {
    names = [];
  }
  const out: any[] = [];
  for (const name of names) {
    if (EXPORT_SKIP.has(name) || isVolatile(name)) continue;
    if (nameFilter && !nameFilter(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(srcFolder, name));
      if (st.isFile()) out.push(name);
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

async function buildCompleteZip(JSZip, srcFolder, nowIso) {
  const zip = new JSZip();
  const lib = zip.folder('library');
  let fileCount = 0;
  for (const name of await collectFiles(srcFolder)) {
    try {
      lib.file(name, await fs.promises.readFile(path.join(srcFolder, name)));
      fileCount++;
    } catch {
      /* skip unreadable */
    }
  }
  // Shared avatar store rides along as library/avatars/<name> so a restored
  // library keeps author icons (new-style sidecars point at 'avatars/…').
  for (const name of await collectFiles(path.join(srcFolder, 'avatars'))) {
    try {
      lib.file(`avatars/${name}`, await fs.promises.readFile(path.join(srcFolder, 'avatars', name)));
      fileCount++;
    } catch {
      /* skip unreadable */
    }
  }
  zip.file(
    'hologram-export.json',
    JSON.stringify(
      {
        app: 'Hologram',
        kind: 'complete',
        version: 1,
        exportedAt: nowIso || new Date().toISOString(),
        fileCount,
      },
      null,
      2,
    ),
  );
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), fileCount };
}

// Images-only ZIP: just the media files (jpg/png/webp/gif + video), flat at the
// ZIP root — no sidecars, no organization JSONs, NOT re-importable as a library.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|mov|m4v)$/i;
async function buildImagesZip(JSZip, srcFolder) {
  const zip = new JSZip();
  let fileCount = 0;
  for (const name of await collectFiles(srcFolder, (n) => IMAGE_EXT.test(n))) {
    try {
      zip.file(name, await fs.promises.readFile(path.join(srcFolder, name)));
      fileCount++;
    } catch {
      /* skip unreadable */
    }
  }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), fileCount };
}

// --- Streaming ZIP writers (yazl) ----------------------------------------------
// Stream a ZIP straight to disk with bounded memory AND ZIP64 (large-archive)
// support. yazl reads each addFile source lazily as it writes that entry, so a
// multi-GB library never sits in memory (peak ≈ one entry). This replaces the
// buildCompleteZip/buildImagesZip path above, which materialised the whole archive
// as one Buffer — that OOM'd past a few GB (measured 11.5 GiB peak on a ~7 GB
// library) AND, worse, JSZip cannot emit ZIP64, so any >4 GiB archive got a
// truncated central-directory offset = a corrupt, unopenable ZIP. Media/sidecars
// are STORED (compress:false): the library is already-compressed media, so
// deflating it burns CPU for ~no size win.
// onBytes (optional) reports cumulative bytes written to the output file — a
// Transform tap between the yazl stream and the file, so it doesn't disturb the pipe.
function streamZipToFile(zip: ZipFile, outPath: string, onBytes?: (written: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    zip.outputStream.on('error', reject);
    out.on('error', reject);
    out.on('close', () => resolve());
    if (onBytes) {
      let written = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          written += chunk.length;
          onBytes(written);
          cb(null, chunk);
        },
      });
      counter.on('error', reject);
      zip.outputStream.pipe(counter).pipe(out);
    } else {
      zip.outputStream.pipe(out);
    }
  });
}

// tag-parents.json shape (#300/St7 — invented for this issue, tag_parents never
// had a sidecar format before: see lib-db-import.ts's importTagParents doc comment
// for the read side and the "why `ref` is the DB's own tags.id" rationale). Only
// tags that participate in at least one parent edge are listed (a tag with no
// hierarchy is already fully represented by its plain name elsewhere).
function buildTagParentsJson(sqlite: Database.Database) {
  const parentRows = tagParentsFromDb(sqlite);
  if (!parentRows.length) return null;
  const refs = new Set<number>();
  for (const p of parentRows) {
    refs.add(p.tagId);
    refs.add(p.parentTagId);
  }
  const tagById = new Map(tagsFromDb(sqlite).map((t) => [t.id, t]));
  const tags = [...refs].map((ref) => {
    const t = tagById.get(ref);
    return { ref, name: t?.name ?? '', kind: t?.kind ?? null, reading: t?.reading ?? null };
  });
  const parents = parentRows.map((p) => ({ tagRef: p.tagId, parentRef: p.parentTagId, isDisplay: p.isDisplay }));
  return { tags, parents };
}

// A DB post record (lib-db-query.ts's postsFromDb/postsByIds shape) -> the sidecar
// JSON shape a ZIP's library/<captureId>.json has always had. tagIds is a
// DB-internal parallel array (query.ts's tag-leaf id matching) with no meaning
// outside this one database, so it's dropped; capturedVia is merged in separately
// because postsFromDb's column list doesn't select it (lib-db-query.ts comment).
function toSidecarJson(rec: any, capturedVia: string | null) {
  const { tagIds, ...rest } = rec;
  return { ...rest, capturedVia };
}

// Complete, directly-re-importable snapshot. Binaries (screenshots/media/avatars)
// are still disk-truth and copied as-is; everything else (per-post sidecars, the
// organization layer, tag-parents.json) is regenerated from the DB (module comment
// at the top of this file explains why). Returns the file count (excludes the
// manifest), matching the old builder. onProgress(writtenBytes, totalBytes) fires
// as the archive streams out — totalBytes is the summed input size (STORED, so
// output ≈ input + small headers), good enough to drive a taskbar / % progress bar.
async function writeCompleteZip(sqlite: Database.Database, srcFolder: string, trashDir: string | null, outPath: string, opts: { includeTrash?: boolean } = {}, nowIso?: string, onProgress?: (written: number, total: number) => void) {
  const zip = new ZipFile();
  let fileCount = 0;
  let totalBytes = 0;
  const addFile = async (fullPath, entryName) => {
    try {
      totalBytes += (await fs.promises.stat(fullPath)).size;
    } catch {
      /* size unknown — progress just runs a hair ahead */
    }
    zip.addFile(fullPath, entryName, { compress: false });
    fileCount++;
  };
  const addJson = (value: unknown, entryName: string) => {
    const buf = Buffer.from(JSON.stringify(value, null, 2));
    totalBytes += buf.length;
    zip.addBuffer(buf, entryName);
    fileCount++;
  };

  // Binaries: unchanged disk-copy, EXCEPT sidecars (.json) are excluded here —
  // they're regenerated from the DB below instead.
  for (const name of await collectFiles(srcFolder, (n) => !n.toLowerCase().endsWith('.json'))) await addFile(path.join(srcFolder, name), `library/${name}`);
  for (const name of await collectFiles(path.join(srcFolder, 'avatars'))) await addFile(path.join(srcFolder, 'avatars', name), `library/avatars/${name}`);

  // Per-post sidecars, regenerated from the DB.
  const posts = await postsFromDb(sqlite);
  const capturedVia = postCapturedVia(
    sqlite,
    posts.map((p: any) => p.captureId),
  );
  for (const rec of posts) addJson(toSidecarJson(rec, capturedVia.get(rec.captureId) ?? null), `library/${rec.captureId}.json`);

  // Organization layer, regenerated from the DB via the same getters
  // ipc-organize.ts/ipc-config.ts already use as the live read path.
  const dbw = createDbWriter(sqlite);
  addJson(dbw.getFolders(), 'library/folders.json');
  addJson(dbw.getTagTypes(), 'library/tag-types.json');
  addJson(dbw.getUngrouped(), 'library/ungrouped.json');
  addJson(dbw.getManualGroups(), 'library/manual-groups.json');
  addJson(dbw.getPosterFolders(), 'library/poster-folders.json');
  addJson(dbw.getPosterTags(), 'library/poster-tags.json');
  const tabs = dbw.getTabs();
  if (tabs) addJson(tabs, 'library/tabs.json');
  // poster-favorites.json: feature retired, no DB table backs it — dropped from
  // export. (ORG_MERGE/MERGERS keep it for importing an old ZIP that still has one.)

  const tagParents = buildTagParentsJson(sqlite);
  if (tagParents) addJson(tagParents, 'library/tag-parents.json');

  // Trash: opt-in (default off), filesystem-only (a trashed post doesn't exist in
  // the DB — ipc-trash.ts's delete-post fully removes the row), so this is a plain
  // disk copy under a sibling prefix, not merged into library/.
  if (opts.includeTrash && trashDir) {
    for (const name of await collectFiles(trashDir)) await addFile(path.join(trashDir, name), `.trash/${name}`);
  }

  zip.addBuffer(Buffer.from(JSON.stringify({ app: 'Hologram', kind: 'complete', version: 2, source: 'db', includesTrash: !!opts.includeTrash, exportedAt: nowIso || new Date().toISOString(), fileCount }, null, 2)), 'hologram-export.json');
  zip.end();
  await streamZipToFile(zip, outPath, onProgress ? (written) => onProgress(written, totalBytes) : undefined);
  return { fileCount };
}

// Images-only: the media files flat at the ZIP root (no sidecars/org JSONs), NOT
// re-importable as a library.
async function writeImagesZip(srcFolder, outPath, onProgress?: (written: number, total: number) => void) {
  const zip = new ZipFile();
  let fileCount = 0;
  let totalBytes = 0;
  for (const name of await collectFiles(srcFolder, (n) => IMAGE_EXT.test(n))) {
    const fullPath = path.join(srcFolder, name);
    try {
      totalBytes += (await fs.promises.stat(fullPath)).size;
    } catch {
      /* size unknown */
    }
    zip.addFile(fullPath, name, { compress: false });
    fileCount++;
  }
  zip.end();
  await streamZipToFile(zip, outPath, onProgress ? (written) => onProgress(written, totalBytes) : undefined);
  return { fileCount };
}

// Cheap "is there anything to export" probe (readdir + stat only, no file reads) so
// an empty library never opens a save dialog.
async function hasExportableFiles(srcFolder, imagesOnly) {
  if ((await collectFiles(srcFolder, imagesOnly ? (n) => IMAGE_EXT.test(n) : undefined)).length) return true;
  if (!imagesOnly && (await collectFiles(path.join(srcFolder, 'avatars'))).length) return true;
  return false;
}

// Stream a single ZIP entry to disk, aborting if its decompressed output exceeds
// maxBytes. Never buffers the whole entry in memory, so a bomb that under-declares
// its size in the central directory is still capped at the byte budget (it just
// pays decompression cost up to the cap, then the partial file is discarded).
/** @returns {Promise<void>} — typed so resolve() takes no argument. */
function writeEntryStreamed(entry, tmpPath, maxBytes) {
  return new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    const src = entry.nodeStream('nodebuffer');
    let written = 0;
    let aborted = false;
    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      try {
        src.pause();
      } catch {
        /* ignore */
      }
      out.destroy();
      reject(err);
    };
    src.on('data', (chunk) => {
      if (aborted) return;
      written += chunk.length;
      if (written > maxBytes) {
        fail(new ZipLimitError('entry exceeds per-entry byte cap'));
        return;
      }
      out.write(chunk);
    });
    src.on('error', fail);
    out.on('error', fail);
    src.on('end', () => {
      if (!aborted) out.end();
    });
    out.on('finish', () => {
      if (!aborted) resolve();
    });
  });
}

// --- Import / restore ----------------------------------------------------------
// Shared, security-critical classification: zip-bomb + zip-slip pre-checks, then
// sorts every library/ entry into the organization-JSON bucket (MERGERS-keyed),
// the new tag-parents.json bucket (#300/St7 — not a MERGERS key, has its own
// resolution logic, see importTagParents), or the capture bucket (screenshots/
// media/avatars/per-post sidecars), plus a .trash/ bucket (#300/St7). Pure
// classification only — no disk/DB writes — so both importCompleteZip (disk-only,
// unchanged behavior) and importCompleteZipToDb (#300/St7) share one set of
// pre-extraction guards instead of drifting copies.
async function extractLibraryEntries(JSZip, buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const orgEntries: any = {};
  let tagParentsEntry: any = null;
  const captureEntries: any[] = [];
  const trashEntries: any[] = [];
  // Zip-bomb pre-checks: tally entry count + declared uncompressed bytes across the
  // whole archive (not just library/ entries — a bomb can hide anywhere) and reject
  // up front, before extracting anything.
  let entryCount = 0;
  let totalBytes = 0;
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    entryCount += 1;
    const size = entryUncompressedSize(entry);
    if (size > MAX_ZIP_ENTRY_BYTES) throw new ZipLimitError('entry "' + relPath + '" declares ' + size + ' bytes (> per-entry cap ' + MAX_ZIP_ENTRY_BYTES + ')');
    totalBytes += size;
    if (entryCount > MAX_ZIP_ENTRIES) throw new ZipLimitError('archive has > ' + MAX_ZIP_ENTRIES + ' entries');
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw new ZipLimitError('archive declares > ' + MAX_ZIP_TOTAL_BYTES + ' total uncompressed bytes');

    const libMatch = /^library\/(.+)$/.exec(relPath);
    if (libMatch) {
      const name = libMatch[1];
      if (!isSafeLibraryPath(name)) return; // Zip-Slip: reject separators / traversal / absolute (avatars/<name> allowed)
      if (EXPORT_SKIP.has(name)) return;
      if (name === 'tag-parents.json') tagParentsEntry = entry;
      else if (MERGERS[name]) orgEntries[name] = entry;
      else captureEntries.push({ name, entry });
      return;
    }
    const trashMatch = /^\.trash\/(.+)$/.exec(relPath);
    if (trashMatch) {
      const name = trashMatch[1];
      if (!isSafeTrashPath(name)) return;
      trashEntries.push({ name, entry });
    }
  });
  return { orgEntries, tagParentsEntry, captureEntries, trashEntries };
}

// Streamed write with a per-entry byte cap, skip-if-exists (idempotent / never
// clobbers), atomic tmp+rename. Shared by every capture-file writer below (the
// legacy disk-merge importer, the DB-routing importer's binaries, and .trash/
// restore) — the only thing that varies is which directory it lands in.
async function writeCaptureFile(entry, destDir, name): Promise<'imported' | 'skipped'> {
  const dest = path.join(destDir, name);
  try {
    if (!isWithin(destDir, dest)) return 'skipped'; // defensive Zip-Slip guard
    if (fs.existsSync(dest)) return 'skipped';
    if (name.startsWith('avatars/')) await fs.promises.mkdir(path.join(destDir, 'avatars'), { recursive: true });
    const tmp = dest + '.tmp-import';
    // Streamed write with a per-entry byte cap: caps even an entry whose declared
    // size lied past the pre-check above. On abort, drop the partial tmp file.
    try {
      await writeEntryStreamed(entry, tmp, MAX_ZIP_ENTRY_BYTES);
    } catch (e) {
      try {
        await fs.promises.unlink(tmp);
      } catch {
        /* ignore */
      }
      if (e instanceof ZipLimitError) return 'skipped';
      throw e;
    }
    await fs.promises.rename(tmp, dest);
    return 'imported';
  } catch {
    return 'skipped';
  }
}

// Legacy signature and behavior, UNCHANGED (archive-zipbomb/archive-zipslip/
// folders-merge/tag-types tests exercise this exact signature+behavior directly):
// every library/ entry (including per-post .json sidecars) is copied to disk
// skip-if-exists, and the organization JSONs are MERGED (union) into their disk
// files. .trash/ entries and tag-parents.json are classified but never written —
// legacy exports never contain either, so this is unreachable in practice, not an
// intentional new feature of this signature (see importCompleteZipToDb for those).
async function importCompleteZip(JSZip, destFolder, buffer) {
  try {
    await fs.promises.mkdir(destFolder, { recursive: true });
  } catch {
    /* ignore */
  }
  const { orgEntries, captureEntries } = await extractLibraryEntries(JSZip, buffer);
  let imported = 0,
    skipped = 0;
  for (const c of captureEntries) {
    if ((await writeCaptureFile(c.entry, destFolder, c.name)) === 'imported') imported++;
    else skipped++;
  }
  const readCur = (file) => {
    try {
      return parseJsonLoose(fs.readFileSync(path.join(destFolder, file), 'utf8'));
    } catch {
      return {};
    }
  };
  // Atomic tmp+rename for the merged organization JSON: a crash mid-merge must not
  // leave a torn/zero-byte folders.json (etc.) that the app then reads as empty
  // and persists over — losing the live organization layer. Mirrors the capture
  // write above; the .tmp-import suffix is invisible to the folder watcher.
  const writeOrgAtomic = async (file, value) => {
    const target = path.join(destFolder, file);
    const tmp = target + '.tmp-import';
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await fs.promises.rename(tmp, target);
  };
  for (const name of ORG_MERGE) {
    if (!orgEntries[name]) continue;
    let inc = {};
    try {
      inc = parseJsonLoose(await orgEntries[name].async('string'));
    } catch {
      inc = {};
    }
    const merged = MERGERS[name](readCur(name), inc);
    try {
      await writeOrgAtomic(name, merged);
    } catch {
      /* ignore */
    }
  }
  return { ok: true, imported, skipped };
}

// DB-routing import (#300/St7): the replacement for importCompleteZip once posts
// live in the DB. Binaries stay a disk copy (same skip-if-exists contract); .json
// capture entries (per-post sidecars) go to the DB instead of disk; the
// organization layer is read from the DB via createDbWriter, merged with the
// same pure MERGERS functions importCompleteZip uses, and written back —
// preserving "importing into a non-empty library never wipes current
// folders/tags" without any new merge logic. tag-parents.json goes through
// importTagParents (lib-db-import.ts). .trash/ entries restore to
// <destFolder>/.trash/ on disk, untouched by the DB (a trashed post doesn't
// have a posts row at all — ipc-trash.ts's delete-post fully removes it).
//
// Deliberately does NOT use lib-db-import.ts's createDbImporter()/importAll(): that
// importer's org-layer import is gated behind dbIsTruth (skipped once the DB is
// truth, which it always is here) and its own org-layer writer wholesale
// replaces rather than merges — either would be a silent behavior change from
// what's documented above. This instead writes posts directly via writePost, the
// same shared writer import-posts/import-images (ipc-transfer.ts) already use.
async function importCompleteZipToDb(sqlite: Database.Database, JSZip, destFolder: string, buffer) {
  try {
    await fs.promises.mkdir(destFolder, { recursive: true });
  } catch {
    /* ignore */
  }
  const { orgEntries, tagParentsEntry, captureEntries, trashEntries } = await extractLibraryEntries(JSZip, buffer);
  let imported = 0,
    skipped = 0;

  const jsonCaptures = captureEntries.filter((c) => c.name.toLowerCase().endsWith('.json'));
  const binaryCaptures = captureEntries.filter((c) => !c.name.toLowerCase().endsWith('.json'));

  for (const c of binaryCaptures) {
    if ((await writeCaptureFile(c.entry, destFolder, c.name)) === 'imported') imported++;
    else skipped++;
  }

  if (trashEntries.length) {
    const trashDest = path.join(destFolder, '.trash');
    try {
      await fs.promises.mkdir(trashDest, { recursive: true });
    } catch {
      /* ignore */
    }
    for (const t of trashEntries) {
      if ((await writeCaptureFile(t.entry, trashDest, t.name)) === 'imported') imported++;
      else skipped++;
    }
  }

  const parseEntry = async (entry): Promise<any> => {
    try {
      return parseJsonLoose(await entry.async('string'));
    } catch {
      return null;
    }
  };

  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const dbWriter = createDbWriter(sqlite);
  const existingIds = new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((r) => r.captureId));

  sqlite.exec('BEGIN');
  try {
    // Posts: same "never clobber what's already there" contract as the binary
    // capture writes above (skip-if-exists), not an upsert -- an import never
    // silently overwrites something you already have.
    for (const c of jsonCaptures) {
      const rec = await parseEntry(c.entry);
      if (!rec || typeof rec.captureId !== 'string' || !rec.captureId || existingIds.has(rec.captureId)) {
        skipped++;
        continue;
      }
      writePost(stmts, resolveTagId, rec, null);
      dbWriter.restorePostFlags(rec.captureId, rec); // userKind/tagReviewed: writePost doesn't carry these (lib-db-write.ts's module comment)
      existingIds.add(rec.captureId);
      imported++;
    }

    // Organization layer: read current DB state -> merge with the incoming JSON
    // (the same pure MERGERS functions importCompleteZip uses) -> write back.
    if (orgEntries['folders.json']) {
      const inc = (await parseEntry(orgEntries['folders.json'])) ?? {};
      dbWriter.setFolders(mergeFolders(dbWriter.getFolders(), inc));
    }
    if (orgEntries['ungrouped.json']) {
      const inc = (await parseEntry(orgEntries['ungrouped.json'])) ?? {};
      dbWriter.setUngrouped(mergeUngrouped(dbWriter.getUngrouped(), inc).keys);
    }
    if (orgEntries['manual-groups.json']) {
      const inc = (await parseEntry(orgEntries['manual-groups.json'])) ?? {};
      dbWriter.setManualGroups(mergeManualGroups(dbWriter.getManualGroups(), inc).groups);
    }
    if (orgEntries['poster-folders.json']) {
      const inc = (await parseEntry(orgEntries['poster-folders.json'])) ?? {};
      dbWriter.setPosterFolders(mergePosterFolders(dbWriter.getPosterFolders(), inc));
    }
    if (orgEntries['poster-tags.json']) {
      const inc = (await parseEntry(orgEntries['poster-tags.json'])) ?? {};
      dbWriter.setPosterTags(mergePosterTags(dbWriter.getPosterTags(), inc));
    }
    if (orgEntries['tag-types.json']) {
      const inc = (await parseEntry(orgEntries['tag-types.json'])) ?? {};
      const merged = mergeTagTypes(dbWriter.getTagTypes(), inc);
      dbWriter.setTagTypes(merged.types, merged.labels ?? null);
    }
    // poster-favorites.json (legacy MERGERS/ORG_MERGE key, from an old export):
    // no DB table backs the retired feature -- silently dropped if present.

    if (tagParentsEntry) importTagParents(sqlite, resolveTagId, await parseEntry(tagParentsEntry));

    // tabs.json: deliberately NOT imported here -- restoring another device's
    // open tabs into the live session is a confusing default (plan §2c). Kept in
    // the export for completeness/debugging only.

    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  return { ok: true, imported, skipped };
}

export {
  EXPORT_SKIP,
  ORG_MERGE,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  ZipLimitError,
  writeEntryStreamed,
  buildCompleteZip,
  buildImagesZip,
  writeCompleteZip,
  writeImagesZip,
  hasExportableFiles,
  importCompleteZip,
  importCompleteZipToDb,
  mergeFolders,
  mergePosterFolders,
  mergeTagTypes,
  mergeUngrouped,
  mergeManualGroups,
  mergePosterTags,
  buildTagParentsJson,
  toSidecarJson,
};
