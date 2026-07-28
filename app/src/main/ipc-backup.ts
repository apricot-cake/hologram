'use strict';

// Backup IPC handlers, extracted from main.js (mechanical move — logic unchanged).
// Thin handlers over the backup engine (readBackupConfig / writeBackupConfig /
// validateBackupDir / armBackupSchedule / runBackup), which all stay in main.js and
// arrive via ctx. pick-backup-dir opens a directory dialog parented to the main window
// (ctx.getWin()).
//
// get-integrity-status / run-orphan-recovery (#301) are a separate concern
// (DB<->media reconciliation, not the file mirror) that happens to share this
// module because the rail that displays both lives in the same renderer
// component (MirrorStatus.tsx).
import { ipcMain, dialog } from 'electron';

function register(ctx) {
  const { readBackupConfig, writeBackupConfig, validateBackupDir, armBackupSchedule, runBackup, getWin, readIntegrityStatus, runOrphanRecovery } = ctx;

  ipcMain.handle('get-backup', () => readBackupConfig());
  ipcMain.handle('set-backup', (_e, patch) => {
    patch = patch || {};
    if ('dir' in patch && patch.dir) {
      const v = validateBackupDir(patch.dir);
      if (!v.ok) return { ok: false, error: v.error, backup: readBackupConfig() };
    }
    const backup = writeBackupConfig(patch);
    armBackupSchedule();
    return { ok: true, backup };
  });
  ipcMain.handle('pick-backup-dir', async () => {
    const res = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const dir = res.filePaths[0];
    const v = validateBackupDir(dir);
    if (!v.ok) return { ok: false, error: v.error };
    const backup = writeBackupConfig({ dir });
    armBackupSchedule();
    return { ok: true, backup };
  });
  ipcMain.handle('run-backup', () => runBackup('manual'));
  ipcMain.handle('get-integrity-status', () => readIntegrityStatus());
  ipcMain.handle('run-orphan-recovery', () => runOrphanRecovery());
}

export { register };
