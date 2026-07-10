// Backup service — auto-backup config + run status (get/set config, pick target
// dir, kick a run, start/done events), wrapping the flat corpusIpc.getBackup/
// setBackup/pickBackupDir/runBackup/onBackupStart/onBackupDone calls. A real ES
// module (named exports) now — imported directly by the two consumers that share
// this domain: the #mirrorStatus rail island and the Settings > データ island —
// pure 1:1 forwarding, no wrapping logic (same as trash). The internal corpusIpc
// calls stay on window until ipc.ts is itself converted (Wave13).
export function getBackup() {
  return window.corpusIpc.getBackup();
}
export function setBackup(patch: unknown) {
  return window.corpusIpc.setBackup(patch);
}
export function pickBackupDir() {
  return window.corpusIpc.pickBackupDir();
}
export function runBackup() {
  return window.corpusIpc.runBackup();
}
export function onBackupStart(cb: (...args: any[]) => void) {
  return window.corpusIpc.onBackupStart(cb);
}
export function onBackupDone(cb: (...args: any[]) => void) {
  return window.corpusIpc.onBackupDone(cb);
}
