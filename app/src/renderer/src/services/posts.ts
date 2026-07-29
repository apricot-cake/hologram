// Posts service — post-record CRUD, import/export and the save-folder move flow
// (list/listDelta/imageDataUrl/deletePost/updateTags/importPosts/importImages/
// clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/onPostsChanged/
// onSaveFolderProgress), wrapping the flat hologramIpc calls. A real ES module (named
// exports) now — imported directly by the consumers that share this domain: viewer.ts
// (list/delete/tags/import/clearAll/change-watch), App.tsx (onPostsChanged) and the
// Settings > データ component (save-folder move + export/import ZIP + import media) —
// pure 1:1 forwarding, no wrapping logic (same as trash/backup; distinct from
// services/records.ts, which owns the record-shape/grouping PURE LOGIC, not the IPC
// calls).
import { hologramIpc } from './ipc.ts';

export function listPosts() {
  return hologramIpc.listPosts();
}
export function listPostsDelta(haveBaseline: boolean) {
  return hologramIpc.listPostsDelta(haveBaseline);
}
export function imageDataUrl(image: string) {
  return hologramIpc.imageDataUrl(image);
}
export function deletePost(image: string) {
  return hologramIpc.deletePost(image);
}
export function updateTags(image: string, tags: unknown, patch?: unknown) {
  return hologramIpc.updateTags(image, tags, patch);
}
export function importPosts(posts: unknown) {
  return hologramIpc.importPosts(posts);
}
export function importImages() {
  return hologramIpc.importImages();
}
export function clearAll() {
  return hologramIpc.clearAll();
}
export function exportSave(filename: string, bytes: Uint8Array | ArrayBuffer) {
  return hologramIpc.exportSave(filename, bytes);
}
export function exportComplete(mode?: string, includeTrash?: boolean) {
  return hologramIpc.exportComplete(mode, includeTrash);
}
// main owns the file picker AND the read (#485) — this resolves to the import
// result, to { canceled:true }, or to { legacy:true, bytes } for an archive that
// isn't a complete export (see legacy-zip-import.ts).
export function importComplete() {
  return hologramIpc.importComplete();
}
export function pickSaveFolder() {
  return hologramIpc.pickSaveFolder();
}
// Second half of the pick flow — relocate to a destination pick-save-folder handed
// back with a warning the user then accepted (#95).
export function moveSaveFolder(dest: string) {
  return hologramIpc.moveSaveFolder(dest);
}
export function onSaveFolderProgress(cb: (p: any) => void) {
  return hologramIpc.onSaveFolderProgress(cb);
}
// Export streaming progress: returns an unsubscribe. Payloads: {written,total,pct} while
// running, then {done:true}.
export function onExportProgress(cb: (p: any) => void): () => void {
  return hologramIpc.onExportProgress(cb);
}
export function onPostsChanged(cb: () => void) {
  return hologramIpc.onPostsChanged(cb);
}
