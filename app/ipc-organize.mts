'use strict';

// Organization-layer IPC handlers, extracted from main.js (mechanical move — logic
// unchanged). These 14 get/set channels persist the per-library organization JSON
// files (tag groups, tag 種別, ungrouped set, manual groups, folders,
// poster folders/tags) alongside the sidecars. Every handler needs only the same
// three core helpers — getSaveFolder + readOrgJsonSync + writeOrgJsonSync — which
// stay in main.js and arrive via ctx. See main.js for the org-JSON degraded-guard
// (readOrgJsonSync/writeOrgJsonSync refuse to clobber a present-but-corrupt file).
import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { normFolders } from './lib-folder-tree.mts';

// `folders` — the unified container of named folders (formerly "collections").
// Each folder is { id, name, kind:'static'|'dynamic', created, parentId, items:[captureId] };
// a dynamic folder additionally carries a saved search (`tree`), and holds no items.
// <saveFolder>/folders.json:
//   { folders:[…], clip:[captureId], posterWorkspace:[posterKey] }
// `clip` is the library-wide ephemeral flag set (the 📎 tray). `activeId` is legacy
// (the old 🔖 one-click target); the renderer no longer writes it, so it settles to null.
// The shape + the parent-edge repair live in lib-folder-tree.mts (pure, unit-tested).

function register(ctx) {
  const { getSaveFolder, readOrgJsonSync, writeOrgJsonSync } = ctx;

  // Tag groups (migrated from the imported library's metadata) live alongside the
  // sidecars as <saveFolder>/tag-groups.json: { groups: [{id,name,tags[]}] }.
  ipcMain.handle('get-tag-groups', () => {
    const folder = getSaveFolder();
    if (!folder) return { groups: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'tag-groups.json'));
    return { groups: j && Array.isArray(j.groups) ? j.groups : [] };
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
    const types = j && j.types && typeof j.types === 'object' ? j.types : {};
    const labels = j && j.labels && typeof j.labels === 'object' ? j.labels : null;
    return { types, labels };
  });

  ipcMain.handle('set-tag-types', (_e, types, labels) => {
    const folder = getSaveFolder();
    if (!folder || !types || typeof types !== 'object') return { ok: false };
    try {
      fs.mkdirSync(folder, { recursive: true });
      const out = { types };
      if (labels && typeof labels === 'object') (out as any).labels = labels;
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
    return { keys: j && Array.isArray(j.keys) ? j.keys : [] };
  });
  ipcMain.handle('set-ungrouped', (_e, keys) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      writeOrgJsonSync(path.join(folder, 'ungrouped.json'), { keys: Array.isArray(keys) ? keys.map(String) : [] });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // (poster favorites feature removed; legacy <saveFolder>/poster-favorites.json is
  // still listed in INTERNAL_FILES so the post index keeps skipping it.)

  // Named poster folders (poster view). { folders: [{ id, name, items:[posterKey] }] }
  // — a plain { folders } shape, so ZIP import reuses mergePosterFolders.
  ipcMain.handle('get-poster-folders', () => {
    const folder = getSaveFolder();
    if (!folder) return { folders: [] };
    const { value: j } = readOrgJsonSync(path.join(folder, 'poster-folders.json'));
    return { folders: j && Array.isArray(j.folders) ? j.folders : [] };
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
    return { tags: j && typeof j.tags === 'object' && j.tags ? j.tags : {} };
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
    return { groups: j && Array.isArray(j.groups) ? j.groups : [] };
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

  ipcMain.handle('get-folders', () => {
    const folder = getSaveFolder();
    const empty = { folders: [], activeId: null, clip: [], posterWorkspace: [] };
    if (!folder) return empty;
    const foldersPath = path.join(folder, 'folders.json');
    // One-time pre-release migration: the store file went from collections.json →
    // folders.json AND its retired top-level key `collections` → `folders` (#42).
    // Two old shapes exist in the wild (dev): collections.json still on disk, and a
    // folders.json that was renamed but kept the `collections` key. Either way rewrite
    // once under folders.json with `folders` — a plain rename would leave `collections`
    // inside, which the reader below no longer sees → the store loads empty and the
    // next save wipes it. Scaffolding — remove before release (no third-party data).
    try {
      const rekey = (o: Record<string, unknown>) => {
        const { collections, ...rest } = o;
        return { ...rest, folders: collections || [] }; // fields normalized on the read below
      };
      if (!fs.existsSync(foldersPath)) {
        const { value: legacy } = readOrgJsonSync(path.join(folder, 'collections.json'));
        if (legacy && typeof legacy === 'object') {
          writeOrgJsonSync(foldersPath, rekey(legacy as Record<string, unknown>));
          fs.unlinkSync(path.join(folder, 'collections.json'));
        }
      } else {
        const { value: cur } = readOrgJsonSync(foldersPath);
        if (cur && typeof cur === 'object' && 'collections' in cur && !('folders' in cur)) writeOrgJsonSync(foldersPath, rekey(cur as Record<string, unknown>));
      }
    } catch {
      /* best-effort */
    }
    // A present-but-corrupt folders.json returns empty (the UI still loads) but stays
    // flagged degraded inside readOrgJsonSync, so set-folders won't purge it.
    const { value: j } = readOrgJsonSync(foldersPath);
    if (!j) return empty;
    const folders = normFolders(j.folders);
    const ids = new Set(folders.map((c) => c.id));
    const activeId = typeof j.activeId === 'string' && ids.has(j.activeId) ? j.activeId : null;
    const clip = Array.isArray(j.clip) ? [...new Set(j.clip.map(String))] : [];
    const posterWorkspace = Array.isArray(j.posterWorkspace) ? [...new Set(j.posterWorkspace.map(String))] : [];
    return { folders, activeId, clip, posterWorkspace };
  });
  ipcMain.handle('set-folders', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      const folders = normFolders(data && data.folders);
      const ids = new Set(folders.map((c) => c.id));
      const activeId = data && typeof data.activeId === 'string' && ids.has(data.activeId) ? data.activeId : null;
      const clip = data && Array.isArray(data.clip) ? [...new Set(data.clip.map(String))] : [];
      const posterWorkspace = data && Array.isArray(data.posterWorkspace) ? [...new Set(data.posterWorkspace.map(String))] : [];
      writeOrgJsonSync(path.join(folder, 'folders.json'), { folders, activeId, clip, posterWorkspace });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
