'use strict';

// Complete library archive: build a directly-re-importable ZIP snapshot of the
// library, and restore one. Kept free of Electron (fs/path + yazl/yauzl only) so
// it can be unit-tested without spinning up a browser window.
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
//                                       source, includesTrash, exportedAt, fileCount,
//                                       rawPayloads: format + privacy note (#292) }
//
// The sidecar-shaped JSON is a BOUNDARY FORMAT, not storage: the library folder
// itself holds no per-post JSON (#302), so the export regenerates it from the DB
// on the way out and the import routes it back into the DB on the way in. That is
// what makes a ZIP human-readable and portable without giving the on-disk library
// a second truth source. Binaries (screenshots/media/avatars) stay disk-truth: the
// DB never held their bytes.
//
// On import, captures are copied SKIPPING existing files (idempotent /
// non-clobbering) and the organization layer is MERGED (union) so importing into a
// non-empty library never wipes current folders/tags.

import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';
import { openPromise as openZipForRead } from 'yauzl';
import type { Entry as ZipEntry, ZipFile as ZipReader } from 'yauzl';
import { ZipFile } from 'yazl';
import type Database from 'better-sqlite3';
import type { RawPayloadShape } from '../../../native-host/raw-payload.mts';
import { fillCardDims } from './lib-card-dims.ts';
import { parseJsonLoose } from './lib-json.ts';
import { postCapturedVia, postRawPayloads, postsFromDb, tagParentsFromDb, tagsFromDb } from './lib-db-query.ts';
import { createDbWriter } from './lib-db-write.ts';
import { importTagParents, makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';

// config.json is machine-specific (paths, extension id) and lives in configDir
// anyway; a pre-#5 library can still have a stale copy sitting in the folder.
const EXPORT_SKIP = new Set(['config.json']);
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
// Organization-layer JSON (ORG_MERGE below) gets its own, much smaller budget
// (#382): MAX_ZIP_ENTRY_BYTES exists to fit multi-GB media, but folders.json/
// tag-types.json/etc. are config-shaped and never legitimately approach that —
// letting one ride the 1 GiB media cap meant a crafted entry could still expand
// to hundreds of MB of string + parsed JSON in the main process before the
// generic guard ever triggers.
const MAX_ZIP_ORG_BYTES = 16 * 1024 * 1024; // 16 MiB
class ZipLimitError extends Error {}
// yauzl reads uncompressedSize straight off the central directory (widened from
// the ZIP64 extra field when present), so this is the declared size for archives
// of any size. A malformed/absent value counts as 0 — the streamed caps below are
// what actually bound an entry that lies here.
function entryUncompressedSize(entry: ZipEntry) {
  const n = entry?.uncompressedSize;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// --- Zip-Slip guard ------------------------------------------------------------
// A malicious ZIP can carry entry names with traversal sequences (..) or
// BACKSLASH separators (a path separator on Windows, NOT caught by a
// forward-slash-only check) or absolute / drive-letter forms, landing writes
// OUTSIDE the save folder.
//
// yauzl runs its own validateFileName over every entry name (backslashes are
// folded to '/' first, then absolute paths, drive letters and '..' segments are
// rejected) and aborts the WHOLE archive rather than yielding such an entry — so
// with the reader below an archive carrying any of those three shapes fails
// closed, before a single byte is written. That is the outer layer, not a
// replacement for the rules here: yauzl happily yields nested paths like
// 'library/sub/dir/x.jpg', which a real export never emits.
//
// Accept a library entry name only if it is a single
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
// Deliberately unreachable with the current reader — every name that could escape
// is already refused by yauzl (layer 1) or by the single-segment rules (layer 2),
// so no regression test can make this line fire. It stays because it is the last
// check before a write, and it is the only one that would still hold if the reader
// ever stopped validating names for us. Same for isSafeTrashPath's call site.
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

// Images-only ZIP: just the media files (jpg/png/webp/gif + video), flat at the
// ZIP root — no sidecars, no organization JSONs, NOT re-importable as a library.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|mov|m4v)$/i;

// --- Streaming ZIP writers (yazl) ----------------------------------------------
// Stream a ZIP straight to disk with bounded memory AND ZIP64 (large-archive)
// support. yazl reads each addFile source lazily as it writes that entry, so a
// multi-GB library never sits in memory (peak ≈ one entry). This replaced a JSZip
// builder that materialised the whole archive as one Buffer — that OOM'd past a
// few GB (measured 11.5 GiB peak on a ~7 GB library) AND, worse, JSZip cannot
// emit ZIP64, so any >4 GiB archive got a truncated central-directory offset = a
// corrupt, unopenable ZIP. Media/sidecars
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
function toSidecarJson(rec: any, capturedVia: string | null, raw: RawPayloadShape[]) {
  const { tagIds, ...rest } = rec;
  // raw: the post's acquisition originals (#292), included by default because a
  // complete export that dropped them would not be complete — the originals are
  // the one part of a record that cannot be re-fetched once a post is deleted.
  // Omitted from the JSON entirely when a post has none, so records saved before
  // this layer existed keep exactly the sidecar shape they had.
  return raw.length ? { ...rest, capturedVia, raw } : { ...rest, capturedVia };
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

  // Binaries: a plain disk copy. The .json filter is belt-and-braces — the library
  // folder holds no per-post JSON since #302, but a pre-migration leftover must not
  // shadow the record regenerated from the DB below.
  for (const name of await collectFiles(srcFolder, (n) => !n.toLowerCase().endsWith('.json'))) await addFile(path.join(srcFolder, name), `library/${name}`);
  for (const name of await collectFiles(path.join(srcFolder, 'avatars'))) await addFile(path.join(srcFolder, 'avatars', name), `library/avatars/${name}`);

  // Per-post records in sidecar shape, regenerated from the DB.
  const posts = await postsFromDb(sqlite);
  const captureIds = posts.map((p: any) => p.captureId);
  const capturedVia = postCapturedVia(sqlite, captureIds);
  const rawPayloads = postRawPayloads(sqlite, captureIds);
  let rawPayloadCount = 0;
  for (const rec of posts) {
    const raw = rawPayloads.get(rec.captureId) ?? [];
    rawPayloadCount += raw.length;
    addJson(toSidecarJson(rec, capturedVia.get(rec.captureId) ?? null, raw), `library/${rec.captureId}.json`);
  }

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

  // rawPayloads: the manifest states the format and the privacy caveat #292
  // requires, because this is the point where the originals leave the machine.
  // An original is the platform's response as received, so it routinely carries
  // third-party fragments (quoted authors, a reply parent, profile details) that
  // the normalized record dropped — someone handed this ZIP is receiving more
  // than the library's visible contents.
  const manifest = {
    app: 'Hologram',
    kind: 'complete',
    version: 2,
    source: 'db',
    includesTrash: !!opts.includeTrash,
    exportedAt: nowIso || new Date().toISOString(),
    fileCount,
    rawPayloads: {
      count: rawPayloadCount,
      location: 'library/<captureId>.json の raw[]',
      format: 'payloadBase64 = gzip されたバイト列の base64。sha256 は圧縮前バイト列に対する値。encoding が omitted:oversize の項目は上限超過で本文を持たない',
      privacy: '取得時に受け取った応答そのもの。引用元・返信先・プロフィールなど、ライブラリの表示には出ない第三者の情報を含みうる',
    },
  };
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'hologram-export.json');
  zip.end();
  await streamZipToFile(zip, outPath, onProgress ? (written) => onProgress(written, totalBytes) : undefined);
  return { fileCount };
}

// Images-only: the media files flat at the ZIP root (no sidecars/org JSONs), NOT
// re-importable as a library. Carries no acquisition originals either (#292
// names this export explicitly): this is the "hand someone the pictures" shape,
// and the originals are the part of a record most likely to hold third-party
// fragments the recipient was never meant to receive.
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
// Takes the read stream rather than the entry: yauzl hands out streams from the
// ZipFile, not from the Entry, and keeping the cap stream-shaped is what lets the
// regression tests drive it with a plain Readable.
/** @returns {Promise<void>} — typed so resolve() takes no argument. */
function writeStreamCapped(src: Readable, tmpPath: string, maxBytes: number) {
  return new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    let written = 0;
    let aborted = false;
    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      // destroy(), not pause(): yauzl holds an fd slice open behind the stream,
      // and abandoning a paused one would keep the archive's fd pinned. Safe to
      // call because nothing is pipe()d into it here (yauzl README).
      try {
        src.destroy();
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

// Read a ZIP entry fully into memory, aborting once the actual decompressed
// bytes cross maxBytes (#382). Unlike writeStreamCapped (which streams to
// disk), organization-layer JSON is small enough to hold in memory once
// capped — but the cap has to be enforced against bytes actually read, not the
// declared size, so a lying central-directory header can't slip a >cap entry
// past the declared-size check in extractLibraryEntries.
function readStreamCapped(src: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      try {
        src.destroy();
      } catch {
        /* ignore */
      }
      reject(err);
    };
    src.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail(new ZipLimitError('entry exceeds byte cap'));
        return;
      }
      chunks.push(chunk);
    });
    src.on('error', fail);
    src.on('end', () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
  });
}

