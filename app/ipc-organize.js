'use strict';

// Organization-layer IPC handlers, extracted from main.js (mechanical move — logic
// unchanged). These 16 get/set channels persist the per-library organization JSON
// files (tag groups, tag 種別, ungrouped set, manual groups, folders, collections,
// poster folders/tags) alongside the sidecars. Every handler needs only the same
// three core helpers — getSaveFolder + readOrgJsonSync + writeOrgJsonSync — which
// stay in main.js and arrive via ctx. See main.js for the org-JSON degraded-guard
// (readOrgJsonSync/writeOrgJsonSync refuse to clobber a present-but-corrupt file).
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function register(ctx) {
  const { getSaveFolder, readOrgJsonSync, writeOrgJsonSync } = ctx;

  // Tag groups (migrated from the imported library's metadata) live alongside the
  // sidecars as <saveFolder>/tag-groups.json: { groups: [{id,name,tags[]}] }.
  ipcMain.handle('get-tag-groups', () => {
    const folder = getSaveFolder();
    if (!folder) return { groups: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'tag-groups.json'));
    return { groups: (j && Array.isArray(j.groups)) ? j.groups : [] };
  });

  ipcMain.handle('set-tag-groups', (_e, groups) => {
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(groups)) return { ok: false };
    try {
      fs.mkdirSync(folder, { recursive: true });
      writeOrgJsonSync(path.join(folder, 'tag-groups.json'), { groups });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Tag "vocabulary book" (用語帳): a tag's 種別 (kind) is an attribute of the TAG,
  // not of any post — so classifying a few hundred distinct tags needs zero post
  // migration. Lives as <saveFolder>/tag-types.json: { types: { "<tag>": "work"|
  // "character" } }. Tags absent from the map are implicitly 一般 (general). The
  // renamable work⊃character pair powers the (later) copyright/character sections;
  // `labels` is reserved/pass-through for that phase.
  ipcMain.handle('get-tag-types', () => {
    const folder = getSaveFolder();
    if (!folder) return { types: {}, labels: null };
    const { value: j } = readOrgJsonSync(path.join(folder, 'tag-types.json'));
    const types = (j && j.types && typeof j.types === 'object') ? j.types : {};
    const labels = (j && j.labels && typeof j.labels === 'object') ? j.labels : null;
    return { types, labels };
  });

  ipcMain.handle('set-tag-types', (_e, types, labels) => {
    const folder = getSaveFolder();
    if (!folder || !types || typeof types !== 'object') return { ok: false };
    try {
      fs.mkdirSync(folder, { recursive: true });
      const out = { types };
      if (labels && typeof labels === 'object') out.labels = labels;
      writeOrgJsonSync(path.join(folder, 'tag-types.json'), out);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Persistent per-post "do not group" set (image-view). Post keys whose images
  // should stay individual tiles (e.g. several pics from one post that aren't a
  // multi-page work). Lives as <saveFolder>/ungrouped.json: { keys: [...] }.
  ipcMain.handle('get-ungrouped', () => {
    const folder = getSaveFolder();
    if (!folder) return { keys: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'ungrouped.json'));
    return { keys: (j && Array.isArray(j.keys)) ? j.keys : [] };
  });
  ipcMain.handle('set-ungrouped', (_e, keys) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      writeOrgJsonSync(path.join(folder, 'ungrouped.json'),
        { keys: Array.isArray(keys) ? keys.map(String) : [] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // (poster favorites feature removed; legacy <saveFolder>/poster-favorites.json is
  // still listed in INTERNAL_FILES so the post index keeps skipping it.)

  // Named poster folders (poster view). { folders: [{ id, name, items:[posterKey] }] }
  // — same shape as folders.json (minus workspace), so import reuses mergeFolders.
  ipcMain.handle('get-poster-folders', () => {
    const folder = getSaveFolder();
    if (!folder) return { folders: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'poster-folders.json'));
    return { folders: (j && Array.isArray(j.folders)) ? j.folders : [] };
  });
  ipcMain.handle('set-poster-folders', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder || !data || !Array.isArray(data.folders)) return { ok: false };
    try {
      writeOrgJsonSync(path.join(folder, 'poster-folders.json'), { folders: data.folders });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Per-poster tags (poster view). { tags: { "<posterKey>": ["tag", …] } } — the
  // poster-level peer of poster-folders. Shares the post tag
  // vocabulary (tag-groups/tag-types) but is keyed by poster, NOT stored on posts.
  ipcMain.handle('get-poster-tags', () => {
    const folder = getSaveFolder();
    if (!folder) return { tags: {} };
    const { value: j } = readOrgJsonSync(path.join(folder, 'poster-tags.json'));
    return { tags: (j && typeof j.tags === 'object' && j.tags) ? j.tags : {} };
  });
  ipcMain.handle('set-poster-tags', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder || !data || typeof data.tags !== 'object' || !data.tags) return { ok: false };
    try {
      writeOrgJsonSync(path.join(folder, 'poster-tags.json'), { tags: data.tags });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Manual image groups (image-view): user-defined groups of captureIds that should
  // collapse into one tile (for images not auto-grouped by post URL). Lives as
  // <saveFolder>/manual-groups.json: { groups: [ [captureId, …], … ] }.
  ipcMain.handle('get-manual-groups', () => {
    const folder = getSaveFolder();
    if (!folder) return { groups: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'manual-groups.json'));
    return { groups: (j && Array.isArray(j.groups)) ? j.groups : [] };
  });
  ipcMain.handle('set-manual-groups', (_e, groups) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      const clean = Array.isArray(groups) ? groups.filter((g) => Array.isArray(g) && g.length > 1).map((g) => g.map(String)) : [];
      writeOrgJsonSync(path.join(folder, 'manual-groups.json'), { groups: clean });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // User folders: named permanent collections of captureIds. Plus a single
  // `workspace` — an ephemeral one-click tray. Distinct from tags. Lives as
  // <saveFolder>/folders.json: { folders: [ { id, name, items:[…] } ], workspace:[…] }.
  // (The old `defaultId` key is dropped on read/write — default folder was removed.)
  ipcMain.handle('get-folders', () => {
    const folder = getSaveFolder();
    if (!folder) return { folders: [], workspace: [], posterWorkspace: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'folders.json'));
    if (!j) return { folders: [], workspace: [], posterWorkspace: [] };
    const folders = Array.isArray(j.folders) ? j.folders
      .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
      .map((f) => ({ id: f.id, name: f.name, items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [] })) : [];
    const workspace = Array.isArray(j.workspace) ? [...new Set(j.workspace.map(String))] : [];
    const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
    return { folders, workspace, posterWorkspace };
  });
  ipcMain.handle('set-folders', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      const src = (data && Array.isArray(data.folders)) ? data.folders : [];
      const folders = src
        .filter((f) => f && typeof f.id === 'string' && typeof f.name === 'string')
        .map((f) => ({ id: f.id, name: f.name, items: Array.isArray(f.items) ? [...new Set(f.items.map(String))] : [] }));
      const workspace = (data && Array.isArray(data.workspace)) ? [...new Set(data.workspace.map(String))] : [];
      const posterWorkspace = (data && Array.isArray(data.posterWorkspace)) ? [...new Set(data.posterWorkspace.map(String))] : [];
      writeOrgJsonSync(path.join(folder, 'folders.json'), { folders, workspace, posterWorkspace });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // `collections` — the unified container that supersedes folders + workspace
  // (Phase① of the collection feature). <saveFolder>/collections.json:
  //   { collections:[{id,name,kind:'static',created,items:[captureId]}], clip:[captureId], posterWorkspace:[posterKey] }
  // `clip` is the library-wide ephemeral flag set (the 📎 tray). `activeId` is legacy
  // (the old 🔖 one-click target); the renderer no longer writes it, so it settles to
  // null. On first read we migrate any existing folders.json into this shape, then
  // DELETE folders.json (clean cutover — no backup, by design). get/set-folders stay
  // for the migration read and for folding a legacy folders.json out of an imported
  // ZIP (lib-archive.js).
  function normCollections(arr) {
    return Array.isArray(arr) ? arr
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .map((c) => {
        const out = {
          id: c.id, name: c.name,
          kind: c.kind === 'dynamic' ? 'dynamic' : 'static',
          created: typeof c.created === 'number' ? c.created : null,
          items: Array.isArray(c.items) ? [...new Set(c.items.map(String))] : [],
        };
        if (c.kind === 'dynamic') {
          if (c.tree && typeof c.tree === 'object') out.tree = c.tree;   // saved query tree
          if (typeof c.q === 'string' && c.q) out.q = c.q;              // saved free-text search
        }
        return out;
      }) : [];
  }
  // Shape a legacy folders.json into the collections model. Folders become static
  // collections (ids preserved). The legacy workspace tray is dropped (clip starts
  // empty — no migration, by design). Returns null when there is nothing to migrate.
  function migrateFoldersToCollections(folder) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(folder, 'folders.json'), 'utf8')); } catch { return null; }
    const folders = Array.isArray(j.folders) ? j.folders : [];
    const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
    const collections = normCollections(folders.map((f) => ({ id: f.id, name: f.name, kind: 'static', created: null, items: f.items })));
    return { collections, activeId: null, clip: [], posterWorkspace };
  }
  ipcMain.handle('get-collections', () => {
    const folder = getSaveFolder();
    const empty = { collections: [], activeId: null, clip: [], posterWorkspace: [] };
    if (!folder) return empty;
    // 1) already migrated → read collections.json
    const collectionsPath = path.join(folder, 'collections.json');
    const { value: j, degraded } = readOrgJsonSync(collectionsPath);
    if (j) {
      const collections = normCollections(j.collections);
      const ids = new Set(collections.map((c) => c.id));
      const activeId = (typeof j.activeId === 'string' && ids.has(j.activeId)) ? j.activeId : null;
      const clip = Array.isArray(j.clip) ? [...new Set(j.clip.map(String))] : [];
      const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
      return { collections, activeId, clip, posterWorkspace };
    }
    // collections.json present-but-corrupt: return empty so the UI loads, but the
    // file stays flagged degraded so set-collections won't purge it. Do NOT fall
    // through to migration — that would overwrite the recoverable file (and could
    // drop clip membership the migration can't reconstruct from folders.json).
    if (degraded) return empty;
    // 2) collections.json absent → migrate a legacy folders.json once, write it, delete folders.json
    const migrated = migrateFoldersToCollections(folder);
    if (!migrated) return empty;
    try { writeOrgJsonSync(collectionsPath, migrated); } catch { return migrated; }
    try { fs.unlinkSync(path.join(folder, 'folders.json')); } catch { /* best-effort */ }
    return migrated;
  });
  ipcMain.handle('set-collections', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      const collections = normCollections(data && data.collections);
      const ids = new Set(collections.map((c) => c.id));
      const activeId = (data && typeof data.activeId === 'string' && ids.has(data.activeId)) ? data.activeId : null;
      const clip = (data && Array.isArray(data.clip)) ? [...new Set(data.clip.map(String))] : [];
      const posterWorkspace = (data && Array.isArray(data.posterWorkspace)) ? [...new Set(data.posterWorkspace.map(String))] : [];
      writeOrgJsonSync(path.join(folder, 'collections.json'), { collections, activeId, clip, posterWorkspace });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

module.exports = { register };
