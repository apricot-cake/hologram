'use strict';

// Backup IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// Thin handlers over the backup engine (readBackupConfig / writeBackupConfig /
// validateBackupDir / armBackupSchedule / runBackup), which all live in lib-backup.ts
// (#227 / #233) and arrive via ctx. pick-backup-dir opens a directory dialog parented to
// whichever window called it (#32 St1: BrowserWindow.fromWebContents(e.sender)).
//
// list-db-generations / rollback-db-generation (#233) are the restore half of
// the same engine: the generation store is what a rollback reads, so the pair
// belongs with the backup handlers rather than beside the ZIP import.
//
// get-integrity-status / run-orphan-recovery (#301) are a separate concern
// (DB<->media reconciliation, not the file mirror) that happens to share this
// module because the rail that displays both lives in the same renderer
// component (BackupStatus.tsx).
import { ipcMain, dialog, BrowserWindow } from 'electron';
import type { IpcContext } from './ipc-context.ts';
import type { BackupConfig, BackupDirPickResult, BackupRunResult, BackupWriteResult, DbGeneration, DbRollbackResult, IntegrityStatus, OrphanRecoveryResult } from './ipc-payloads.ts';

/** Long enough for the toast reporting the rollback to be read. */
const RELOAD_AFTER_ROLLBACK_MS = 2000;

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
    // #32 St1: parented to whichever window called (BrowserWindow.fromWebContents),
    // not ctx.getWin() (the primary) — a secondary window's own dialog must not pop
    // up behind it, parented to a window across the desktop.
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
    // A rollback replaces posts, tags, folders, collections and the tab strip in
    // one step, so every window is now showing a library that no longer exists.
    // Reloading them all is what #176 settled on for the same reason ("部分的な
    // 流し替えは organize 層ストアの取りこぼしが事故になる"); the delay is what
    // lets the caller's own window show the outcome before it goes.
    if (res.ok) {
      setTimeout(() => {
        for (const w of BrowserWindow.getAllWindows()) w.webContents.reload();
      }, RELOAD_AFTER_ROLLBACK_MS);
    }
    return res;
  });
  ipcMain.handle('get-integrity-status', (): IntegrityStatus => readIntegrityStatus());
  ipcMain.handle('run-orphan-recovery', (): Promise<OrphanRecoveryResult> => runOrphanRecovery());
}

export { register };
