'use strict';

// 全体の履歴のページ（#145）の IPC ハンドラ。ライブラリに閉じている（`history` テーブルは
// posts や tabs と同じデータベースにある＝lib-db-write.ts の appendHistory についてのヘッダを
// 参照）ので、get-tabs の isPrimarySender の番人ではなく get-folders の形（getSaveFolder ? … :
// 空）に倣う。履歴はフォルダやタグと同じくライブラリで共有する状態であって、ウィンドウごとの
// タブの帯ではない（#32 St1 の "他窓は読み書きとも遮断" の論法はここには当てはまらない）。
import { ipcMain } from './activity-ipc.ts';
import type { IpcContext } from './ipc-context.ts';
import type { HistoryQueryResult, OkResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter } = ctx;

  // レンダラーの push 時のフック（services/history.ts の recordPush）からの投げっぱなし＝
  // レンダラーは拒否を握り潰す以上にこれを待つことがない。
  ipcMain.handle('append-history', (_e, row): OkResult => {
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().appendHistory(row);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('query-history', (_e, opts): HistoryQueryResult => {
    const empty = { rows: [], hasMore: false };
    return getSaveFolder() ? (getDbWriter().queryHistory(opts || {}) as HistoryQueryResult) : empty;
  });

  ipcMain.handle('delete-history-row', (_e, id): OkResult => {
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().deleteHistoryRow(id);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('clear-history', (): OkResult => {
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().clearHistory();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };
