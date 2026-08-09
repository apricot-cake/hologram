// モデルマネージャ（#832、親 #98）――
// hologramIpc.getModelList/downloadModel/deleteModel/onModelDownloadProgress
// への薄い転送（services/ai.ts と同じパターン）。今日のところ、設定の
// AI 機能セクションが唯一の呼び出し元。自分専用のモデルを必要とする将来の
// 機能 Issue（#48/#49/#50/#51）は、同じように
// getModelList()/onModelDownloadProgress() を読むことになる。
import { hologramIpc } from './ipc.ts';

export function getModelList() {
  return hologramIpc.getModelList();
}
export function downloadModel(id: string) {
  return hologramIpc.downloadModel(id);
}
export function deleteModel(id: string) {
  return hologramIpc.deleteModel(id);
}
export function onModelDownloadProgress(cb: Parameters<typeof hologramIpc.onModelDownloadProgress>[0]) {
  return hologramIpc.onModelDownloadProgress(cb);
}
