// バックアップサービス――自動バックアップの設定＋実行状態（設定の取得／
// 設定、行き先フォルダの選択、実行の起動、開始／完了イベント）を、平坦な
// hologramIpc.getBackup/runBackup/onBackupStart/
// onBackupDone 呼び出しをラップして提供する。今では本物の ES モジュール
// （named exports）で、このドメインを共有する2つの利用側から直接
// import される: BackupStatus のレールコンポーネントと設定 > データ
// コンポーネント――純粋に1:1で転送するだけで、ラップするロジックは無い
// （trash と同じ）。
import { hologramIpc } from './ipc.ts';

export function getBackup() {
  return hologramIpc.getBackup();
}
export function runBackup() {
  return hologramIpc.runBackup();
}
// #233 の復元側: DB 世代の日付付き一覧と、その1つを選ぶロールバック。
// ロールバックが答えたすぐ後、main はすべてのウィンドウを再読み込みする。
export function listDbGenerations() {
  return hologramIpc.listDbGenerations();
}
export function rollbackDbGeneration(name: string) {
  return hologramIpc.rollbackDbGeneration(name);
}
// preload のブリッジが IPC イベントを剥がす（#383）: 開始通知は何も運ばず、
// 完了通知はバックアップ結果だけを運ぶ。
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
