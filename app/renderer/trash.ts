// Trash service — soft-deleted record commands (list/restore/permanent-delete/
// empty-all), wrapping the flat corpusIpc.listTrash/restorePost/deleteFromTrash/
// emptyTrash calls (P4 "IPC→service" domain-grouping slice — BACKLOG「手書き
// .jsゼロ ＋ React 実プロダクト化」). Plain IIFE on window like the sibling
// renderer/*.ts services; loaded before viewer.js. Gives the Settings > Trash
// island (app/islands/settings/sections/Trash.tsx) a domain home instead of
// reaching into window.corpus directly — pure 1:1 forwarding, no wrapping logic
// (unlike tab-state/folders, trash has no serialize/sanitize step to own).
(function () {
  'use strict';

  function listTrash() {
    return window.corpusIpc.listTrash();
  }
  function restorePost(image: string) {
    return window.corpusIpc.restorePost(image);
  }
  function deleteFromTrash(image: string) {
    return window.corpusIpc.deleteFromTrash(image);
  }
  function emptyTrash() {
    return window.corpusIpc.emptyTrash();
  }

  const api = { listTrash, restorePost, deleteFromTrash, emptyTrash };
  if (typeof window !== 'undefined') window.corpusTrash = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
