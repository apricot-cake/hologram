// Posts service — post-record CRUD, import/export and the save-folder move flow
// (list/listDelta/imageDataUrl/deletePost/updateTags/importPosts/importImages/
// clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/onPostsChanged/
// onSaveFolderProgress), wrapping the flat corpusIpc calls. A real ES module (named
// exports) now — imported directly by the consumers that share this domain: viewer.ts
// (list/delete/tags/import/clearAll/change-watch), App.tsx (onPostsChanged) and the
// Settings > データ island (save-folder move + export/import ZIP + import media) —
// pure 1:1 forwarding, no wrapping logic (same as trash/backup; distinct from
// renderer/records.ts, which owns the record-shape/grouping PURE LOGIC, not the IPC
// calls).
import { corpusIpc } from './ipc.ts';

export function listPosts() {
  return corpusIpc.listPosts();
}
export function listPostsDelta(haveBaseline: boolean, changedNames?: string[] | null) {
  return corpusIpc.listPostsDelta(haveBaseline, changedNames);
}
export function imageDataUrl(image: string) {
  return corpusIpc.imageDataUrl(image);
}
export function deletePost(image: string) {
  return corpusIpc.deletePost(image);
}
export function updateTags(image: string, tags: unknown, patch?: unknown) {
  return corpusIpc.updateTags(image, tags, patch);
}
export function importPosts(posts: unknown) {
  return corpusIpc.importPosts(posts);
}
export function importImages() {
  return corpusIpc.importImages();
}
export function clearAll() {
  return corpusIpc.clearAll();
}
export function exportSave(filename: string, bytes: Uint8Array | ArrayBuffer) {
  return corpusIpc.exportSave(filename, bytes);
}
export function exportComplete(mode?: string) {
  return corpusIpc.exportComplete(mode);
}
export function importComplete(bytes: Uint8Array | ArrayBuffer) {
  return corpusIpc.importComplete(bytes);
}
export function pickSaveFolder() {
  return corpusIpc.pickSaveFolder();
}
// Second half of the pick flow — relocate to a destination pick-save-folder handed
// back with a warning the user then accepted (#95).
export function moveSaveFolder(dest: string) {
  return corpusIpc.moveSaveFolder(dest);
}
export function onSaveFolderProgress(cb: (p: any) => void) {
  return corpusIpc.onSaveFolderProgress(cb);
}
export function onPostsChanged(cb: (names: string[] | null) => void) {
  return corpusIpc.onPostsChanged(cb);
}
