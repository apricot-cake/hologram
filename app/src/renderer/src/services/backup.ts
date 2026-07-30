// Backup service — auto-backup config + run status (get/set config, pick target
// dir, kick a run, start/done events), wrapping the flat hologramIpc.getBackup/
// setBackup/pickBackupDir/runBackup/onBackupStart/onBackupDone calls. A real ES
// module (named exports) now — imported directly by the two consumers that share
// this domain: the #mirrorStatus rail component and the Settings > データ component —
// pure 1:1 forwarding, no wrapping logic (same as trash).
import { hologramIpc } from './ipc.ts';

export function getBackup() {
  return hologramIpc.getBackup();
}
export function setBackup(patch: unknown) {
  return hologramIpc.setBackup(patch);
}
export function pickBackupDir() {
  return hologramIpc.pickBackupDir();
}
export function runBackup() {
  return hologramIpc.runBackup();
}
// The preload bridge unwraps the IPC event (#383): a start notification carries
// nothing, a done notification carries only the backup result.
export function onBackupStart(cb: () => void) {
  return hologramIpc.onBackupStart(cb);
}
export function onBackupDone(cb: (result: any) => void) {
  return hologramIpc.onBackupDone(cb);
}
export function getIntegrityStatus() {
  return hologramIpc.getIntegrityStatus();
}
export function runOrphanRecovery() {
  return hologramIpc.runOrphanRecovery();
}
export function onIntegrityCheckDone(cb: (status: any) => void) {
  return hologramIpc.onIntegrityCheckDone(cb);
}
