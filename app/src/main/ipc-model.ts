'use strict';

// モデルマネージャの IPC（#832、親は #98）。lib-model-manager.ts が持つ登録簿に対する
// 一覧・ダウンロード・削除。進捗は `model-download-progress` として送る（ctx.send）。
// ipc-transfer.ts の save-folder-progress が長時間の移設に使っているのと同じ、invoke の最中に
// 送る形。
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
    // 索引のキューが何を計画してよいかを変える出来事は、到着と退去の2つだけ（#50）。モデルが
    // 現れることが積み残しを対象にし、モデルが消えることがその出力を再び取り去る。
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
