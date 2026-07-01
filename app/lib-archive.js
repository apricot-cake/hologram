'use strict';

// Complete library archive: build a directly-re-importable ZIP snapshot of the
// save folder, and restore one. Kept dependency-free (fs/path + a JSZip ctor
// passed in) so it can be unit-tested without spinning up Electron.
//
// ZIP layout:
//   library/<captureId>.jpg            screenshot
//   library/<captureId>.json           sidecar (verbatim)
//   library/<captureId>-media-N.<ext>  original media
//   library/folders.json|tag-groups.json|tag-types.json|ungrouped.json|manual-groups.json
//   corpus-export.json                 manifest { app, kind:'complete', version, exportedAt, fileCount }
//
// Excluded from the snapshot: config.json (machine-specific: paths, extension id)
// and .index.json (cache). On import, captures are copied SKIPPING existing files
// (idempotent / non-clobbering) and the organization JSONs are MERGED (union) so
// importing into a non-empty library never wipes current folders/tags.

const fs = require('node:fs');
const path = require('node:path');

const EXPORT_SKIP = new Set(['config.json', '.index.json']);
const ORG_MERGE = ['folders.json', 'collections.json', 'tag-groups.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json'];

function isVolatile(name) {
  return /\.tmp(-|$)/i.test(name) || /\.bak$/i.test(name);
}

// --- Zip-bomb / unbounded-expansion guard -------------------------------------
// A `corpus-export.zip` is shared between machines, so a malicious/corrupt one can
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
// Belt-and-suspenders: the resolved destination must stay inside destFolder.
function isWithin(parentDir, target) {
  const p = path.resolve(parentDir);
  const t = path.resolve(target);
  return t === p || t.startsWith(p + path.sep);
}

// --- Organization merges (union) ---------------------------------------------
function mergeFolders(cur, inc) {
  const byId = new Map();
  for (const f of cur.folders || []) if (f && typeof f.id === 'string') byId.set(f.id, { id: f.id, name: String(f.name || f.id), items: new Set((f.items || []).map(String)) });
  for (const f of inc.folders || []) {
    if (!f || typeof f.id !== 'string') continue;
    if (byId.has(f.id)) for (const it of f.items || []) byId.get(f.id).items.add(String(it));
    else byId.set(f.id, { id: f.id, name: String(f.name || f.id), items: new Set((f.items || []).map(String)) });
  }
  const folders = [...byId.values()].map((f) => ({ id: f.id, name: f.name, items: [...f.items] }));
  const defaultId = folders.some((f) => f.id === cur.defaultId) ? cur.defaultId : folders.some((f) => f.id === inc.defaultId) ? inc.defaultId : null;
  return { folders, defaultId };
}
// Collections (the unified folders container). id-union on items; name/kind/created/
// tree are LOCAL-wins (cur put first, dup only unions items). activeId is legacy and
// stays local if it still points at a live collection; clip + posterWorkspace union.
function mergeCollections(cur, inc) {
  const byId = new Map();
  const put = (c) => {
    if (!c || typeof c.id !== 'string') return;
    if (byId.has(c.id)) {
      const e = byId.get(c.id);
      for (const it of c.items || []) e.items.add(String(it));
      return;
    }
    const e = { id: c.id, name: String(c.name || c.id), kind: c.kind === 'dynamic' ? 'dynamic' : 'static', created: typeof c.created === 'number' ? c.created : null, items: new Set((c.items || []).map(String)) };
    if (c.kind === 'dynamic') {
      // saved-search payload rides along (LOCAL-wins, like name/kind)
      if (c.tree && typeof c.tree === 'object') e.tree = c.tree;
      if (typeof c.q === 'string' && c.q) e.q = c.q;
    }
    byId.set(c.id, e);
  };
  for (const c of (cur && cur.collections) || []) put(c);
  for (const c of (inc && inc.collections) || []) put(c);
  const collections = [...byId.values()].map((c) => {
    const o = { id: c.id, name: c.name, kind: c.kind, created: c.created, items: [...c.items] };
    if (c.tree) o.tree = c.tree;
    if (c.q) o.q = c.q;
    return o;
  });
  const valid = new Set(collections.map((c) => c.id));
  const activeId = cur && valid.has(cur.activeId) ? cur.activeId : inc && valid.has(inc.activeId) ? inc.activeId : null;
  const clip = [...new Set([...((cur && cur.clip) || []), ...((inc && inc.clip) || [])].map(String))];
  const posterWorkspace = [...new Set([...((cur && cur.posterWorkspace) || []), ...((inc && inc.posterWorkspace) || [])].map(String))];
  return { collections, activeId, clip, posterWorkspace };
}
// Convert a legacy folders.json into the collections shape (for folding an old
// export ZIP into a migrated library). Folders → static collections; the incoming
// workspace is dropped (don't import a foreign active tray); posterWorkspace rides along.
function foldersToCollections(legacy) {
  const folders = Array.isArray(legacy && legacy.folders) ? legacy.folders : [];
  const collections = folders
    .filter((f) => f && typeof f.id === 'string')
    .map((f) => ({
      id: f.id,
      name: String(f.name || f.id),
      kind: 'static',
      created: null,
      items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [],
    }));
  const posterWorkspace = Array.isArray(legacy && legacy.posterWorkspace) ? [...new Set(legacy.posterWorkspace.map(String))] : [];
  return { collections, activeId: null, posterWorkspace };
}
function mergeTagGroups(cur, inc) {
  const byId = new Map();
  for (const g of cur.groups || []) if (g && typeof g.id === 'string') byId.set(g.id, { id: g.id, name: String(g.name || g.id), tags: new Set((g.tags || []).map(String)) });
  for (const g of inc.groups || []) {
    if (!g || typeof g.id !== 'string') continue;
    if (byId.has(g.id)) for (const t of g.tags || []) byId.get(g.id).tags.add(String(t));
    else byId.set(g.id, { id: g.id, name: String(g.name || g.id), tags: new Set((g.tags || []).map(String)) });
  }
  return { groups: [...byId.values()].map((g) => ({ id: g.id, name: g.name, tags: [...g.tags] })) };
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
  const out = { types };
  if (Object.keys(labels).length) out.labels = labels;
  return out;
}
function mergeManualGroups(cur, inc) {
  const seen = new Set();
  const out = [];
  for (const g of [...(cur.groups || []), ...(inc.groups || [])]) {
    if (!Array.isArray(g) || g.length < 2) continue;
    const arr = g.map(String);
    const key = [...arr].sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(arr);
  }
  return { groups: out };
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
  for (const [k, set] of Object.entries(out)) tags[k] = [...set];
  return { tags };
}
const MERGERS = {
  'folders.json': mergeFolders, // legacy ZIPs — folded into collections.json on import
  'collections.json': mergeCollections,
  'tag-groups.json': mergeTagGroups,
  'tag-types.json': mergeTagTypes,
  'ungrouped.json': mergeUngrouped,
  'manual-groups.json': mergeManualGroups,
  'poster-favorites.json': mergeUngrouped, // same { keys } shape → union merge
  'poster-folders.json': mergeFolders, // same { folders } shape → id-union merge
  'poster-tags.json': mergePosterTags, // { tags:{posterKey:[…]} } → per-key union
};