// --- Import / restore ----------------------------------------------------------
// Shared, security-critical classification: zip-bomb + zip-slip pre-checks, then
// sorts every library/ entry into the organization-JSON bucket (MERGERS-keyed),
// the new tag-parents.json bucket (#300/St7 — not a MERGERS key, has its own
// resolution logic, see importTagParents), or the capture bucket (screenshots/
// media/avatars/per-post sidecars), plus a .trash/ bucket (#300/St7). Pure
// classification only — no disk/DB writes, so the guards stay in one place ahead of
// the writer.
// Also reports whether this is a COMPLETE export at all (manifest present, or any
// library/ entry) — same test the renderer used to run on its own JSZip copy of
// the archive, moved here so the renderer never has to open the file (#485).
async function extractLibraryEntries(zipfile: ZipReader) {
  const orgEntries: Record<string, ZipEntry> = {};
  let tagParentsEntry: ZipEntry | null = null;
  const captureEntries: Array<{ name: string; entry: ZipEntry }> = [];
  const trashEntries: Array<{ name: string; entry: ZipEntry }> = [];
  let isComplete = false;
  // Zip-bomb pre-checks, all against numbers the archive DECLARES — no decompression
  // happens in this pass, and they cover the whole archive rather than just library/
  // entries (a bomb can hide anywhere).
  //
  // Entry count comes from the end-of-central-directory record, which yauzl has
  // already read at open() — so a 200k-entry bomb is refused without reading a single
  // central-directory record, and yauzl yields exactly that many entries afterwards
  // (a re-count while iterating could never reach the cap on its own).
  if (zipfile.entryCount > MAX_ZIP_ENTRIES) throw new ZipLimitError('archive declares ' + zipfile.entryCount + ' entries (> cap ' + MAX_ZIP_ENTRIES + ')');
  let totalBytes = 0;
  for await (const entry of zipfile.eachEntry()) {
    const relPath = entry.fileName;
    if (relPath.endsWith('/')) continue; // directory entry (yauzl's only marker)
    const size = entryUncompressedSize(entry);
    if (size > MAX_ZIP_ENTRY_BYTES) throw new ZipLimitError('entry "' + relPath + '" declares ' + size + ' bytes (> per-entry cap ' + MAX_ZIP_ENTRY_BYTES + ')');
    totalBytes += size;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw new ZipLimitError('archive declares > ' + MAX_ZIP_TOTAL_BYTES + ' total uncompressed bytes');

    if (relPath === 'hologram-export.json') {
      isComplete = true;
      continue;
    }
    const libMatch = /^library\/(.+)$/.exec(relPath);
    if (libMatch) {
      isComplete = true; // set before the safety filter: a skipped entry still identifies the format
      const name = libMatch[1];
      if (!isSafeLibraryPath(name)) continue; // Zip-Slip: reject separators / traversal / absolute (avatars/<name> allowed)
      if (EXPORT_SKIP.has(name)) continue;
      if (name === 'tag-parents.json') tagParentsEntry = entry;
      else if (MERGERS[name]) {
        // Declared-size half of the org-JSON budget (#382): reject before any
        // extraction happens, same as the generic per-entry check above.
        if (size > MAX_ZIP_ORG_BYTES) throw new ZipLimitError('organization entry "' + relPath + '" declares ' + size + ' bytes (> org cap ' + MAX_ZIP_ORG_BYTES + ')');
        orgEntries[name] = entry;
      } else captureEntries.push({ name, entry });
      continue;
    }
    const trashMatch = /^\.trash\/(.+)$/.exec(relPath);
    if (trashMatch) {
      const name = trashMatch[1];
      if (!isSafeTrashPath(name)) continue;
      trashEntries.push({ name, entry });
    }
  }
  return { isComplete, orgEntries, tagParentsEntry, captureEntries, trashEntries };
}

