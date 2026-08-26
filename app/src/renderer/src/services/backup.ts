// 手動エクスポートの通知、ローカル復元、整合性検査の IPC をまとめる。
import { hologramIpc } from './ipc.ts';

export function getExportReminder() {
  return hologramIpc.getExportReminder();
}
export function setExportReminderEnabled(enabled: boolean) {
  return hologramIpc.setExportReminderEnabled(enabled);
}
export function setExportReminderThreshold(threshold: number) {
  return hologramIpc.setExportReminderThreshold(threshold);
}
export function onExportReminderChanged(cb: (state: any) => void) {
  return hologramIpc.onExportReminderChanged(cb);
}
// #233 の復元側: DB 世代の日付付き一覧と、その1つを選ぶロールバック。
// ロールバックが答えたすぐ後、main はすべてのウィンドウを再読み込みする。
export function listDbGenerations() {
  return hologramIpc.listDbGenerations();
}
export function rollbackDbGeneration(name: string) {
  return hologramIpc.rollbackDbGeneration(name);
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
