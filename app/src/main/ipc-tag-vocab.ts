'use strict';

// #21 tag management page IPC — the vocabulary overview/rename/merge/parent-edge/
// kind/orphan-cleanup channels. All DB-backed via getDbWriter (lib-db-write.ts,
// which forwards to lib-db-tag-vocab.ts) — see that module for the write-order
// and cycle/collision rules. Registered from index.ts alongside the other
// extracted ipc-*.ts modules (#228).
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { DeleteOrphanTagsResult, RenameTagResult, TagParentRowResolved, TagVocabRow, TagWriteResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter } = ctx;

  ipcMain.handle('get-tag-vocab', (): TagVocabRow[] => {
    return getSaveFolder() ? getDbWriter().tagVocabOverview() : [];
  });

  ipcMain.handle('get-tag-parent-edges', (): TagParentRowResolved[] => {
    return getSaveFolder() ? getDbWriter().tagParentEdges() : [];
  });

  ipcMain.handle('rename-tag', (_e, tagId, newName): RenameTagResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof newName !== 'string') return { ok: false, error: 'empty' };
    try {
      return getDbWriter().renameTag(tagId, newName);
    } catch {
      return { ok: false, error: 'empty' };
    }
  });

  ipcMain.handle('keep-separate-rename-tag', (_e, tagId, newName, displayParentTagId): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof newName !== 'string' || typeof displayParentTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      return getDbWriter().keepSeparateRenameTag(tagId, newName, displayParentTagId);
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('merge-tags', (_e, sourceTagId, targetTagId): TagWriteResult => {
    if (!getSaveFolder() || typeof sourceTagId !== 'number' || typeof targetTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      return getDbWriter().mergeTags(sourceTagId, targetTagId);
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('add-tag-parent', (_e, tagId, parentTagId, isDisplay): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof parentTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      return getDbWriter().addTagParent(tagId, parentTagId, !!isDisplay);
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('remove-tag-parent', (_e, tagId, parentTagId): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number' || typeof parentTagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      return getDbWriter().removeTagParent(tagId, parentTagId);
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  // Row-scoped kind write (lib-db-tag-vocab.ts's setTagKind) — NOT set-tag-types
  // (ipc-organize.ts): that channel replaces the whole name-keyed map and would
  // silently mis-target one entity of a same-name pair. This one updates a
  // single tagId, so the management page's reused kind-menu is entity-safe.
  ipcMain.handle('set-tag-kind', (_e, tagId, kind): TagWriteResult => {
    if (!getSaveFolder() || typeof tagId !== 'number') return { ok: false, error: 'invalid' };
    try {
      return getDbWriter().setTagKind(tagId, typeof kind === 'string' ? kind : null);
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('delete-orphan-tags', (_e, tagIds): DeleteOrphanTagsResult => {
    if (!getSaveFolder() || !Array.isArray(tagIds)) return { ok: false, deletedIds: [] };
    try {
      return getDbWriter().deleteOrphanTags(tagIds.filter((id: unknown): id is number => typeof id === 'number'));
    } catch {
      return { ok: false, deletedIds: [] };
    }
  });
}

export { register };
