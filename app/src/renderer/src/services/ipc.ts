// Thin service seam over the raw preload IPC surface (window.hologram / HologramPreload).
// viewer.js is being decomposed away from touching window.hologram directly (final form B P4
// "IPC→service" — BACKLOG "hand-written .js zero + turn into a real React product") — this module is
// the one place that still calls the raw bridge; every other caller goes through here.
// Each export just forwards to window.hologram, so this slice was a pure rename with zero
// behavior change. Grouping the calls by domain into the sibling services that already
// own that logic is the follow-up slice — done so far for tabs (tab-state.js:
// loadTabs/persistTabs), tags/tag-types/poster-tags (tags.js: loadTagTypes/
// persistTagTypes, loadPosterTags/persistPosterTags), and
// grouping opt-outs (records.js: loadManualGroups/persistManualGroups, loadUngrouped/
// persistUngrouped), poster-folders (folders.js: createPersistedFolderStore), trash
// (trash.ts: listTrash/restorePost/deleteFromTrash/emptyTrash), backup (backup.ts:
// getBackup/setBackup/pickBackupDir/runBackup/onBackupStart/onBackupDone/
// getIntegrityStatus/runOrphanRecovery/onIntegrityCheckDone), and posts
// (posts.ts: listPosts/listPostsDelta/imageDataUrl/deletePost/updateTags/importLegacyZip/
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
  getExtensionContact: () => bridge().getExtensionContact(),
  listPosts: () => bridge().listPosts(),
  listPostsDelta: (haveBaseline) => bridge().listPostsDelta(haveBaseline),
  searchFullText: (query, limit) => bridge().searchFullText(query, limit),
  getTagTypes: () => bridge().getTagTypes(),
  setTagTypes: (types, labels) => bridge().setTagTypes(types, labels),
  getTagVocab: () => bridge().getTagVocab(),
  getTagParentEdges: () => bridge().getTagParentEdges(),
  renameTag: (tagId, newName) => bridge().renameTag(tagId, newName),
  keepSeparateRenameTag: (tagId, newName, displayParentTagId) => bridge().keepSeparateRenameTag(tagId, newName, displayParentTagId),
  mergeTags: (sourceTagId, targetTagId) => bridge().mergeTags(sourceTagId, targetTagId),
  addTagParent: (tagId, parentTagId, isDisplay) => bridge().addTagParent(tagId, parentTagId, isDisplay),
  removeTagParent: (tagId, parentTagId) => bridge().removeTagParent(tagId, parentTagId),
  setTagKind: (tagId, kind) => bridge().setTagKind(tagId, kind),
  deleteOrphanTags: (tagIds) => bridge().deleteOrphanTags(tagIds),
  getUngrouped: () => bridge().getUngrouped(),
  setUngrouped: (keys) => bridge().setUngrouped(keys),
  getPosterFolders: () => bridge().getPosterFolders(),
  setPosterFolders: (data) => bridge().setPosterFolders(data),
  getPosterTags: () => bridge().getPosterTags(),
  setPosterTags: (data) => bridge().setPosterTags(data),
  getPosterAliases: () => bridge().getPosterAliases(),
  setPosterAliases: (data) => bridge().setPosterAliases(data),
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
  copyText: (text) => bridge().copyText(text),
  getAppInfo: () => bridge().getAppInfo(),
  getPrefs: () => bridge().getPrefs(),
  setPref: (key, value) => bridge().setPref(key, value),
  imageDataUrl: (image) => bridge().imageDataUrl(image),
  ugoiraFramesPresent: (file, names) => bridge().ugoiraFramesPresent(file, names),
  ugoiraFrame: (file, name) => bridge().ugoiraFrame(file, name),
  deletePost: (image) => bridge().deletePost(image),
  updateTags: (image, tags, patch) => bridge().updateTags(image, tags, patch),
  importLegacyZip: (zipPath, duplicateMode) => bridge().importLegacyZip(zipPath, duplicateMode),
  clearAll: () => bridge().clearAll(),
  exportSave: (filename, bytes) => bridge().exportSave(filename, bytes),
  exportComplete: (mode, includeTrash) => bridge().exportComplete(mode, includeTrash),
  importComplete: () => bridge().importComplete(),
  pickSaveFolder: () => bridge().pickSaveFolder(),
  moveSaveFolder: (dest) => bridge().moveSaveFolder(dest),
  getLibraryStatus: () => bridge().getLibraryStatus(),
  pickRepointFolder: () => bridge().pickRepointFolder(),
  applyRepoint: (dest) => bridge().applyRepoint(dest),
  onSaveFolderProgress: (cb) => bridge().onSaveFolderProgress(cb),
  onExportProgress: (cb) => bridge().onExportProgress(cb),
  getBackup: () => bridge().getBackup(),
  setBackup: (patch) => bridge().setBackup(patch),
  pickBackupDir: () => bridge().pickBackupDir(),
  runBackup: () => bridge().runBackup(),
  importImages: () => bridge().importImages(),
  importClipboard: (title) => bridge().importClipboard(title),
  getWatchImport: () => bridge().getWatchImport(),
  pickWatchImportFolder: () => bridge().pickWatchImportFolder(),
  setWatchImport: (folders, markExisting) => bridge().setWatchImport(folders, markExisting),
  onBackupStart: (cb) => bridge().onBackupStart(cb),
  onBackupDone: (cb) => bridge().onBackupDone(cb),
  getIntegrityStatus: () => bridge().getIntegrityStatus(),
  runOrphanRecovery: () => bridge().runOrphanRecovery(),
  onIntegrityCheckDone: (cb) => bridge().onIntegrityCheckDone(cb),
  listTrash: () => bridge().listTrash(),
  restorePost: (image) => bridge().restorePost(image),
  emptyTrash: () => bridge().emptyTrash(),
  deleteFromTrash: (image) => bridge().deleteFromTrash(image),
  onPostsChanged: (cb) => bridge().onPostsChanged(cb),
  windowControl: (action) => bridge().windowControl(action),
  windowIsMaximized: () => bridge().windowIsMaximized(),
  onWindowMaximizedChanged: (cb) => bridge().onWindowMaximizedChanged(cb),
};