// --- Build ---------------------------------------------------------------------
async function buildCompleteZip(JSZip, srcFolder, nowIso) {
  const zip = new JSZip();
  const lib = zip.folder('library');
  let names = [];
  try {
    names = await fs.promises.readdir(srcFolder);
  } catch {
    names = [];
  }
  let fileCount = 0;
  for (const name of names) {
    if (EXPORT_SKIP.has(name) || isVolatile(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(srcFolder, name));
      if (!st.isFile()) continue;
      lib.file(name, await fs.promises.readFile(path.join(srcFolder, name)));
      fileCount++;
    } catch {
      /* skip unreadable */
    }
  }
  zip.file(
    'corpus-export.json',
    JSON.stringify(
      {
        app: 'Corpus',
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
  let names = [];
  try {
    names = await fs.promises.readdir(srcFolder);
  } catch {
    names = [];
  }
  let fileCount = 0;
  for (const name of names) {
    if (EXPORT_SKIP.has(name) || isVolatile(name) || !IMAGE_EXT.test(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(srcFolder, name));
      if (!st.isFile()) continue;
      zip.file(name, await fs.promises.readFile(path.join(srcFolder, name)));
      fileCount++;
    } catch {
      /* skip unreadable */
    }
  }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), fileCount };
}

// Stream a single ZIP entry to disk, aborting if its decompressed output exceeds
// maxBytes. Never buffers the whole entry in memory, so a bomb that under-declares
// its size in the central directory is still capped at the byte budget (it just
// pays decompression cost up to the cap, then the partial file is discarded).
function writeEntryStreamed(entry, tmpPath, maxBytes) {
  return new Promise((resolve, reject) => {
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
  const orgEntries = {};
  const captures = [];
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
    if (!isSafeEntryName(name)) return; // Zip-Slip: reject separators / traversal / absolute
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
      return JSON.parse(fs.readFileSync(path.join(destFolder, file), 'utf8'));
    } catch {
      return {};
    }
  };
  // Atomic tmp+rename for the merged organization JSON: a crash mid-merge must not
  // leave a torn/zero-byte collections.json (etc.) that the app then reads as empty
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
      inc = JSON.parse(await orgEntries[name].async('string'));
    } catch {
      inc = {};
    }
    if (name === 'folders.json') {
      // Legacy export: fold its folders into collections.json (don't resurrect the
      // retired folders.json on a migrated library).
      const merged = mergeCollections(readCur('collections.json'), foldersToCollections(inc));
      try {
        await writeOrgAtomic('collections.json', merged);
      } catch {
        /* ignore */
      }
      continue;
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

module.exports = {
  EXPORT_SKIP,
  ORG_MERGE,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_BYTES,
  ZipLimitError,
  writeEntryStreamed,
  buildCompleteZip,
  buildImagesZip,
  importCompleteZip,
  mergeFolders,
  mergeCollections,
  foldersToCollections,
  mergeTagGroups,
  mergeTagTypes,
  mergeUngrouped,
  mergeManualGroups,
};
