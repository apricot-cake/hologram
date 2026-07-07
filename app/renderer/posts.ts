// Posts service — post-record CRUD, import/export and the save-folder move flow
// (list/listDelta/imageDataUrl/deletePost/updateTags/importPosts/importImages/
// clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/onPostsChanged/
// onSaveFolderProgress), wrapping the flat corpusIpc calls (P4 "IPC→service"
// domain-grouping slice ④ — BACKLOG「手書き .jsゼロ ＋ React 実プロダクト化」).
// Plain IIFE on window like the sibling renderer/*.ts services; loaded before
// viewer.js. Two consumers share this domain — viewer.ts (list/delete/tags/
// import/clearAll/change-watch) and the Settings > データ island (save-folder
// move + export/import ZIP + import media) — pure 1:1 forwarding, no wrapping
// logic (same as trash/backup; distinct from renderer/records.ts, which owns
// the record-shape/grouping PURE LOGIC, not the IPC calls).
(function () {
  'use strict';

  function listPosts() {
    return window.corpusIpc.listPosts();
  }
  function listPostsDelta(haveBaseline: boolean, changedNames?: string[] | null) {
    return window.corpusIpc.listPostsDelta(haveBaseline, changedNames);
  }
  function imageDataUrl(image: string) {
    return window.corpusIpc.imageDataUrl(image);
  }
  function deletePost(image: string) {
    return window.corpusIpc.deletePost(image);
  }
  function updateTags(image: string, tags: unknown, patch?: unknown) {
    return window.corpusIpc.updateTags(image, tags, patch);
  }
  function importPosts(posts: unknown) {
    return window.corpusIpc.importPosts(posts);
  }
  function importImages() {
    return window.corpusIpc.importImages();
  }
  function clearAll() {
    return window.corpusIpc.clearAll();
  }
  function exportSave(filename: string, bytes: Uint8Array | ArrayBuffer) {
    return window.corpusIpc.exportSave(filename, bytes);
  }
  function exportComplete(mode?: string) {
    return window.corpusIpc.exportComplete(mode);
  }
  function importComplete(bytes: Uint8Array | ArrayBuffer) {
    return window.corpusIpc.importComplete(bytes);
  }
  function pickSaveFolder() {
    return window.corpusIpc.pickSaveFolder();
  }
  function onSaveFolderProgress(cb: (p: any) => void) {
    return window.corpusIpc.onSaveFolderProgress(cb);
  }
  function onPostsChanged(cb: (names: string[] | null) => void) {
    return window.corpusIpc.onPostsChanged(cb);
  }

  const api = {
    listPosts,
    listPostsDelta,
    imageDataUrl,
    deletePost,
    updateTags,
    importPosts,
    importImages,
    clearAll,
    exportSave,
    exportComplete,
    importComplete,
    pickSaveFolder,
    onSaveFolderProgress,
    onPostsChanged,
  };
  if (typeof window !== 'undefined') window.corpusPosts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
