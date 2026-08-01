'use strict';

// Organization-layer IPC handlers. These get/set channels persist the
// per-library organization state (tag kind, ungrouped set, manual groups,
// folders, poster folders/tags) — all DB-backed via getDbWriter (#298/St5
// truth-source flip moved these off the org-JSON files they used to live in;
// see lib-db-write.ts). Every handler needs only getSaveFolder + getDbWriter,
// both arriving via ctx.
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { FoldersState, ManualGroupsState, OkResult, PosterFoldersState, PosterTagsState, TagTypesState, UngroupedState } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter } = ctx;

  // Tag "vocabulary book": a tag's kind is an attribute of the TAG,
  // not of any post — so classifying a few hundred distinct tags needs zero post
  // migration. Lives as <saveFolder>/tag-types.json: { types: { "<tag>": "work"|
  // "character" } }. Tags absent from the map are implicitly general. The
  // renamable work⊃character pair powers the (later) copyright/character sections;
  // `labels` is reserved/pass-through for that phase.
  ipcMain.handle('get-tag-types', (): TagTypesState => {
    return getSaveFolder() ? getDbWriter().getTagTypes() : { types: {}, labels: null };
  });

  ipcMain.handle('set-tag-types', (_e, types, labels): OkResult => {
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
  ipcMain.handle('get-ungrouped', (): UngroupedState => {
    return getSaveFolder() ? getDbWriter().getUngrouped() : { keys: [] };
  });
  ipcMain.handle('set-ungrouped', (_e, keys): OkResult => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false };
    try {
      getDbWriter().setUngrouped(keys);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Named poster folders (poster view). { folders: [{ id, name, items:[posterKey] }] }
  // — a plain { folders } shape, so ZIP import reuses mergePosterFolders.
  ipcMain.handle('get-poster-folders', (): PosterFoldersState => {
    return getSaveFolder() ? getDbWriter().getPosterFolders() : { folders: [] };
  });
  ipcMain.handle('set-poster-folders', (_e, data): OkResult => {
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
  ipcMain.handle('get-poster-tags', (): PosterTagsState => {
    return getSaveFolder() ? getDbWriter().getPosterTags() : { tags: {} };
  });
  ipcMain.handle('set-poster-tags', (_e, data): OkResult => {
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
  ipcMain.handle('get-manual-groups', (): ManualGroupsState => {
    return getSaveFolder() ? getDbWriter().getManualGroups() : { groups: [] };
  });
  ipcMain.handle('set-manual-groups', (_e, groups): OkResult => {
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
  ipcMain.handle('get-folders', (): FoldersState => {
    const empty = { folders: [], activeId: null };
    return getSaveFolder() ? getDbWriter().getFolders() : empty;
  });
  ipcMain.handle('set-folders', (_e, data): OkResult => {
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
