// Preload bridge — the TypeScript SOURCE of the committed app/preload.js build
// output. The sandbox preload loader does NOT type-strip, so unlike the .mts
// main-process layer this one file is built (electron-vite's preload build →
// Vite lib CJS, electron external). .cts because the runtime module format is
// CJS (same convention as the native-host layer).
//
// The exported HologramPreload type IS the window.hologram contract: the renderer
// program aliases it in types/globals.d.ts (via the electron-shim paths
// mapping — see that file), so the type can never drift from what the bridge
// actually exposes. This file itself is type-checked against the REAL electron
// types by tsconfig.node.json.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import 'electron-log/preload';
import type {
  AiConfig,
  AppInfo,
  AppPrefs,
  BackupConfig,
  BackupDirPickResult,
  BackupRunResult,
  BackupWriteResult,
  ClearAllResult,
  ClipboardImportResult,
  CompleteImportResult,
  ConfigSummary,
  DbGeneration,
  DbRollbackResult,
  DropCollectResult,
  DroppedFile,
  DropImportResult,
  ExportCompleteResult,
  ExportProgress,
  ExportSaveResult,
  ExtensionContactStatus,
  FoldersState,
  FullTextHit,
  HistoryQueryOptions,
  HistoryQueryResult,
  IndexQueueStatus,
  IntegrityStatus,
  IpcPostRecord,
  LegacyImportResult,
  LibraryStatus,
  ManualGroupsState,
  MediaImportResult,
  ModelDownloadProgress,
  ModelInfo,
  WatchImportConfig,
  WatchImportFolder,
  OkResult,
  UpdateTagsResult,
  OrphanRecoveryResult,
  PickLibraryFolderResult,
  PinItem,
  PostsDelta,
  PostsSnapshot,
  PosterAliasesState,
  PosterFoldersState,
  PosterTagsState,
  RecentLibraryEntry,
  RepointApplyResult,
  RepointPickResult,
  SwitchLibraryResult,
  SaveFolderMoveResult,
  SaveFolderPickResult,
  SaveFolderProgress,
  TagVocabRow,
  TagParentRowResolved,
  RenameTagResult,
  TagWriteResult,
  DeleteOrphanTagsResult,
  TagSplitPost,
  SplitTagResult,
  TagAliasRow,
  AddTagAliasResult,
  TabsState,
  TagTypesState,
  UngroupedState,
} from '../main/ipc-payloads.ts';

// webUtils.getPathForFile(file: File) (electron.d.ts) references the ambient
// global `File`, normally satisfied by the "DOM" lib. tsconfig.node.json
// deliberately omits DOM — main + preload share that project, and DOM's
// setTimeout/Buffer-adjacent globals would shadow @types/node's across the
// whole main process (the same class of collision types/electron-shim.d.ts
// avoids in the other direction, on the renderer side). This declares just
// enough of `File` for that one call (#234) to type-check here; the renderer
// program that builds the real File objects handed through
// window.hologram.getPathForFile already has the true DOM lib
// (tsconfig.web.json), so it never needs this.
declare global {
  interface File {
    readonly name: string;
  }
}

