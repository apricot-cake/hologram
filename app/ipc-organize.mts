'use strict';

// Organization-layer IPC handlers, extracted from main.js (mechanical move — logic
// unchanged). These get/set channels persist the per-library organization JSON
// files (tag 種別, ungrouped set, manual groups, folders, poster folders/tags)
// alongside the sidecars. Every handler needs only the same
// three core helpers — getSaveFolder + readOrgJsonSync + writeOrgJsonSync — which
// stay in main.js and arrive via ctx. See main.js for the org-JSON degraded-guard
// (readOrgJsonSync/writeOrgJsonSync refuse to clobber a present-but-corrupt file).
import { ipcMain } from 'electron';

function register(ctx) {
  const { getSaveFolder, getDbWriter } = ctx;

  // Tag "vocabulary book" (用語帳): a tag's 種別 (kind) is an attribute of the TAG,
  // not of any post — so classifying a few hundred distinct tags needs zero post
  // migration. Lives as <saveFolder>/tag-types.json: { types: { "<tag>": "work"|
  // "character" } }. Tags absent from the map are implicitly 一般 (general). The
  // renamable work⊃character pair powers the (later) copyright/character sections;
  // `labels` is reserved/pass-through for that phase.
  ipcMain.handle('get-tag-types', () => {
    return getSaveFolder() ? getDbWriter().getTagTypes() : { types: {}, labels: null };
  });

  ipcMain.handle('set-tag-types', (_e, types, labels) => {
    const folder = getSaveFolder();
    if (!folder || !types || typeof types !== 'object') return { ok: false };
    try {
      getDbWriter().setTagTypes(types, labels);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Persistent per-post "do not group" set (image-view). Post keys whose images
  // should stay individual tiles (e.g. several pics from one post that aren't a
  // multi-page work). Lives as <saveFolder>/ungrouped.json: { keys: [...] }.
  ipcMain.handle('get-ungrouped', () => {
    return getSaveFolder() ? getDbWriter().getUngrouped() : { keys: [] };
  });
  ipcMain.handle('set-ungrouped', (_e, keys) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      getDbWriter().setUngrouped(keys);
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
    return getSaveFolder() ? getDbWriter().getPosterFolders() : { folders: [] };
  });
  ipcMain.handle('set-poster-folders', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder || !data || !Array.isArray(data.folders)) return { ok: false };
    try {
      getDbWriter().setPosterFolders(data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Per-poster tags (poster view). { tags: { "<posterKey>": ["tag", …] } } — the
  // poster-level peer of poster-folders. Shares the post tag
  // vocabulary (tag-types) but is keyed by poster, NOT stored on posts.
  ipcMain.handle('get-poster-tags', () => {
    return getSaveFolder() ? getDbWriter().getPosterTags() : { tags: {} };
  });
  ipcMain.handle('set-poster-tags', (_e, data) => {
    const folder = getSaveFolder();
    if (!folder || !data || typeof data.tags !== 'object' || !data.tags) return { ok: false };
    try {
      getDbWriter().setPosterTags(data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Manual image groups (image-view): user-defined groups of captureIds that should
  // collapse into one tile (for images not auto-grouped by post URL). Lives as
  // <saveFolder>/manual-groups.json: { groups: [ [captureId, …], … ] }.
  ipcMain.handle('get-manual-groups', () => {
    return getSaveFolder() ? getDbWriter().getManualGroups() : { groups: [] };
  });
  ipcMain.handle('set-manual-groups', (_e, groups) => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      getDbWriter().setManualGroups(groups);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // `folders` — the unified container of named folders (formerly "collections").
  // Each folder is { id, name, kind:'static'|'dynamic', created, parentId, items:[captureId] };
  // a dynamic folder additionally carries a saved search (`tree`), and holds no items.
  // `activeId` is legacy (the old 🔖 one-click target); the renderer no longer
  // writes it, so it settles to null.
  ipcMain.handle('get-folders', () => {
    const empty = { folders: [], activeId: null };
    return getSaveFolder() ? getDbWriter().getFolders() : empty;
  });
  ipcMain.handle('set-folders', (_e, data) => {
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().setFolders(data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
