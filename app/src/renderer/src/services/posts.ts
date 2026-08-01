// Posts service — post-record CRUD, import/export and the save-folder move flow
// (list/listDelta/imageDataUrl/deletePost/updateTags/importLegacyZip/importImages/
// clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/onPostsChanged/
// onSaveFolderProgress), wrapping the flat hologramIpc calls. A real ES module (named
// exports) now — imported directly by the consumers that share this domain: viewer.ts
// (list/delete/tags/import/clearAll/change-watch), App.tsx (onPostsChanged) and the
// Settings > Data component (save-folder move + export/import ZIP + import media) —
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
// pixiv ugoira playback (#506). The archive stays in main — these hand the
// player a yes/no about the frame table and then one frame's bytes at a time.
export function ugoiraFramesPresent(file: string, names: string[]) {
  return hologramIpc.ugoiraFramesPresent(file, names);
}
export function ugoiraFrame(file: string, name: string) {
  return hologramIpc.ugoiraFrame(file, name);
}
export function deletePost(image: string) {
  return hologramIpc.deletePost(image);
}
export function updateTags(image: string, tags: unknown, patch?: unknown) {
  return hologramIpc.updateTags(image, tags, patch);
}
// Legacy-format ZIP import (#322): main reads the archive at the path
// importComplete handed back. Without a mode it answers { needsChoice, duplicates }
// instead of importing (#34); call again with the answer.
export function importLegacyZip(zipPath: string, duplicateMode?: string) {
  return hologramIpc.importLegacyZip(zipPath, duplicateMode);
}
export function importImages() {
  return hologramIpc.importImages();
}
// Ctrl+V (#85). `title` is the card label the record gets — built by the caller
// because it is localized text and main has no message table.
export function importClipboard(title: string) {
  return hologramIpc.importClipboard(title);
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
// result, to { canceled:true }, or to { legacy:true, path } for an archive that
// isn't a complete export but is a legacy one (finish it with importLegacyZip).
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
