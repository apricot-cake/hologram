// Posts service — post-record CRUD, import/export and the save-folder move flow
// (list/listDelta/imageDataUrl/deletePost/updateTags/importPosts/importImages/
// clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/onPostsChanged/
// onSaveFolderProgress), wrapping the flat corpusIpc calls. A real ES module (named
// exports) now — imported directly by the consumers that share this domain: viewer.ts
// (list/delete/tags/import/clearAll/change-watch), App.tsx (onPostsChanged) and the
// Settings > データ island (save-folder move + export/import ZIP + import media) —
// pure 1:1 forwarding, no wrapping logic (same as trash/backup; distinct from
// renderer/records.ts, which owns the record-shape/grouping PURE LOGIC, not the IPC
// calls). The internal corpusIpc calls stay on window until ipc.ts is converted (Wave13).
export function listPosts() {
  return window.corpusIpc.listPosts();
}
export function listPostsDelta(haveBaseline: boolean, changedNames?: string[] | null) {
  return window.corpusIpc.listPostsDelta(haveBaseline, changedNames);
}
export function imageDataUrl(image: string) {
  return window.corpusIpc.imageDataUrl(image);
}
export function deletePost(image: string) {
  return window.corpusIpc.deletePost(image);
}
export function updateTags(image: string, tags: unknown, patch?: unknown) {
  return window.corpusIpc.updateTags(image, tags, patch);
}
export function importPosts(posts: unknown) {
  return window.corpusIpc.importPosts(posts);
}
export function importImages() {
  return window.corpusIpc.importImages();
}
export function clearAll() {
  return window.corpusIpc.clearAll();
}
export function exportSave(filename: string, bytes: Uint8Array | ArrayBuffer) {
  return window.corpusIpc.exportSave(filename, bytes);
}
export function exportComplete(mode?: string) {
  return window.corpusIpc.exportComplete(mode);
}
export function importComplete(bytes: Uint8Array | ArrayBuffer) {
  return window.corpusIpc.importComplete(bytes);
}
export function pickSaveFolder() {
  return window.corpusIpc.pickSaveFolder();
}
export function onSaveFolderProgress(cb: (p: any) => void) {
  return window.corpusIpc.onSaveFolderProgress(cb);
}
export function onPostsChanged(cb: (names: string[] | null) => void) {
  return window.corpusIpc.onPostsChanged(cb);
}
