'use strict';

// Complete library archive: build a directly-re-importable ZIP snapshot of the
// save folder, and restore one. Kept dependency-free (fs/path + a JSZip ctor
// passed in) so it can be unit-tested without spinning up Electron.
//
// ZIP layout:
//   library/<captureId>.jpg            screenshot
//   library/<captureId>.json           sidecar (verbatim)
//   library/<captureId>-media-N.<ext>  original media
//   library/folders.json|tag-groups.json|ungrouped.json|manual-groups.json
//   corpus-export.json                 manifest { app, kind:'complete', version, exportedAt, fileCount }
//
// Excluded from the snapshot: config.json (machine-specific: paths, extension id)
// and .index.json (cache). On import, captures are copied SKIPPING existing files
// (idempotent / non-clobbering) and the organization JSONs are MERGED (union) so
// importing into a non-empty library never wipes current folders/tags.

const fs = require('fs');
const path = require('path');

const EXPORT_SKIP = new Set(['config.json', '.index.json']);
const ORG_MERGE = ['folders.json', 'tag-groups.json', 'ungrouped.json', 'manual-groups.json'];

function isVolatile(name) { return /\.tmp(-|$)/i.test(name) || /\.bak$/i.test(name); }

// --- Organization merges (union) ---------------------------------------------
function mergeFolders(cur, inc) {
  const byId = new Map();
  for (const f of (cur.folders || [])) if (f && typeof f.id === 'string') byId.set(f.id, { id: f.id, name: String(f.name || f.id), items: new Set((f.items || []).map(String)) });
  for (const f of (inc.folders || [])) {
    if (!f || typeof f.id !== 'string') continue;
    if (byId.has(f.id)) for (const it of (f.items || [])) byId.get(f.id).items.add(String(it));
    else byId.set(f.id, { id: f.id, name: String(f.name || f.id), items: new Set((f.items || []).map(String)) });
  }
  const folders = [...byId.values()].map((f) => ({ id: f.id, name: f.name, items: [...f.items] }));
  const defaultId = folders.some((f) => f.id === cur.defaultId) ? cur.defaultId
    : (folders.some((f) => f.id === inc.defaultId) ? inc.defaultId : null);
  return { folders, defaultId };
}
function mergeTagGroups(cur, inc) {
  const byId = new Map();
  for (const g of (cur.groups || [])) if (g && typeof g.id === 'string') byId.set(g.id, { id: g.id, name: String(g.name || g.id), tags: new Set((g.tags || []).map(String)) });
  for (const g of (inc.groups || [])) {
    if (!g || typeof g.id !== 'string') continue;
    if (byId.has(g.id)) for (const t of (g.tags || [])) byId.get(g.id).tags.add(String(t));
    else byId.set(g.id, { id: g.id, name: String(g.name || g.id), tags: new Set((g.tags || []).map(String)) });
  }
  return { groups: [...byId.values()].map((g) => ({ id: g.id, name: g.name, tags: [...g.tags] })) };
}
function mergeUngrouped(cur, inc) {
  return { keys: [...new Set([...(cur.keys || []), ...(inc.keys || [])].map(String))] };
}
function mergeManualGroups(cur, inc) {
  const seen = new Set(); const out = [];
  for (const g of [...(cur.groups || []), ...(inc.groups || [])]) {
    if (!Array.isArray(g) || g.length < 2) continue;
    const arr = g.map(String);
    const key = [...arr].sort().join(' ');
    if (seen.has(key)) continue;
    seen.add(key); out.push(arr);
  }
  return { groups: out };
}
const MERGERS = {
  'folders.json': mergeFolders,
  'tag-groups.json': mergeTagGroups,
  'ungrouped.json': mergeUngrouped,
  'manual-groups.json': mergeManualGroups
};

// --- Build ---------------------------------------------------------------------
async function buildCompleteZip(JSZip, srcFolder, nowIso) {
  const zip = new JSZip();
  const lib = zip.folder('library');
  let names = [];
  try { names = await fs.promises.readdir(srcFolder); } catch { names = []; }
  let fileCount = 0;
  for (const name of names) {
    if (EXPORT_SKIP.has(name) || isVolatile(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(srcFolder, name));
      if (!st.isFile()) continue;
      lib.file(name, await fs.promises.readFile(path.join(srcFolder, name)));
      fileCount++;
    } catch { /* skip unreadable */ }
  }
  zip.file('corpus-export.json', JSON.stringify({
    app: 'Corpus', kind: 'complete', version: 1, exportedAt: nowIso || new Date().toISOString(), fileCount
  }, null, 2));
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), fileCount };
}

// Images-only ZIP: just the media files (jpg/png/webp/gif + video), flat at the
// ZIP root — no sidecars, no organization JSONs, NOT re-importable as a library.
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|mov|m4v)$/i;
async function buildImagesZip(JSZip, srcFolder) {
  const zip = new JSZip();
  let names = [];
  try { names = await fs.promises.readdir(srcFolder); } catch { names = []; }
  let fileCount = 0;
  for (const name of names) {
    if (EXPORT_SKIP.has(name) || isVolatile(name) || !IMAGE_EXT.test(name)) continue;
    try {
      const st = await fs.promises.stat(path.join(srcFolder, name));
      if (!st.isFile()) continue;
      zip.file(name, await fs.promises.readFile(path.join(srcFolder, name)));
      fileCount++;
    } catch { /* skip unreadable */ }
  }
  return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), fileCount };
}

// --- Import / restore ----------------------------------------------------------
async function importCompleteZip(JSZip, destFolder, buffer) {
  try { await fs.promises.mkdir(destFolder, { recursive: true }); } catch { /* ignore */ }
  const zip = await JSZip.loadAsync(buffer);
  let imported = 0, skipped = 0;
  const orgEntries = {};
  const captures = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    const m = /^library\/(.+)$/.exec(relPath);
    if (!m || m[1].indexOf('/') >= 0) return;   // only top-level files under library/
    const name = m[1];
    if (EXPORT_SKIP.has(name)) return;
    if (MERGERS[name]) orgEntries[name] = entry;
    else captures.push({ name, entry });
  });
  for (const c of captures) {
    const dest = path.join(destFolder, c.name);
    try {
      if (fs.existsSync(dest)) { skipped++; continue; }
      const tmp = dest + '.tmp-import';
      await fs.promises.writeFile(tmp, await c.entry.async('nodebuffer'));
      await fs.promises.rename(tmp, dest);
      imported++;
    } catch { skipped++; }
  }
  const readCur = (file) => { try { return JSON.parse(fs.readFileSync(path.join(destFolder, file), 'utf8')); } catch { return {}; } };
  for (const name of ORG_MERGE) {
    if (!orgEntries[name]) continue;
    let inc = {};
    try { inc = JSON.parse(await orgEntries[name].async('string')); } catch { inc = {}; }
    const merged = MERGERS[name](readCur(name), inc);
    try { fs.writeFileSync(path.join(destFolder, name), JSON.stringify(merged, null, 2), 'utf8'); } catch { /* ignore */ }
  }
  return { ok: true, imported, skipped };
}

module.exports = {
  EXPORT_SKIP, ORG_MERGE,
  buildCompleteZip, buildImagesZip, importCompleteZip,
  mergeFolders, mergeTagGroups, mergeUngrouped, mergeManualGroups
};
