'use strict';

// Complete library archive: build a directly-re-importable ZIP snapshot of the
// save folder, and restore one. Kept dependency-free (fs/path + a JSZip ctor
// passed in) so it can be unit-tested without spinning up Electron.
//
// ZIP layout:
//   library/<captureId>.jpg            screenshot
//   library/<captureId>.json           sidecar (verbatim)
//   library/<captureId>-media-N.<ext>  original media
//   library/avatars/<urlhash>.<ext>    shared avatar store (one file per avatar URL)
//   library/folders.json|tag-types.json|ungrouped.json|manual-groups.json
//   hologram-export.json                 manifest { app, kind:'complete', version, exportedAt, fileCount }
//
// Excluded from the snapshot: config.json (machine-specific: paths, extension id)
// and .index.json (cache). On import, captures are copied SKIPPING existing files
// (idempotent / non-clobbering) and the organization JSONs are MERGED (union) so
// importing into a non-empty library never wipes current folders/tags.

import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { ZipFile } from 'yazl';
import { parseJsonLoose } from './lib-json';

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

// Complete, directly-re-importable snapshot: every top-level library file under
// library/, the shared avatar store under library/avatars/, plus a hologram-export.json
// manifest. Returns the file count (excludes the manifest), matching the old builder.
// onProgress(writtenBytes, totalBytes) fires as the archive streams out — totalBytes is
// the summed input size (STORED, so output ≈ input + small headers), good enough to drive
// a taskbar / % progress bar.
async function writeCompleteZip(srcFolder, outPath, nowIso, onProgress?: (written: number, total: number) => void) {
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
  for (const name of await collectFiles(srcFolder)) await addFile(path.join(srcFolder, name), `library/${name}`);
  for (const name of await collectFiles(path.join(srcFolder, 'avatars'))) await addFile(path.join(srcFolder, 'avatars', name), `library/avatars/${name}`);
  zip.addBuffer(Buffer.from(JSON.stringify({ app: 'Hologram', kind: 'complete', version: 1, exportedAt: nowIso || new Date().toISOString(), fileCount }, null, 2)), 'hologram-export.json');
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
async function importCompleteZip(JSZip, destFolder, buffer) {
  try {
    await fs.promises.mkdir(destFolder, { recursive: true });
  } catch {
    /* ignore */
  }
  const zip = await JSZip.loadAsync(buffer);
  let imported = 0,
    skipped = 0;
  const orgEntries: any = {};
  const captures: any[] = [];
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
    const m = /^library\/(.+)$/.exec(relPath);
    if (!m) return;
    const name = m[1];
    if (!isSafeLibraryPath(name)) return; // Zip-Slip: reject separators / traversal / absolute (avatars/<name> allowed)
    if (EXPORT_SKIP.has(name)) return;
    if (MERGERS[name]) orgEntries[name] = entry;
    else captures.push({ name, entry });
  });
  for (const c of captures) {
    const dest = path.join(destFolder, c.name);
    try {
      if (!isWithin(destFolder, dest)) {
        skipped++;
        continue;
      } // defensive Zip-Slip guard
      if (fs.existsSync(dest)) {
        skipped++;
        continue;
      }
      if (c.name.startsWith('avatars/')) await fs.promises.mkdir(path.join(destFolder, 'avatars'), { recursive: true });
      const tmp = dest + '.tmp-import';
      // Streamed write with a per-entry byte cap: caps even an entry whose declared
      // size lied past the pre-check above. On abort, drop the partial tmp file.
      try {
        await writeEntryStreamed(c.entry, tmp, MAX_ZIP_ENTRY_BYTES);
      } catch (e) {
        try {
          await fs.promises.unlink(tmp);
        } catch {
          /* ignore */
        }
        if (e instanceof ZipLimitError) {
          skipped++;
          continue;
        }
        throw e;
      }
      await fs.promises.rename(tmp, dest);
      imported++;
    } catch {
      skipped++;
    }
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

export { EXPORT_SKIP, ORG_MERGE, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES, MAX_ZIP_TOTAL_BYTES, ZipLimitError, writeEntryStreamed, buildCompleteZip, buildImagesZip, writeCompleteZip, writeImagesZip, hasExportableFiles, importCompleteZip, mergeFolders, mergePosterFolders, mergeTagTypes, mergeUngrouped, mergeManualGroups };
