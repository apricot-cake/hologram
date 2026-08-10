// 生の preload IPC 面（window.hologram / HologramPreload）に対する薄いサービス
// の継ぎ目。viewer.js は window.hologram に直接触れないよう分解が進んでいる
// （最終形B の P4「IPC→service」――バックログの「手書きの .js をゼロにし、
// 本物の React 製品へ」）――このモジュールが今も生のブリッジを呼ぶ唯一の
// 場所で、他のすべての呼び出し元はここを経由する。各 export は
// window.hologram へ転送するだけなので、この切り出しは挙動の変化ゼロの
// 純粋なリネームだった。呼び出しをドメインごとに、すでにそのロジックを
// 持つ兄弟サービスへグループ化するのは次の切り出し――これまでに済んで
// いるのは: タブ（tab-state.js: loadTabs/persistTabs）、タグ／タグ種類／
// ポスタータグ（tags.js: loadTagTypes/persistTagTypes、
// loadPosterTags/persistPosterTags）、グルーピングの opt-out
// （records.js: loadManualGroups/persistManualGroups、
// loadUngrouped/persistUngrouped）、ポスターフォルダ（folders.js:
// createPersistedFolderStore）、ゴミ箱（trash.ts:
// listTrash/restorePost/deleteFromTrash/emptyTrash）、バックアップ
// （backup.ts: getBackup/setBackup/pickBackupDir/runBackup/onBackupStart/
// onBackupDone/getIntegrityStatus/runOrphanRecovery/onIntegrityCheckDone）、
// 投稿（posts.ts: listPosts/listPostsDelta/imageDataUrl/deletePost/
// updateTags/importLegacyZip/importImages/clearAll/exportSave/
// exportComplete/importComplete/pickSaveFolder/onSaveFolderProgress/
// onPostsChanged）――それらドメインサービスは viewer.ts と同じく、
// window.hologram を直接ではなくこのモジュールを呼ぶ。ここにまだ平坦な
// ままなのは（既存／新規どちらの置き場にするかまだ決めていない）:
// 横断的な prefs／config／ウィンドウの外枠。今では本物の ES モジュール
// （named export）で、すべての呼び出し元から直接 import される。

const bridge = () => window.hologram;

// 共有の HologramPreload 契約（app/src/preload/index.ts 自身が export する
// 公開 api の typeof。types/globals.d.ts で別名も付けている）に照らして
// 注釈しているので、下の転送アローはどれも実装から文脈的に型付けされる
// ――純粋な素通し層に、引数ごとの注釈は要らない。
export const hologramIpc: HologramPreload = {
  getConfig: () => bridge().getConfig(),
  getAiConfig: () => bridge().getAiConfig(),
  setAiConfig: (patch) => bridge().setAiConfig(patch),
  getIndexQueueStatus: () => bridge().getIndexQueueStatus(),
  pauseIndexQueue: () => bridge().pauseIndexQueue(),
  resumeIndexQueue: () => bridge().resumeIndexQueue(),
  onIndexQueueProgress: (cb) => bridge().onIndexQueueProgress(cb),
  getModelList: () => bridge().getModelList(),
  downloadModel: (id) => bridge().downloadModel(id),
  deleteModel: (id) => bridge().deleteModel(id),
  onModelDownloadProgress: (cb) => bridge().onModelDownloadProgress(cb),
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
  mergeTags: (sourceTagId, targetTagId, keepOldNameAsAlias) => bridge().mergeTags(sourceTagId, targetTagId, keepOldNameAsAlias),
  addTagParent: (tagId, parentTagId, isDisplay) => bridge().addTagParent(tagId, parentTagId, isDisplay),
  removeTagParent: (tagId, parentTagId) => bridge().removeTagParent(tagId, parentTagId),
  setTagKind: (tagId, kind) => bridge().setTagKind(tagId, kind),
  deleteOrphanTags: (tagIds) => bridge().deleteOrphanTags(tagIds),
  getTagSplitPreview: (tagId, candidateParentTagId) => bridge().getTagSplitPreview(tagId, candidateParentTagId),
  splitTag: (sourceTagId, displayParentTagId, postIds) => bridge().splitTag(sourceTagId, displayParentTagId, postIds),
  getTagAliases: () => bridge().getTagAliases(),
  addTagAlias: (tagId, alias) => bridge().addTagAlias(tagId, alias),
  removeTagAlias: (aliasId) => bridge().removeTagAlias(aliasId),
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
  appendHistory: (row) => bridge().appendHistory(row),
  queryHistory: (opts) => bridge().queryHistory(opts),
  deleteHistoryRow: (id) => bridge().deleteHistoryRow(id),
  clearHistory: () => bridge().clearHistory(),
  openExternal: (url) => bridge().openExternal(url),
  openImageWindow: (image) => bridge().openImageWindow(image),
  showInFolder: (file) => bridge().showInFolder(file),
  openPostFile: (file) => bridge().openPostFile(file),
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
  pickLibraryFolder: () => bridge().pickLibraryFolder(),
  switchLibrary: (dest) => bridge().switchLibrary(dest),
  getRecentLibraries: () => bridge().getRecentLibraries(),
  removeRecentLibrary: (folder) => bridge().removeRecentLibrary(folder),
  onSaveFolderProgress: (cb) => bridge().onSaveFolderProgress(cb),
  onExportProgress: (cb) => bridge().onExportProgress(cb),
  getBackup: () => bridge().getBackup(),
  setBackup: (patch) => bridge().setBackup(patch),
  pickBackupDir: () => bridge().pickBackupDir(),
  runBackup: () => bridge().runBackup(),
  listDbGenerations: () => bridge().listDbGenerations(),
  rollbackDbGeneration: (name) => bridge().rollbackDbGeneration(name),
  importImages: () => bridge().importImages(),
  collectDroppedPaths: (paths) => bridge().collectDroppedPaths(paths),
  importDroppedPaths: (files) => bridge().importDroppedPaths(files),
  getPathForFile: (file) => bridge().getPathForFile(file),
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
  openNewWindow: () => bridge().openNewWindow(),
  onOrgChanged: (cb) => bridge().onOrgChanged(cb),
  pinSend: (items, opts) => bridge().pinSend(items, opts),
  pinGetInitial: () => bridge().pinGetInitial(),
  onPinItemsAdded: (cb) => bridge().onPinItemsAdded(cb),
  pinToggleAlwaysOnTop: () => bridge().pinToggleAlwaysOnTop(),
  pinSaveAsFolder: (name, captureIds) => bridge().pinSaveAsFolder(name, captureIds),
};
