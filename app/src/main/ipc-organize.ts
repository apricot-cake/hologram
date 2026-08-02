'use strict';

// Organization-layer IPC handlers. These get/set channels persist the
// per-library organization state (tag kind, ungrouped set, manual groups,
// folders, poster folders/tags) — all DB-backed via getDbWriter (#298/St5
// truth-source flip moved these off the org-JSON files they used to live in;
// see lib-db-write.ts). Every handler needs only getSaveFolder + getDbWriter,
// both arriving via ctx.
//
// #32 St2: every successful set-* below also relays an `org-changed` event to
// every OTHER window (ctx.sendExcept) — the sender's own in-memory store is
// already current (it wrote optimistically before this call), so echoing its own
// write back would be at best a wasted round trip and at worst a reset of
// in-progress local UI state the write itself did not touch. `kind` matches the
// channel's own domain name (renderer/services/*.ts's org-changed subscribers key
// off it to reload only the store that actually changed).
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { FoldersState, ManualGroupsState, OkResult, PosterAliasesState, PosterFoldersState, PosterTagsState, TagTypesState, UngroupedState } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, sendExcept } = ctx;

  // Tag "vocabulary book": a tag's kind is an attribute of the TAG,
  // not of any post — so classifying a few hundred distinct tags needs zero post
  // migration. #810 keyed it by tag ENTITY (`types` is one row per kinded tag,
  // not a name map): `kind` is a column of the tags row, so two tags sharing a
  // name can carry different kinds, and a name-keyed payload lost one of them on
  // every round trip. Tags absent from the list are implicitly general. The
  // renamable work⊃character pair powers the copyright/character sections;
  // `labels` is the rename table for those two kind NAMES (unaffected by #810).
  ipcMain.handle('get-tag-types', (): TagTypesState => {
    return getSaveFolder() ? getDbWriter().getTagTypes() : { types: [], labels: null };
  });

  ipcMain.handle('set-tag-types', (_e, types, labels): OkResult => {
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(types)) return { ok: false };
    try {
      getDbWriter().setTagTypes(types, labels);
      sendExcept(_e.sender.id, 'org-changed', 'tag-types');
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
      sendExcept(_e.sender.id, 'org-changed', 'ungrouped');
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
      sendExcept(_e.sender.id, 'org-changed', 'poster-folders');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Per-poster tags (poster view) — the poster-level peer of poster-folders.
  // Shares the post tag vocabulary (the same tags table) but is keyed by poster,
  // NOT stored on posts. Asymmetric since #810: the READ hands back tag entities
  // (names + ids + #774's effective set, so poster filtering matches by id and
  // parent relationships reach posters too), the WRITE is still the plain
  // { tags: { "<posterKey>": ["tag", …] } } name map the editor produces.
  ipcMain.handle('get-poster-tags', (): PosterTagsState => {
    return getSaveFolder() ? getDbWriter().getPosterTags() : { tags: {} };
  });
  ipcMain.handle('set-poster-tags', (_e, data): OkResult => {
    const folder = getSaveFolder();
    if (!folder || !data || typeof data.tags !== 'object' || !data.tags) return { ok: false };
    try {
      getDbWriter().setPosterTags(data);
      sendExcept(_e.sender.id, 'org-changed', 'poster-tags');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Poster name-merging (#23 St1): non-destructive, reversible groups of
  // posterKeys naming the same real-world author/account. { groups: [{ id,
  // primary, members:[posterKey] }] } — every reader (buildUsers, the 'user'
  // query leaf, poster-tag/-folder union reads) folds a member key onto its
  // group's primary; nothing here ever touches a post record. A group
  // needs 2+ members; lib-db-write.ts's replacePosterAliases drops anything
  // smaller rather than accept a value that could never resolve() usefully.
  ipcMain.handle('get-poster-aliases', (): PosterAliasesState => {
    return getSaveFolder() ? getDbWriter().getPosterAliases() : { groups: [] };
  });
  ipcMain.handle('set-poster-aliases', (_e, data): OkResult => {
    const folder = getSaveFolder();
    if (!folder || !data || !Array.isArray(data.groups)) return { ok: false };
    try {
      getDbWriter().setPosterAliases(data);
      sendExcept(_e.sender.id, 'org-changed', 'poster-aliases');
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
      sendExcept(_e.sender.id, 'org-changed', 'manual-groups');
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
      sendExcept(_e.sender.id, 'org-changed', 'folders');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
