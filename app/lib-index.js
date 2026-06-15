'use strict';

// On-disk + in-memory index over a save folder's sidecar JSONs.
//
// listPosts() used to readdirSync + readFileSync + JSON.parse EVERY sidecar on
// every call (startup and after every capture), which froze the main process for
// ~900ms on a ~9k-post folder — and a capture fires the folder watcher, so the
// freeze hit on every save. This index keeps each parsed record keyed by
// filename + mtimeMs, so a refresh re-reads only the sidecars that actually
// changed (O(changed), ~tens of ms) and a cold start restores from one snapshot
// read instead of tens of thousands of small reads.
//
// Kept Electron-free (fs injected, defaults to node's) so it unit-tests in plain
// node, mirroring lib-archive.js.

const path = require('path');
const { imageSize } = require('./lib-imgsize.js');

const INDEX_FILE = '.index.json';
const BATCH = 64;   // stat/read this many sidecars concurrently, then yield

const SS_EXT = /\.jpe?g$/i;
const IMG_EXT = /\.(jpe?g|png|gif|webp)$/i;
const HEADER_BYTES = 65536;       // covers a JPEG SOF past JFIF/short EXIF, plus PNG/GIF/WebP
const HEADER_BYTES_2 = 262144;    // retry window for big-EXIF JPEGs (eagle migrations)

function isPostRecord(rec) {
  // Keep records with an image, a (poster-less) video, or downloaded media —
  // identical to the legacy listPosts() filter.
  return !!(rec && (rec.image || rec.video || (Array.isArray(rec.media) && rec.media.length)));
}

// The file shown in CARD view — mirrors the renderer's densityImage('card'): the
// capture screenshot leads, else the first media file, else a non-screenshot
// artwork image. Drag / eagle-migration images are artworks, not screenshots.
function cardImageFile(rec) {
  const isShot = rec.image && SS_EXT.test(rec.image) && rec.source !== 'drag' && rec.source !== 'eagle-migration';
  if (isShot) return rec.image;
  const media = Array.isArray(rec.media) ? rec.media.filter((m) => m && m.file).map((m) => m.file) : [];
  if (media.length) return media[0];
  return rec.image || '';
}

