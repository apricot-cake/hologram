// Thin service seam over the raw preload IPC surface (window.hologram / HologramPreload).
// viewer.js is being decomposed away from touching window.hologram directly (最終形B P4
// 「IPC→service」・BACKLOG「手書き .jsゼロ ＋ React 実プロダクト化」) — this module is
// the one place that still calls the raw bridge; every other caller goes through here.
// Each export just forwards to window.hologram, so this slice was a pure rename with zero
// behavior change. Grouping the calls by domain into the sibling services that already
// own that logic is the follow-up slice — done so far for tabs (tab-state.js:
// loadTabs/persistTabs), tags/tag-types/poster-tags (tags.js: loadTagTypes/
// persistTagTypes, loadPosterTags/persistPosterTags), and
// grouping opt-outs (records.js: loadManualGroups/persistManualGroups, loadUngrouped/
// persistUngrouped), poster-folders (folders.js: createPersistedFolderStore), trash
// (trash.ts: listTrash/restorePost/deleteFromTrash/emptyTrash), backup (backup.ts:
// getBackup/setBackup/pickBackupDir/runBackup/onBackupStart/onBackupDone), and posts
// (posts.ts: listPosts/listPostsDelta/imageDataUrl/deletePost/updateTags/importPosts/
// importImages/clearAll/exportSave/exportComplete/importComplete/pickSaveFolder/
// onSaveFolderProgress/onPostsChanged) — those domain services call this module
// rather than window.hologram directly, same as viewer.ts. Still flat here (no clear
// existing/new home decided yet): cross-cutting prefs/config/window-chrome. A real
// ES module now (named export), imported directly by every caller.

const bridge = () => window.hologram;

// Annotated against the shared HologramPreload contract (exported by app/src/preload/index.ts
// itself — typeof the exposed api — and aliased in types/globals.d.ts) so
// every forwarding arrow below is contextually typed from the implementation —
// no per-parameter annotations needed for a pure pass-through layer.
export const hologramIpc: HologramPreload = {
  getConfig: () => bridge().getConfig(),
  setExtensionId: (id) => bridge().setExtensionId(id),
  listPosts: () => bridge().listPosts(),
  listPostsDelta: (haveBaseline, changedNames) => bridge().listPostsDelta(haveBaseline, changedNames),
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
  getTabs: () => bridge().getTabs(),
  setTabs: (data) => bridge().setTabs(data),
  openExternal: (url) => bridge().openExternal(url),
  openImageWindow: (image) => bridge().openImageWindow(image),
  showInFolder: (file) => bridge().showInFolder(file),
  dragOut: (files) => bridge().dragOut(files),
  copyImage: (file) => bridge().copyImage(file),
  getAppInfo: () => bridge().getAppInfo(),
  getPrefs: () => bridge().getPrefs(),
  setPref: (key, value) => bridge().setPref(key, value),
  imageDataUrl: (image) => bridge().imageDataUrl(image),
  deletePost: (image) => bridge().deletePost(image),
  updateTags: (image, tags, patch) => bridge().updateTags(image, tags, patch),
  importPosts: (posts) => bridge().importPosts(posts),
  clearAll: () => bridge().clearAll(),
  exportSave: (filename, bytes) => bridge().exportSave(filename, bytes),
  exportComplete: (mode, includeTrash) => bridge().exportComplete(mode, includeTrash),
  importComplete: (bytes) => bridge().importComplete(bytes),
  pickSaveFolder: () => bridge().pickSaveFolder(),
  moveSaveFolder: (dest) => bridge().moveSaveFolder(dest),
  onSaveFolderProgress: (cb) => bridge().onSaveFolderProgress(cb),
  onExportProgress: (cb) => bridge().onExportProgress(cb),
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
  windowControl: (action) => bridge().windowControl(action),
  windowIsMaximized: () => bridge().windowIsMaximized(),
  onWindowMaximizedChanged: (cb) => bridge().onWindowMaximizedChanged(cb),
};
