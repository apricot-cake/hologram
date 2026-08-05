'use strict';

// Model manager IPC (#832, parent #98): list/download/delete over the
// registry lib-model-manager.ts owns. Progress is pushed as
// `model-download-progress` (ctx.send), the same push-during-invoke shape
// ipc-transfer.ts's save-folder-progress uses for a long-running relocation.
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { ModelInfo, OkResult } from './ipc-payloads.ts';
import { onAiTagsModelChanged } from './lib-ai-tags-job.ts';
import { deleteModel, downloadModel, listModelStatuses } from './lib-model-manager.ts';

function register(ctx: IpcContext) {
  ipcMain.handle('get-model-list', (): ModelInfo[] => listModelStatuses());

  ipcMain.handle('download-model', async (_e, id: unknown): Promise<ModelInfo> => {
    const status = await downloadModel(String(id), {
      onProgress: (p) => ctx.send('model-download-progress', p),
    });
    // Arriving and leaving are the only two events that change what the index
    // queue may plan (#50): a model appearing is what makes the backlog
    // eligible, and one being deleted is what takes its output away again.
    onAiTagsModelChanged();
    return status;
  });

  ipcMain.handle('delete-model', async (_e, id: unknown): Promise<OkResult> => {
    await deleteModel(String(id));
    onAiTagsModelChanged();
    return { ok: true };
  });
}

export { register };
