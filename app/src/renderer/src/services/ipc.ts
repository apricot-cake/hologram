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
// listTrash/restorePost/deleteFromTrash/emptyTrash）、データ保全
// （backup.ts: getExportReminder/setExportReminderEnabled/
// onExportReminderChanged/getIntegrityStatus/runOrphanRecovery/onIntegrityCheckDone）、
// 投稿（posts.ts: listPosts/listPostsDelta/imageDataUrl/deletePost/
// updateTags/importImages/clearAll/exportSave/
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
  takePostLink: () => bridge().takePostLink(),
  onPostLink: (cb) => bridge().onPostLink(cb),
  getConfig: () => bridge().getConfig(),
  getExtensionContact: () => bridge().getExtensionContact(),
  listPosts: () => bridge().listPosts(),
  listPostsDelta: (haveBaseline) => bridge().listPostsDelta(haveBaseline),
  searchCandidates: (query, entries) => bridge().searchCandidates(query, entries),
  searchFullText: (query, limit) => bridge().searchFullText(query, limit),
  applyCachedMetadata: (key) => bridge().applyCachedMetadata(key),
  recordPostView: (captureId) => bridge().recordPostView(captureId),
  setMediaCrop: (postId, seq, crop) => bridge().setMediaCrop(postId, seq, crop),
  getTagGroups: () => bridge().getTagGroups(),
  setTagGroups: (types, labels) => bridge().setTagGroups(types, labels),
  getTagVocab: () => bridge().getTagVocab(),
  saveClassifiedTag: (input) => bridge().saveClassifiedTag(input),
  getClassifiedAssignments: (ids) => bridge().getClassifiedAssignments(ids),
  setClassifiedAssignments: (rows) => bridge().setClassifiedAssignments(rows),
  renameTag: (tagId, newName) => bridge().renameTag(tagId, newName),
  mergeTags: (sourceTagId, targetTagId) => bridge().mergeTags(sourceTagId, targetTagId),
  setTagGroup: (tagId, kind) => bridge().setTagGroup(tagId, kind),
  deleteTags: (tagIds) => bridge().deleteTags(tagIds),
  getUngrouped: () => bridge().getUngrouped(),
  setUngrouped: (keys) => bridge().setUngrouped(keys),
  getPosterTags: () => bridge().getPosterTags(),
  setPosterTags: (data) => bridge().setPosterTags(data),
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
  getExportReminder: () => bridge().getExportReminder(),
  setExportReminderEnabled: (enabled) => bridge().setExportReminderEnabled(enabled),
  setExportReminderThreshold: (threshold) => bridge().setExportReminderThreshold(threshold),
  onExportReminderChanged: (cb) => bridge().onExportReminderChanged(cb),
  importImages: () => bridge().importImages(),
  collectDroppedPaths: (paths) => bridge().collectDroppedPaths(paths),
  importDroppedPaths: (files, stackFolders) => bridge().importDroppedPaths(files, stackFolders),
  getPathForFile: (file) => bridge().getPathForFile(file),
  importClipboard: (title) => bridge().importClipboard(title),
  getIntegrityStatus: () => bridge().getIntegrityStatus(),
  runOrphanRecovery: () => bridge().runOrphanRecovery(),
  onIntegrityCheckDone: (cb) => bridge().onIntegrityCheckDone(cb),
  listTrash: () => bridge().listTrash(),
  restorePost: (image) => bridge().restorePost(image),
  emptyTrash: () => bridge().emptyTrash(),
  deleteFromTrash: (image) => bridge().deleteFromTrash(image),
  onPostsChanged: (cb) => bridge().onPostsChanged(cb),
  windowControl: (action) => bridge().windowControl(action),
  openNewWindow: () => bridge().openNewWindow(),
  onOrgChanged: (cb) => bridge().onOrgChanged(cb),
  pinSend: (items, opts) => bridge().pinSend(items, opts),
  pinGetInitial: () => bridge().pinGetInitial(),
  onPinItemsAdded: (cb) => bridge().onPinItemsAdded(cb),
  pinToggleAlwaysOnTop: () => bridge().pinToggleAlwaysOnTop(),
  pinSaveAsFolder: (name, captureIds) => bridge().pinSaveAsFolder(name, captureIds),
};
