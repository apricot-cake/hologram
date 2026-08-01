// Trash service — soft-deleted record commands (list/restore/permanent-delete/
// empty-all), wrapping the flat hologramIpc.listTrash/restorePost/deleteFromTrash/
// emptyTrash calls (P4 "IPC→service" domain-grouping slice — BACKLOG "zero
// hand-written .js + productionize with React"). A real ES module (named exports) imported
// directly by the Settings > Trash component (settings/sections/Trash.tsx),
// giving it a domain home instead of reaching into window.hologram directly — pure 1:1
// forwarding, no wrapping logic (unlike tab-state/folders, trash has no serialize/
// sanitize step to own).
import { hologramIpc } from './ipc.ts';

export function listTrash() {
  return hologramIpc.listTrash();
}
export function restorePost(image: string) {
  return hologramIpc.restorePost(image);
}
export function deleteFromTrash(image: string) {
  return hologramIpc.deleteFromTrash(image);
}
export function emptyTrash() {
  return hologramIpc.emptyTrash();
}
