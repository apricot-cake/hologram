// Trash service — soft-deleted record commands (list/restore/permanent-delete/
// empty-all), wrapping the flat corpusIpc.listTrash/restorePost/deleteFromTrash/
// emptyTrash calls (P4 "IPC→service" domain-grouping slice — BACKLOG「手書き
// .jsゼロ ＋ React 実プロダクト化」). A real ES module (named exports) imported
// directly by the Settings > Trash island (app/islands/settings/sections/Trash.tsx),
// giving it a domain home instead of reaching into window.corpus directly — pure 1:1
// forwarding, no wrapping logic (unlike tab-state/folders, trash has no serialize/
// sanitize step to own). The corpusIpc calls stay on window.corpusIpc until the
// ipc.ts core wave (see memory corpus-react-purity-execution-map).
export function listTrash() {
  return window.corpusIpc.listTrash();
}
export function restorePost(image: string) {
  return window.corpusIpc.restorePost(image);
}
export function deleteFromTrash(image: string) {
  return window.corpusIpc.deleteFromTrash(image);
}
export function emptyTrash() {
  return window.corpusIpc.emptyTrash();
}
