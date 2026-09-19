'use strict';

// 手動エクスポートの通知と整合性検査の IPC ハンドラ。
//
// get-integrity-status と run-orphan-recovery（#301）は別の関心事（ファイルの写しではなく、
// DB とメディアの照合）だが、両方を出すレールが同じレンダラーのコンポーネント
// （LibrarySafetyStatus.tsx）にあるので、たまたまこのモジュールを共有している。
import { ipcMain } from './activity-ipc.ts';
import type { IpcContext } from './ipc-context.ts';
import type { ExportReminderState, IntegrityStatus, OrphanRecoveryResult } from './ipc-payloads.ts';

function register(ctx: IpcContext) {
  const { getExportReminder, setExportReminderEnabled, setExportReminderThreshold, readIntegrityStatus, runOrphanRecovery } = ctx;

  ipcMain.handle('get-export-reminder', (): ExportReminderState => getExportReminder());
  ipcMain.handle('set-export-reminder-enabled', (_e, enabled): ExportReminderState => setExportReminderEnabled(enabled));
  ipcMain.handle('set-export-reminder-threshold', (_e, threshold): ExportReminderState => setExportReminderThreshold(threshold));
  ipcMain.handle('get-integrity-status', (): IntegrityStatus => readIntegrityStatus());
  ipcMain.handle('run-orphan-recovery', (): Promise<OrphanRecoveryResult> => runOrphanRecovery());
}

export { register };
