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
export function getIntegrityStatus() {
  return hologramIpc.getIntegrityStatus();
}
export function runOrphanRecovery() {
  return hologramIpc.runOrphanRecovery();
}
export function onIntegrityCheckDone(cb: (status: any) => void) {
  return hologramIpc.onIntegrityCheckDone(cb);
}
