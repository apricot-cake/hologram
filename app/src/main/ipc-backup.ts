'use strict';

// バックアップの IPC ハンドラ。main.js から切り出した（機械的な移動＝ロジックは変えていない）。
// バックアップエンジンの状態と手動実行を公開する薄いハンドラ。
//
// list-db-generations と rollback-db-generation（#233）は、同じエンジンの復元側の半分。世代の
// ストアはロールバックが読むものなので、この対は ZIP の取り込みの隣ではなく、バックアップの
// ハンドラと一緒にある。
//
// get-integrity-status と run-orphan-recovery（#301）は別の関心事（ファイルの写しではなく、
// DB とメディアの照合）だが、両方を出すレールが同じレンダラーのコンポーネント
// （BackupStatus.tsx）にあるので、たまたまこのモジュールを共有している。
import { ipcMain, BrowserWindow } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { BackupConfig, BackupRunResult, DbGeneration, DbRollbackResult, IntegrityStatus, OrphanRecoveryResult } from './ipc-payloads.ts';
import { RELOAD_AFTER_LIBRARY_SWAP_MS } from './lib-window.ts';

function register(ctx: IpcContext) {
  const { readBackupConfig, runBackup, listDbGenerations, rollbackDbGeneration, readIntegrityStatus, runOrphanRecovery } = ctx;

  ipcMain.handle('get-backup', (): BackupConfig => readBackupConfig());
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
