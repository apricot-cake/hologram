// Model manager (#832, parent #98) — thin forwarding over
// hologramIpc.getModelList/downloadModel/deleteModel/onModelDownloadProgress
// (same pattern as services/ai.ts). Settings' AI Features section is the only
// caller today; a future feature Issue (#48/#49/#50/#51) that needs its own
// model reads getModelList()/onModelDownloadProgress() the same way.
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