// Streamed write with a per-entry byte cap, skip-if-exists (idempotent / never
// clobbers), atomic tmp+rename. Shared by the importer's binaries and .trash/
// restore — the only thing that varies is which directory it lands in.
async function writeCaptureFile(zipfile: ZipReader, entry: ZipEntry, destDir: string, name: string): Promise<'imported' | 'skipped'> {
  const dest = path.join(destDir, name);
  try {
    if (!isWithin(destDir, dest)) return 'skipped'; // defensive Zip-Slip guard
    if (fs.existsSync(dest)) return 'skipped';
    if (name.startsWith('avatars/')) await fs.promises.mkdir(path.join(destDir, 'avatars'), { recursive: true });
    const tmp = dest + '.tmp-import';
    // Streamed write with a per-entry byte cap: caps even an entry whose declared
    // size lied past the pre-check above. On abort, drop the partial tmp file.
    try {
      await writeStreamCapped(await zipfile.openReadStreamPromise(entry), tmp, MAX_ZIP_ENTRY_BYTES);
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

// The one complete-ZIP importer (#300/St7). Binaries are a disk copy
// (skip-if-exists); .json capture entries go to the DB, never to disk; the
// organization layer is read from the DB via createDbWriter, merged with the pure
// MERGERS functions, and written back — so importing into a non-empty library never
// wipes current folders/tags. tag-parents.json goes through importTagParents.
// .trash/ entries restore to <destFolder>/.trash/ on disk, untouched by the DB (a
// trashed post has no posts row at all — ipc-trash.ts's delete-post removes it).
//
// Posts are written with the shared writePost (lib-db-record-writer.ts), the same
// producer import-posts/import-images and the inbox consumer use.
//
// Takes a PATH, not bytes (#485): yauzl reads the central directory off an fd and
// streams one entry at a time, so a >4 GiB archive is both readable (ZIP64) and
// bounded in memory. The caller is main — the renderer never opens the file, so
// nothing has to survive a multi-GB round trip through IPC.
//
// Returns { ok:false, notComplete:true } for an archive that is not a complete
// export (no manifest, no library/ entry). The zip-bomb tally has already run at
// that point, so a malformed archive is rejected before anything downstream sees
// it; what to DO with a legacy export is the caller's business (#322).
async function importCompleteZipToDb(sqlite: Database.Database, zipPath: string, destFolder: string) {
  // autoClose:false so entries stay readable after the enumeration pass below
  // (openReadStream needs the fd); closed in the finally.
  const zipfile = await openZipForRead(zipPath, { autoClose: false });
  try {
    return await importFromOpenZip(sqlite, zipfile, destFolder);
  } finally {
    try {
      zipfile.close();
    } catch {
      /* already closed by an error path */
    }
  }
}

async function importFromOpenZip(sqlite: Database.Database, zipfile: ZipReader, destFolder: string) {
  const { isComplete, orgEntries, tagParentsEntry, captureEntries, trashEntries } = await extractLibraryEntries(zipfile);
  if (!isComplete) return { ok: false as const, notComplete: true as const, imported: 0, skipped: 0 };
  try {
    await fs.promises.mkdir(destFolder, { recursive: true });
  } catch {
    /* ignore */
  }
  let imported = 0,
    skipped = 0;

  const jsonCaptures = captureEntries.filter((c) => c.name.toLowerCase().endsWith('.json'));
  const binaryCaptures = captureEntries.filter((c) => !c.name.toLowerCase().endsWith('.json'));

  for (const c of binaryCaptures) {
    if ((await writeCaptureFile(zipfile, c.entry, destFolder, c.name)) === 'imported') imported++;
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
      if ((await writeCaptureFile(zipfile, t.entry, trashDest, t.name)) === 'imported') imported++;
      else skipped++;
    }
  }

  // Per-post sidecars and tag-parents.json are read into memory (they become DB
  // rows, not files), so they get the generic per-entry cap enforced against
  // bytes actually read — a truncated/garbage read just parses to null and the
  // record is skipped, same as before.
  const parseEntry = async (entry: ZipEntry): Promise<any> => {
    try {
      const buf = await readStreamCapped(await zipfile.openReadStreamPromise(entry), MAX_ZIP_ENTRY_BYTES);
      return parseJsonLoose(buf.toString('utf8'));
    } catch {
      return null;
    }
  };
  // Organization-layer JSON goes through the much smaller #382 byte cap: a
  // ZipLimitError here is NOT swallowed — it propagates out of the transaction
  // below so the whole import rejects as malformed, rather than silently merging
  // in a truncated organization state.
  const parseOrgEntry = async (entry: ZipEntry): Promise<any> => {
    const buf = await readStreamCapped(await zipfile.openReadStreamPromise(entry), MAX_ZIP_ORG_BYTES);
    try {
      return parseJsonLoose(buf.toString('utf8'));
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
      writePost(stmts, resolveTagId, fillCardDims(destFolder, rec));
      dbWriter.restorePostFlags(rec.captureId, rec); // userKind/tagReviewed: writePost doesn't carry these (lib-db-write.ts's module comment)
      existingIds.add(rec.captureId);
      imported++;
    }

    // Organization layer: read current DB state -> merge with the incoming JSON
    // (the same pure MERGERS functions) -> write back.
    if (orgEntries['folders.json']) {
      const inc = (await parseOrgEntry(orgEntries['folders.json'])) ?? {};
      dbWriter.setFolders(mergeFolders(dbWriter.getFolders(), inc));
    }
    if (orgEntries['ungrouped.json']) {
      const inc = (await parseOrgEntry(orgEntries['ungrouped.json'])) ?? {};
      dbWriter.setUngrouped(mergeUngrouped(dbWriter.getUngrouped(), inc).keys);
    }
    if (orgEntries['manual-groups.json']) {
      const inc = (await parseOrgEntry(orgEntries['manual-groups.json'])) ?? {};
      dbWriter.setManualGroups(mergeManualGroups(dbWriter.getManualGroups(), inc).groups);
    }
    if (orgEntries['poster-folders.json']) {
      const inc = (await parseOrgEntry(orgEntries['poster-folders.json'])) ?? {};
      dbWriter.setPosterFolders(mergePosterFolders(dbWriter.getPosterFolders(), inc));
    }
    if (orgEntries['poster-tags.json']) {
      const inc = (await parseOrgEntry(orgEntries['poster-tags.json'])) ?? {};
      dbWriter.setPosterTags(mergePosterTags(dbWriter.getPosterTags(), inc));
    }
    if (orgEntries['tag-types.json']) {
      const inc = (await parseOrgEntry(orgEntries['tag-types.json'])) ?? {};
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

  return { ok: true as const, notComplete: false as const, imported, skipped };
}

export {
  EXPORT_SKIP,
  ORG_MERGE,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  MAX_ZIP_ORG_BYTES,
  ZipLimitError,
  writeStreamCapped,
  readStreamCapped,
  writeCompleteZip,
  writeImagesZip,
  hasExportableFiles,
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