// Every method below states what its channel resolves to (#228). `invoke` is
// Promise<any> by construction, so these annotations are the ONLY description
// the renderer gets — and they were `any` on a boundary that carries clear-all /
// import-complete / move-save-folder. The shapes live in ../main/ipc-payloads.ts,
// beside the handlers that produce them and annotated onto those handlers where
// the producing side type-checks cleanly; that module imports nothing, so the
// renderer's DOM-only program can reach it through HologramPreload.
const api = {
  getConfig: (): Promise<ConfigSummary> => ipcRenderer.invoke('get-config'),
  // #830 (parent #98): the AI features opt-in flag. Settings' AI Features
  // section is the only writer; every future AI-backed feature is a reader.
  getAiConfig: (): Promise<AiConfig> => ipcRenderer.invoke('get-ai-config'),
  setAiConfig: (patch: Partial<AiConfig>): Promise<AiConfig> => ipcRenderer.invoke('set-ai-config', patch),
  // #834 (parent #98): live background-indexing progress + its pause control.
  // Fetch once at mount, then follow the push — the queue's own status changes
  // are coalesced main-side, so this is a handful of messages per run.
  getIndexQueueStatus: (): Promise<IndexQueueStatus> => ipcRenderer.invoke('get-index-queue-status'),
  pauseIndexQueue: (): Promise<IndexQueueStatus> => ipcRenderer.invoke('pause-index-queue'),
  resumeIndexQueue: (): Promise<IndexQueueStatus> => ipcRenderer.invoke('resume-index-queue'),
  // Returns an unsubscribe (the onExportProgress shape) — the indicator mounts
  // with the shell, but a pin window's own tree does not, and a listener left
  // behind on a torn-down component would keep calling into it.
  onIndexQueueProgress: (cb: (s: IndexQueueStatus) => void): (() => void) => {
    const h = (_e: unknown, s: IndexQueueStatus) => cb(s);
    ipcRenderer.on('index-queue-progress', h);
    return () => ipcRenderer.removeListener('index-queue-progress', h);
  },
  // #832 (parent #98): the code-registry model list, joined with on-disk
  // status. Settings' AI Features section is the only caller today.
  getModelList: (): Promise<ModelInfo[]> => ipcRenderer.invoke('get-model-list'),
  downloadModel: (id: string): Promise<ModelInfo> => ipcRenderer.invoke('download-model', id),
  deleteModel: (id: string): Promise<OkResult> => ipcRenderer.invoke('delete-model', id),
  // Returns an unsubscribe, same shape onExportProgress uses — a download's
  // progress listener attaches for its duration and detaches when done.
  onModelDownloadProgress: (cb: (p: ModelDownloadProgress) => void): (() => void) => {
    const h = (_e: unknown, p: ModelDownloadProgress) => cb(p);
    ipcRenderer.on('model-download-progress', h);
    return () => ipcRenderer.removeListener('model-download-progress', h);
  },
  // #71: whether the bridge has EVER touched its contact marker — see
  // ipc-config.ts's get-extension-contact and empty/EmptyState.tsx's install-guide
  // variant. A one-shot fetch, not a push (nothing invalidates it mid-session).
  getExtensionContact: (): Promise<ExtensionContactStatus> => ipcRenderer.invoke('get-extension-contact'),
  listPosts: (): Promise<PostsSnapshot> => ipcRenderer.invoke('list-posts'),
  // Delta refresh: pass true once a full snapshot is held; main returns either a
  // full { full:true, posts:[] } or an incremental { full:false, added, removed }.
  listPostsDelta: (haveBaseline: boolean): Promise<PostsDelta> => ipcRenderer.invoke('list-posts-delta', haveBaseline),
  // #29: cross-tab full-text search — bm25() relevance order for the palette's
  // full-text mode (services/fulltext.ts decides which posts match; this only
  // ranks them).
  searchFullText: (query: string, limit?: number): Promise<FullTextHit[]> => ipcRenderer.invoke('search-full-text', query, limit),
  getTagTypes: (): Promise<TagTypesState> => ipcRenderer.invoke('get-tag-types'),
  setTagTypes: (types: unknown, labels?: unknown): Promise<OkResult> => ipcRenderer.invoke('set-tag-types', types, labels),
  // #21 tag management page (ipc-tag-vocab.ts) — row-scoped writes, not the
  // whole-map get/set-tag-types above (see that module's setTagKind comment).
  getTagVocab: (): Promise<TagVocabRow[]> => ipcRenderer.invoke('get-tag-vocab'),
  getTagParentEdges: (): Promise<TagParentRowResolved[]> => ipcRenderer.invoke('get-tag-parent-edges'),
  renameTag: (tagId: number, newName: string): Promise<RenameTagResult> => ipcRenderer.invoke('rename-tag', tagId, newName),
  keepSeparateRenameTag: (tagId: number, newName: string, displayParentTagId: number): Promise<TagWriteResult> => ipcRenderer.invoke('keep-separate-rename-tag', tagId, newName, displayParentTagId),
  mergeTags: (sourceTagId: number, targetTagId: number, keepOldNameAsAlias?: boolean): Promise<TagWriteResult> => ipcRenderer.invoke('merge-tags', sourceTagId, targetTagId, keepOldNameAsAlias),
  addTagParent: (tagId: number, parentTagId: number, isDisplay: boolean): Promise<TagWriteResult> => ipcRenderer.invoke('add-tag-parent', tagId, parentTagId, isDisplay),
  removeTagParent: (tagId: number, parentTagId: number): Promise<TagWriteResult> => ipcRenderer.invoke('remove-tag-parent', tagId, parentTagId),
  setTagKind: (tagId: number, kind: string | null): Promise<TagWriteResult> => ipcRenderer.invoke('set-tag-kind', tagId, kind),
  deleteOrphanTags: (tagIds: number[]): Promise<DeleteOrphanTagsResult> => ipcRenderer.invoke('delete-orphan-tags', tagIds),
  // #777: split -- the review screen's data source and its confirm action.
  getTagSplitPreview: (tagId: number, candidateParentTagId: number): Promise<TagSplitPost[]> => ipcRenderer.invoke('get-tag-split-preview', tagId, candidateParentTagId),
  splitTag: (sourceTagId: number, displayParentTagId: number, postIds: string[]): Promise<SplitTagResult> => ipcRenderer.invoke('split-tag', sourceTagId, displayParentTagId, postIds),
  // #86: tag_aliases CRUD.
  getTagAliases: (): Promise<TagAliasRow[]> => ipcRenderer.invoke('get-tag-aliases'),
  addTagAlias: (tagId: number, alias: string): Promise<AddTagAliasResult> => ipcRenderer.invoke('add-tag-alias', tagId, alias),
  removeTagAlias: (aliasId: number): Promise<TagWriteResult> => ipcRenderer.invoke('remove-tag-alias', aliasId),
  getUngrouped: (): Promise<UngroupedState> => ipcRenderer.invoke('get-ungrouped'),
  setUngrouped: (keys: unknown): Promise<OkResult> => ipcRenderer.invoke('set-ungrouped', keys),
  getPosterFolders: (): Promise<PosterFoldersState> => ipcRenderer.invoke('get-poster-folders'),
  setPosterFolders: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-poster-folders', data),
  getPosterTags: (): Promise<PosterTagsState> => ipcRenderer.invoke('get-poster-tags'),
  setPosterTags: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-poster-tags', data),
  getPosterAliases: (): Promise<PosterAliasesState> => ipcRenderer.invoke('get-poster-aliases'),
  setPosterAliases: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-poster-aliases', data),
  getManualGroups: (): Promise<ManualGroupsState> => ipcRenderer.invoke('get-manual-groups'),
  setManualGroups: (groups: unknown): Promise<OkResult> => ipcRenderer.invoke('set-manual-groups', groups),
  getFolders: (): Promise<FoldersState> => ipcRenderer.invoke('get-folders'),
  setFolders: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-folders', data),
  getTabs: (): Promise<TabsState | null> => ipcRenderer.invoke('get-tabs'),
  setTabs: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-tabs', data),
  // #145: global history page. append is fire-and-forget from the renderer's
  // push-time hook (services/history.ts); query pages by (ts, id) keyset, not
  // OFFSET (see lib-db-write.ts's queryHistory comment).
  appendHistory: (row: unknown): Promise<OkResult> => ipcRenderer.invoke('append-history', row),
  queryHistory: (opts: HistoryQueryOptions): Promise<HistoryQueryResult> => ipcRenderer.invoke('query-history', opts),
  deleteHistoryRow: (id: number): Promise<OkResult> => ipcRenderer.invoke('delete-history-row', id),
  clearHistory: (): Promise<OkResult> => ipcRenderer.invoke('clear-history'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  // false = refused. The standalone viewer shows raster images only (#215): an
  // SVG there would be a scripted document on the library's own origin.
  openImageWindow: (image: string): Promise<boolean> => ipcRenderer.invoke('open-image-window', image),
  showInFolder: (file: string): Promise<void> => ipcRenderer.invoke('show-in-folder', file),
  // #236: "開く" on a collected (assetClass:'file') card — main re-checks the
  // allowlist at click time and opens with the OS default app, or falls back
  // to reveal-in-folder (opened:false) when it refuses. See lib-open-gate.ts.
  openPostFile: (file: string): Promise<{ opened: boolean }> => ipcRenderer.invoke('open-post-file', file),
  // send, not invoke: the OS drag has to start inside the dragstart the renderer
  // is still holding open — a promise round-trip lands after the gesture is over.
  dragOut: (files: string[]): void => ipcRenderer.send('drag-out', files),
  // false = nativeImage couldn't decode it (svg/tiff) and the clipboard was left alone.
  copyImage: (file: string): Promise<boolean> => ipcRenderer.invoke('copy-image', file),
  // false = nothing to write; the clipboard was left alone (#167).
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('copy-text', text),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app-info'),
  getPrefs: (): Promise<AppPrefs> => ipcRenderer.invoke('get-prefs'),
  setPref: (key: string, value: unknown): Promise<OkResult> => ipcRenderer.invoke('set-pref', key, value),
  imageDataUrl: (image: string): Promise<string | null> => ipcRenderer.invoke('image-data-url', image),
  // pixiv ugoira playback (#506): main opens the archive and the renderer never
  // sees it. Ask once whether every frame the capture's table names is really in
  // there, then pull frames one at a time as the playhead needs them.
  ugoiraFramesPresent: (file: string, names: string[]): Promise<boolean> => ipcRenderer.invoke('ugoira-frames-present', file, names),
  // Uint8Array<ArrayBuffer>, not a bare Uint8Array: the renderer hands these
  // straight to a Blob, and BlobPart refuses a possibly-shared backing buffer.
  ugoiraFrame: (file: string, name: string): Promise<Uint8Array<ArrayBuffer> | null> => ipcRenderer.invoke('ugoira-frame', file, name),
  deletePost: (image: string): Promise<OkResult> => ipcRenderer.invoke('delete-post', image),
  updateTags: (image: string, tags: unknown, patch?: unknown): Promise<UpdateTagsResult> => ipcRenderer.invoke('update-tags', image, tags, patch),
  // Legacy-format ZIP import, second half: main reads the archive at `zipPath`
  // (the path import-complete handed back), so neither its bytes nor the records
  // it expands to cross this boundary (#322). Call once without a mode to learn
  // whether the batch has duplicates, then again with the answer (#34).
  importLegacyZip: (zipPath: string, duplicateMode?: string): Promise<LegacyImportResult> => ipcRenderer.invoke('import-legacy-zip', zipPath, duplicateMode),
  clearAll: (): Promise<ClearAllResult> => ipcRenderer.invoke('clear-all'),
  exportSave: (filename: string, bytes: Uint8Array | ArrayBuffer): Promise<ExportSaveResult> => ipcRenderer.invoke('export-save', filename, bytes),
  exportComplete: (mode?: string, includeTrash?: boolean): Promise<ExportCompleteResult> => ipcRenderer.invoke('export-complete', mode, includeTrash),
  // No argument: main runs the file picker and reads the archive off disk (#485).
  importComplete: (): Promise<CompleteImportResult> => ipcRenderer.invoke('import-complete'),
  pickSaveFolder: (): Promise<SaveFolderPickResult> => ipcRenderer.invoke('pick-save-folder'),
  moveSaveFolder: (dest: string): Promise<SaveFolderMoveResult> => ipcRenderer.invoke('move-save-folder', dest),
  // #37: whether the CURRENT save folder is missing on disk right now — always a
  // fresh check, never a cached push (see ipc-config.ts's get-library-status).
  getLibraryStatus: (): Promise<LibraryStatus> => ipcRenderer.invoke('get-library-status'),
  // Repoint: point config.saveFolder at an already-existing library elsewhere, with
  // NO copy (#37's escape hatch for a missing save folder — pick-save-folder/
  // move-save-folder above assume the CURRENT folder is there to copy FROM).
  pickRepointFolder: (): Promise<RepointPickResult> => ipcRenderer.invoke('pick-repoint-folder'),
  applyRepoint: (dest: string): Promise<RepointApplyResult> => ipcRenderer.invoke('apply-repoint', dest),
  // #176: Settings' deliberate "switch to a different library" flow (切り替え /
  // 新規作成 / 最近使ったライブラリ) — same underlying switchLibrary as repoint
  // above, different entry point and confirm copy.
  pickLibraryFolder: (): Promise<PickLibraryFolderResult> => ipcRenderer.invoke('pick-library-folder'),
  switchLibrary: (dest: string): Promise<SwitchLibraryResult> => ipcRenderer.invoke('switch-library', dest),
  getRecentLibraries: (): Promise<RecentLibraryEntry[]> => ipcRenderer.invoke('get-recent-libraries'),
  removeRecentLibrary: (folder: string): Promise<OkResult> => ipcRenderer.invoke('remove-recent-library', folder),
  onSaveFolderProgress: (cb: (p: SaveFolderProgress) => void): void => {
    ipcRenderer.on('save-folder-progress', (_e, p) => cb(p));
  },
  // Returns an unsubscribe (unlike onSaveFolderProgress) so an export can attach for its
  // duration and detach when done, without piling listeners up across repeated exports.
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const h = (_e: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on('export-progress', h);
    return () => ipcRenderer.removeListener('export-progress', h);
  },
  getBackup: (): Promise<BackupConfig> => ipcRenderer.invoke('get-backup'),
  setBackup: (patch: unknown): Promise<BackupWriteResult> => ipcRenderer.invoke('set-backup', patch),
  pickBackupDir: (): Promise<BackupDirPickResult> => ipcRenderer.invoke('pick-backup-dir'),
  runBackup: (): Promise<BackupRunResult> => ipcRenderer.invoke('run-backup'),
  listDbGenerations: (): Promise<DbGeneration[]> => ipcRenderer.invoke('list-db-generations'),
  // Rolls the library's organization back to one generation. Main reloads every
  // window shortly after answering — the whole renderer state is stale by then.
  rollbackDbGeneration: (name: string): Promise<DbRollbackResult> => ipcRenderer.invoke('rollback-db-generation', name),
  importImages: (): Promise<MediaImportResult> => ipcRenderer.invoke('import-images'),
  // #234: window drop-to-import — two calls so the recursive folder walk
  // finishes (and its count is confirmed) before anything writes. The same
  // DroppedFile[] collect-dropped-paths returns crosses back unchanged on the
  // second call so main never re-walks.
  collectDroppedPaths: (paths: string[]): Promise<DropCollectResult> => ipcRenderer.invoke('collect-dropped-paths', paths),
  importDroppedPaths: (files: DroppedFile[]): Promise<DropImportResult> => ipcRenderer.invoke('import-dropped-paths', files),
  // #234: the real fs path behind a File dragged onto the window from the OS —
  // Electron 32 removed File.path; webUtils.getPathForFile (Electron 43) is the
  // replacement.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // Ctrl+V in the app window (#85). `title` is built renderer-side because it is
  // a localized, user-visible label and main holds no message table.
  importClipboard: (title: string): Promise<ClipboardImportResult> => ipcRenderer.invoke('import-clipboard', title),
  getWatchImport: (): Promise<WatchImportConfig> => ipcRenderer.invoke('get-watch-import'),
  pickWatchImportFolder: (): Promise<{ ok: boolean; canceled?: boolean; error?: string; path?: string }> => ipcRenderer.invoke('pick-watch-import-folder'),
  setWatchImport: (folders: WatchImportFolder[], markExisting?: string[]): Promise<WatchImportConfig> => ipcRenderer.invoke('set-watch-import', folders, markExisting),
  // A run started — no payload at all, so cb takes no arguments; the raw IPC event
  // is not forwarded (#383). Never hand a renderer callback straight to
  // ipcRenderer.on: that lets Electron's IpcRendererEvent (and its `sender`)
  // across the contextBridge.
  onBackupStart: (cb: () => void): void => {
    ipcRenderer.on('backup-start', () => cb());
  },
  // cb receives the backup result only; the raw IPC event is not forwarded.
  onBackupDone: (cb: (result: BackupRunResult) => void): void => {
    ipcRenderer.on('backup-done', (_e, result) => cb(result));
  },
  getIntegrityStatus: (): Promise<IntegrityStatus> => ipcRenderer.invoke('get-integrity-status'),
  runOrphanRecovery: (): Promise<OrphanRecoveryResult> => ipcRenderer.invoke('run-orphan-recovery'),
  // cb receives the integrity status only; the raw IPC event is not forwarded.
  onIntegrityCheckDone: (cb: (status: IntegrityStatus) => void): void => {
    ipcRenderer.on('integrity-check-done', (_e, status) => cb(status));
  },
  // Trashed captures carry their whole record (the .trash/ JSON), so this is the
  // same open post-record shape list-posts hands back.
  listTrash: (): Promise<IpcPostRecord[]> => ipcRenderer.invoke('list-trash'),
  restorePost: (image: string): Promise<OkResult> => ipcRenderer.invoke('restore-post', image),
  emptyTrash: (): Promise<OkResult> => ipcRenderer.invoke('empty-trash'),
  deleteFromTrash: (image: string): Promise<OkResult> => ipcRenderer.invoke('delete-from-trash', image),
  // Fired when the intake queue changes; the raw IPC event is not forwarded.
  onPostsChanged: (cb: () => void): void => {
    ipcRenderer.on('posts-changed', () => cb());
  },
  // Window controls (min/max/close are app-drawn — see the WindowControls component).
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close'): Promise<boolean | null> => ipcRenderer.invoke('window-control', action),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  // cb receives the new maximized state; the raw IPC event is not forwarded.
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void): void => {
    ipcRenderer.on('window-maximized-changed', (_e, maximized) => cb(maximized));
  },
  // Ctrl+Shift+N / the "New window" affordance (#32 St1). `send`, not `invoke`:
  // nothing to wait on — main creates the window and this call is done.
  openNewWindow: (): void => ipcRenderer.send('open-new-window'),
  // #32 St2: fired after another window's organize-layer write (tag kind, poster
  // folders/tags/aliases, manual groups, ungrouped, library folders) succeeds — see
  // ipc-organize.ts. `kind` matches the get/set-* domain (e.g. 'folders',
  // 'poster-tags') so a subscriber can reload only the store that actually
  // changed. Returns an unsubscribe, the same shape onExportProgress uses.
  onOrgChanged: (cb: (kind: string) => void): (() => void) => {
    const h = (_e: unknown, kind: string) => cb(kind);
    ipcRenderer.on('org-changed', h);
    return () => ipcRenderer.removeListener('org-changed', h);
  },
  // #79 (pin window): send, not invoke — fire-and-forget the same way
  // open-new-window is, and opts.newWindow (the folder "ピンで開く" entry
  // point) should feel instant rather than await a round trip.
  pinSend: (items: PinItem[], opts?: { newWindow?: boolean }): void => ipcRenderer.send('pin-send', items, opts),
  // The pin window's own first read of what it was opened with — main never
  // pushes it at loadURL time (see lib-pin-window.ts's takeInitial comment).
  pinGetInitial: (): Promise<PinItem[]> => ipcRenderer.invoke('pin-get-initial'),
  onPinItemsAdded: (cb: (items: PinItem[]) => void): (() => void) => {
    const h = (_e: unknown, items: PinItem[]) => cb(items);
    ipcRenderer.on('pin-items-added', h);
    return () => ipcRenderer.removeListener('pin-items-added', h);
  },
  // Returns the NEW state (main resolves it from the calling window itself —
  // BrowserWindow.fromWebContents(event.sender) — same per-caller resolution
  // window-control already uses).
  pinToggleAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('pin-toggle-always-on-top'),
  pinSaveAsFolder: (name: string, captureIds: string[]): Promise<OkResult> => ipcRenderer.invoke('pin-save-as-folder', name, captureIds),
};

// The full contextBridge IPC surface (window.hologram) — typeof the implementation,
// so there is no hand-maintained mirror to drift.
export type HologramPreload = typeof api;

contextBridge.exposeInMainWorld('hologram', api);
