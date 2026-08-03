'use strict';

// Global history page (#145) IPC handlers. Library-scoped (the `history` table
// lives in the SAME database as posts/tabs — see lib-db-write.ts's header on
// appendHistory), so these follow get-folders' shape (getSaveFolder ? … : empty),
// not get-tabs' isPrimarySender guard: history is shared library state like
// folders/tags, not a per-window tab strip (#32 St1's "他窓は読み書きとも遮断"
// reasoning doesn't apply here).
import { ipcMain } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { HistoryQueryResult, OkResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter } = ctx;

  // Fire-and-forget from the renderer's push-time hook (services/history.ts's
  // recordPush) — the renderer never awaits this beyond swallowing a rejection.
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
