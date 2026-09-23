'use strict';
import { ipcMain } from './activity-ipc.ts';
import type { IpcContext } from './ipc-context.ts';
import type { DeleteTagsResult, RenameTagResult, TagVocabRow, TagWriteResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, resetDelta, send } = ctx;
  function notifyTagVocabChanged() {
    resetDelta();
    send('posts-changed', null);
    send('org-changed', 'poster-tags');
    send('org-changed', 'tag-groups');
  }

  ipcMain.handle('get-tag-vocab', (): TagVocabRow[] => {
    return getSaveFolder() ? getDbWriter().tagVocabOverview() : [];
  });
  ipcMain.handle('save-classified-tag', (_e, input) => {
    if (!getSaveFolder()) throw new Error('No library');
    const id = getDbWriter().saveClassifiedTag(input);
    notifyTagVocabChanged();
    return id;
  });
  ipcMain.handle('get-classified-assignments', (_e, ids) => (getSaveFolder() ? getDbWriter().getClassifiedAssignments(ids) : []));
  ipcMain.handle('set-classified-assignments', (_e, rows) => {
    if (!getSaveFolder()) throw new Error('No library');
    getDbWriter().setClassifiedAssignments(rows);
    notifyTagVocabChanged();
    return undefined;
  });

  ipcMain.handle('rename-tag', (_e, tagId, newName): RenameTagResult => {
    if (!getSaveFolder()) return { ok: false, error: 'empty' };
    try {
      const res = getDbWriter().renameTag(tagId, newName);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'empty' };
    }
  });
  ipcMain.handle('merge-tags', (_e, sourceTagId, targetTagId): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().mergeTags(sourceTagId, targetTagId);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });
  ipcMain.handle('set-tag-group', (_e, tagId, kind): TagWriteResult => {
    if (!getSaveFolder()) return { ok: false, error: 'invalid' };
    try {
      const res = getDbWriter().setTagGroup(tagId, kind);
      if (res.ok) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, error: 'invalid' };
    }
  });

  ipcMain.handle('delete-tags', (_e, tagIds): DeleteTagsResult => {
    if (!getSaveFolder()) return { ok: false, deletedIds: [] };
    try {
      const res = getDbWriter().deleteTags(tagIds);
      if (res.ok && res.deletedIds.length) notifyTagVocabChanged();
      return res;
    } catch {
      return { ok: false, deletedIds: [] };
    }
  });
}

export { register };
