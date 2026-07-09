// Thin service seam over the raw preload IPC surface (window.corpus / CorpusPreload).
// viewer.js is being decomposed away from touching window.corpus directly (最終形B P4
// 「IPC→service」・BACKLOG「手書き .jsゼロ ＋ React 実プロダクト化」) — this module is
// the one place that still calls the raw bridge; every other caller goes through here.
// Each export just forwards to window.corpus, so this slice was a pure rename with zero
// behavior change. Grouping the calls by domain into the sibling services that already
// own that logic is the follow-up slice — done so far for tabs (tab-state.js:
// loadTabs/persistTabs), tags/tag-types/poster-tags (tags.js: loadTagGroups/
// persistTagGroups, loadTagTypes/persistTagTypes, loadPosterTags/persistPosterTags), and
// grouping opt-outs (records.js: loadManualGroups/persistManualGroups, loadUngrouped/
// persistUngrouped), poster-folders (folders.js: createPersistedFolderStore), trash
// (trash.ts: listTrash/restorePost/deleteFromTrash/emptyTrash), backup (backup.ts:
// getBackup/setBackup/pickBackupDir/runBackup/onBackupStart/onBackupDone), and posts
// (posts.ts: listPosts/listPostsDelta/imageDataUrl/deletePost/updateTags/importPosts/
// importImages/clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/
// onSaveFolderProgress/onPostsChanged) — those domain services call this module
// rather than window.corpus directly, same as viewer.js. Still flat here (no clear
// existing/new home decided yet): cross-cutting prefs/config/window-chrome. Plain
// IIFE on window (like the sibling renderer/*.ts services), loaded before viewer.js.
(function () {
  'use strict';

  const bridge = () => window.corpus;

  // Annotated against the shared CorpusPreload contract (islands/types/globals.d.ts)
  // so every forwarding arrow below is contextually typed from that interface —
  // no per-parameter annotations needed for a pure pass-through layer.
  const api: CorpusPreload = {
    getConfig: () => bridge().getConfig(),
    setExtensionId: (id) => bridge().setExtensionId(id),
    listPosts: () => bridge().listPosts(),
    listPostsDelta: (haveBaseline, changedNames) => bridge().listPostsDelta(haveBaseline, changedNames),
    getTagGroups: () => bridge().getTagGroups(),
    setTagGroups: (groups) => bridge().setTagGroups(groups),
    getTagTypes: () => bridge().getTagTypes(),
    setTagTypes: (types, labels) => bridge().setTagTypes(types, labels),
    getUngrouped: () => bridge().getUngrouped(),
    setUngrouped: (keys) => bridge().setUngrouped(keys),
    getPosterFolders: () => bridge().getPosterFolders(),
    setPosterFolders: (data) => bridge().setPosterFolders(data),
    getPosterTags: () => bridge().getPosterTags(),
    setPosterTags: (data) => bridge().setPosterTags(data),
    getManualGroups: () => bridge().getManualGroups(),
    setManualGroups: (groups) => bridge().setManualGroups(groups),
    getFolders: () => bridge().getFolders(),
    setFolders: (data) => bridge().setFolders(data),
    getCollections: () => bridge().getCollections(),
    setCollections: (data) => bridge().setCollections(data),
    getTabs: () => bridge().getTabs(),
    setTabs: (data) => bridge().setTabs(data),
    openExternal: (url) => bridge().openExternal(url),
    openImageWindow: (image) => bridge().openImageWindow(image),
    showInFolder: (file) => bridge().showInFolder(file),
    getAppInfo: () => bridge().getAppInfo(),
    getPrefs: () => bridge().getPrefs(),
    setPref: (key, value) => bridge().setPref(key, value),
    imageDataUrl: (image) => bridge().imageDataUrl(image),
    deletePost: (image) => bridge().deletePost(image),
    updateTags: (image, tags, patch) => bridge().updateTags(image, tags, patch),
    importPosts: (posts) => bridge().importPosts(posts),
    clearAll: () => bridge().clearAll(),
    exportSave: (filename, bytes) => bridge().exportSave(filename, bytes),
    exportComplete: (mode) => bridge().exportComplete(mode),
    importComplete: (bytes) => bridge().importComplete(bytes),
    pickSaveFolder: () => bridge().pickSaveFolder(),
    onSaveFolderProgress: (cb) => bridge().onSaveFolderProgress(cb),
    getBackup: () => bridge().getBackup(),
    setBackup: (patch) => bridge().setBackup(patch),
    pickBackupDir: () => bridge().pickBackupDir(),
    runBackup: () => bridge().runBackup(),
    importImages: () => bridge().importImages(),
    onBackupStart: (cb) => bridge().onBackupStart(cb),
    onBackupDone: (cb) => bridge().onBackupDone(cb),
    listTrash: () => bridge().listTrash(),
    restorePost: (image) => bridge().restorePost(image),
    emptyTrash: () => bridge().emptyTrash(),
    deleteFromTrash: (image) => bridge().deleteFromTrash(image),
    onPostsChanged: (cb) => bridge().onPostsChanged(cb),
    setTitleBarOverlay: (opts) => bridge().setTitleBarOverlay(opts),
  };

  if (typeof window !== 'undefined') window.corpusIpc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