// internalFiles: a Set of basenames in the save folder that are app metadata, not
// posts (config/tabs/folders/…/.index.json). fs: injectable for tests.
function createPostIndex(opts) {
  const o = opts || {};
  const fs = o.fs || require('fs');
  const internal = o.internalFiles || new Set();

  let curFolder = null;
  let map = new Map();          // filename -> { mtimeMs, record|null }  (null = known non-post)
  let snapshotLoaded = false;

  // Read just the image header (no decode) and return { width, height } or null.
  async function readImageDims(folder, file) {
    if (!fs.promises || typeof fs.promises.open !== 'function') return null;   // test fs has no open()
    let fh = null;
    try {
      fh = await fs.promises.open(path.join(folder, file), 'r');
      const buf = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEADER_BYTES, 0);
      let dim = imageSize(buf.subarray(0, bytesRead));
      if (!dim && bytesRead === HEADER_BYTES) {            // SOF past the first window (big EXIF) — read more
        const buf2 = Buffer.alloc(HEADER_BYTES_2);
        const r2 = await fh.read(buf2, 0, HEADER_BYTES_2, 0);
        dim = imageSize(buf2.subarray(0, r2.bytesRead));
      }
      return dim;
    } catch { return null; }
    finally { if (fh) { try { await fh.close(); } catch {} } }
  }

  // Record the card image's pixel size on the record (shotW/shotH) so the
  // renderer reserves each masonry card's height BEFORE its lazy image loads =
  // no load-time settle/jitter. Sentinel 0/0 = "tried, unsizable" (video/corrupt)
  // so we don't re-read it every scan. Returns true if it mutated the record (the
  // caller then marks the snapshot dirty). No-op when fs lacks open() — the unit-
  // test fs — so the index's read accounting is unchanged under test.
  async function augmentDims(folder, rec) {
    if (!rec || rec.shotW != null) return false;
    if (!fs.promises || typeof fs.promises.open !== 'function') return false;
    const file = cardImageFile(rec);
    const dim = (file && IMG_EXT.test(file)) ? await readImageDims(folder, file) : null;
    if (dim && dim.width > 0 && dim.height > 0) { rec.shotW = dim.width; rec.shotH = dim.height; }
    else { rec.shotW = 0; rec.shotH = 0; }
    return true;
  }

  async function loadSnapshot(folder) {
    if (curFolder !== folder) { map = new Map(); curFolder = folder; snapshotLoaded = false; }
    if (snapshotLoaded) return;
    snapshotLoaded = true;      // mark first so a missing/corrupt snapshot isn't retried each call
    try {
      const raw = await fs.promises.readFile(path.join(folder, INDEX_FILE), 'utf8');
      const idx = JSON.parse(raw);
      if (idx && idx.version === 1 && idx.entries && typeof idx.entries === 'object') {
        for (const name of Object.keys(idx.entries)) {
          const e = idx.entries[name];
          if (e && typeof e.mtimeMs === 'number') map.set(name, { mtimeMs: e.mtimeMs, record: e.record || null });
        }
      }
    } catch { /* no/invalid snapshot — cold scan will populate it */ }
  }

  // Scan the folder, reusing cached records whose mtime is unchanged. Returns
  // { posts, changed } — `changed` is true if anything was added/updated/removed
  // (the caller persists the snapshot when so).
  async function list(folder) {
    let files;
    try { files = await fs.promises.readdir(folder); } catch { return { posts: [], changed: false }; }
    await loadSnapshot(folder);

    const sidecars = files.filter((f) => f.toLowerCase().endsWith('.json') && !internal.has(f));
    const present = new Set(sidecars);
    let changed = false;

    for (let i = 0; i < sidecars.length; i += BATCH) {
      const slice = sidecars.slice(i, i + BATCH);
      await Promise.all(slice.map(async (f) => {
        let st;
        try { st = await fs.promises.stat(path.join(folder, f)); }
        catch { if (map.delete(f)) changed = true; return; }
        const cached = map.get(f);
        if (cached && cached.mtimeMs === st.mtimeMs) {          // unchanged -> reuse parsed record
          // One-time backfill: size posts whose snapshot predates shotW/shotH.
          if (cached.record && cached.record.shotW == null && await augmentDims(folder, cached.record)) changed = true;
          return;
        }
        changed = true;
        try {
          const rec = JSON.parse(await fs.promises.readFile(path.join(folder, f), 'utf8'));
          const record = isPostRecord(rec) ? rec : null;
          if (record) await augmentDims(folder, record);
          map.set(f, { mtimeMs: st.mtimeMs, record });
        } catch {
          map.set(f, { mtimeMs: st.mtimeMs, record: null });   // corrupt/partial -> remember as non-post
        }
      }));
    }

    // Prune entries for sidecars that disappeared (deletes).
    for (const k of [...map.keys()]) if (!present.has(k)) { map.delete(k); changed = true; }

    const posts = [];
    const stamps = new Map();   // captureId -> mtimeMs, for the main process's delta IPC
    for (const f of sidecars) {
      const e = map.get(f);
      if (e && e.record) { posts.push(e.record); stamps.set(e.record.captureId, e.mtimeMs); }
    }
    posts.sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));
    return { posts, changed, stamps };
  }

  // Targeted update: re-stat/read ONLY the named sidecars (from fs.watch's
  // changed-filename events) instead of stat-ing the whole folder. Returns the
  // changes so the caller can ship them as a delta: added = [{id, mtimeMs,
  // record}] for new/edited posts, removed = [captureId] for deleted ones (or
  // ones that became non-posts). This is the O(changed) end-to-end path; the
  // full list() stays the reliable fallback (initial load, folder switch, or a
  // watch event with no usable filename).
  async function applyChanges(folder, names) {
    await loadSnapshot(folder);
    const added = [];
    const removed = [];
    for (const f of names) {
      if (typeof f !== 'string' || internal.has(f) || !f.toLowerCase().endsWith('.json')) continue;
      const full = path.join(folder, f);
      let st = null;
      try { st = await fs.promises.stat(full); } catch { st = null; }
      const prev = map.get(f);
      if (!st) {                                   // deleted
        if (prev) { if (prev.record) removed.push(prev.record.captureId); map.delete(f); }
        continue;
      }
      if (prev && prev.mtimeMs === st.mtimeMs) continue;   // spurious event, nothing moved
      let rec = null;
      try { rec = JSON.parse(await fs.promises.readFile(full, 'utf8')); } catch { rec = null; }
      const record = isPostRecord(rec) ? rec : null;
      if (record) await augmentDims(folder, record);
      // Previous post vanished (became a non-post, or — defensively — its id moved).
      if (prev && prev.record && (!record || record.captureId !== prev.record.captureId)) {
        removed.push(prev.record.captureId);
      }
      map.set(f, { mtimeMs: st.mtimeMs, record });
      if (record) added.push({ id: record.captureId, mtimeMs: st.mtimeMs, record });
    }
    return { added, removed };
  }

  // Persist the current map to <folder>/.index.json atomically (tmp + rename).
  // Best-effort: a failure just means the next cold start re-scans.
  async function writeSnapshot(folder) {
    const entries = {};
    for (const [name, e] of map) entries[name] = e;
    const payload = JSON.stringify({ version: 1, entries });
    const tmp = path.join(folder, INDEX_FILE + '.tmp');
    await fs.promises.writeFile(tmp, payload, 'utf8');
    await fs.promises.rename(tmp, path.join(folder, INDEX_FILE));
  }

  return { list, applyChanges, writeSnapshot, INDEX_FILE, _size: () => map.size };
}

// Compute the renderer delta between what was last delivered (lastSent: a Map of
// captureId -> mtimeMs) and the current scan (posts + stamps). added = records
// that are new or whose mtime moved; removed = ids no longer present. Pure so it
// unit-tests directly (the main process owns the lastSent state).
function computeDelta(lastSent, posts, stamps) {
  const added = [];
  for (const p of posts) { if (lastSent.get(p.captureId) !== stamps.get(p.captureId)) added.push(p); }
  const removed = [];
  for (const id of lastSent.keys()) if (!stamps.has(id)) removed.push(id);
  return { added, removed };
}

module.exports = { createPostIndex, computeDelta, INDEX_FILE, isPostRecord };
