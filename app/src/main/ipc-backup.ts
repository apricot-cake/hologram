'use strict';

// バックアップの IPC ハンドラ。main.js から切り出した（機械的な移動＝ロジックは変えていない）。
// バックアップエンジン（readBackupConfig / writeBackupConfig / validateBackupDir /
// armBackupSchedule / runBackup）の薄いハンドラで、それらは全部 lib-backup.ts（#227 / #233）に
// あり、ctx 経由で届く。pick-backup-dir は、呼んできたウィンドウを親にしてディレクトリの
// ダイアログを開く（#32 St1: BrowserWindow.fromWebContents(e.sender)）。
//
// list-db-generations と rollback-db-generation（#233）は、同じエンジンの復元側の半分。世代の
// ストアはロールバックが読むものなので、この対は ZIP の取り込みの隣ではなく、バックアップの
// ハンドラと一緒にある。
//
// get-integrity-status と run-orphan-recovery（#301）は別の関心事（ファイルの写しではなく、
// DB とメディアの照合）だが、両方を出すレールが同じレンダラーのコンポーネント
// （BackupStatus.tsx）にあるので、たまたまこのモジュールを共有している。
import { ipcMain, dialog, BrowserWindow } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { BackupConfig, BackupDirPickResult, BackupRunResult, BackupWriteResult, DbGeneration, DbRollbackResult, IntegrityStatus, OrphanRecoveryResult } from './ipc-payloads.ts';
import { RELOAD_AFTER_LIBRARY_SWAP_MS } from './lib-window.ts';

function register(ctx: IpcContext) {
  const { readBackupConfig, writeBackupConfig, validateBackupDir, armBackupSchedule, runBackup, listDbGenerations, rollbackDbGeneration, readIntegrityStatus, runOrphanRecovery } = ctx;

  ipcMain.handle('get-backup', (): BackupConfig => readBackupConfig());
  ipcMain.handle('set-backup', (_e, patch): BackupWriteResult => {
    patch = patch || {};
    if ('dir' in patch && patch.dir) {
      const v = validateBackupDir(patch.dir);
      if (!v.ok) return { ok: false, error: v.error, backup: readBackupConfig() };
    }
    const backup = writeBackupConfig(patch);
    armBackupSchedule();
    return { ok: true, backup };
  });
  ipcMain.handle('pick-backup-dir', async (_e): Promise<BackupDirPickResult> => {
    // #32 St1: 親にするのは、ctx.getWin()（主ウィンドウ）ではなく呼んできたウィンドウ
    // （BrowserWindow.fromWebContents）＝副ウィンドウ自身のダイアログが、デスクトップの向こう側の
    // ウィンドウを親にして、その後ろに出てはいけない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const dir = res.filePaths[0];
    const v = validateBackupDir(dir);
    if (!v.ok) return { ok: false, error: v.error };
    const backup = writeBackupConfig({ dir });
    armBackupSchedule();
    return { ok: true, backup };
  });
  ipcMain.handle('run-backup', (): Promise<BackupRunResult> => runBackup('manual'));
  ipcMain.handle('list-db-generations', (): DbGeneration[] => listDbGenerations());
  ipcMain.handle('rollback-db-generation', async (_e, name): Promise<DbRollbackResult> => {
    const res = await rollbackDbGeneration(name);
    // ロールバックは投稿・タグ・フォルダ・コレクションとタブの帯を一手に置き換えるので、この時点
    // でどのウィンドウも、もう存在しないライブラリを映している。全部を読み込み直すのは、同じ理由で
    // #176 が落ち着いた答え（"部分的な流し替えは organize 層ストアの取りこぼしが事故になる"）。
    // この遅延が、呼び出し元自身のウィンドウが消える前に結果を出す余地を作る（定数と論拠の残りは
    // lib-window.ts にあり、#176 の switchLibrary＝足元でライブラリを入れ替えるもう一方の操作＝と
    // 共有している）。
    if (res.ok) {
      setTimeout(() => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
      }, RELOAD_AFTER_LIBRARY_SWAP_MS);
    }
    return res;
  });
  ipcMain.handle('get-integrity-status', (): IntegrityStatus => readIntegrityStatus());
  ipcMain.handle('run-orphan-recovery', (): Promise<OrphanRecoveryResult> => runOrphanRecovery());
}

export { register };
