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
import { contextBridge, ipcRenderer } from 'electron';
import 'electron-log/preload';
import type {
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
  ExportCompleteResult,
  ExportProgress,
  ExportSaveResult,
  ExtensionContactStatus,
  FoldersState,
  FullTextHit,
  IntegrityStatus,
  IpcPostRecord,
  LegacyImportResult,
  LibraryStatus,
  ManualGroupsState,
  MediaImportResult,
  WatchImportConfig,
  WatchImportFolder,
  OkResult,
  OrphanRecoveryResult,
  PostsDelta,
  PostsSnapshot,
  PosterAliasesState,
  PosterFoldersState,
  PosterTagsState,
  RepointApplyResult,
  RepointPickResult,
  SaveFolderMoveResult,
  SaveFolderPickResult,
  SaveFolderProgress,
  TagVocabRow,
  TagParentRowResolved,
  RenameTagResult,
  TagWriteResult,
  DeleteOrphanTagsResult,
  TabsState,
  TagTypesState,
  UngroupedState,
} from '../main/ipc-payloads.ts';

// Every method below states what its channel resolves to (#228). `invoke` is
// Promise<any> by construction, so these annotations are the ONLY description
// the renderer gets — and they were `any` on a boundary that carries clear-all /
// import-complete / move-save-folder. The shapes live in ../main/ipc-payloads.ts,
// beside the handlers that produce them and annotated onto those handlers where
// the producing side type-checks cleanly; that module imports nothing, so the
// renderer's DOM-only program can reach it through HologramPreload.
const api = {
  getConfig: (): Promise<ConfigSummary> => ipcRenderer.invoke('get-config'),
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
  mergeTags: (sourceTagId: number, targetTagId: number): Promise<TagWriteResult> => ipcRenderer.invoke('merge-tags', sourceTagId, targetTagId),
  addTagParent: (tagId: number, parentTagId: number, isDisplay: boolean): Promise<TagWriteResult> => ipcRenderer.invoke('add-tag-parent', tagId, parentTagId, isDisplay),
  removeTagParent: (tagId: number, parentTagId: number): Promise<TagWriteResult> => ipcRenderer.invoke('remove-tag-parent', tagId, parentTagId),
  setTagKind: (tagId: number, kind: string | null): Promise<TagWriteResult> => ipcRenderer.invoke('set-tag-kind', tagId, kind),
  deleteOrphanTags: (tagIds: number[]): Promise<DeleteOrphanTagsResult> => ipcRenderer.invoke('delete-orphan-tags', tagIds),
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
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  // false = refused. The standalone viewer shows raster images only (#215): an
  // SVG there would be a scripted document on the library's own origin.
  openImageWindow: (image: string): Promise<boolean> => ipcRenderer.invoke('open-image-window', image),
  showInFolder: (file: string): Promise<void> => ipcRenderer.invoke('show-in-folder', file),
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
  updateTags: (image: string, tags: unknown, patch?: unknown): Promise<OkResult> => ipcRenderer.invoke('update-tags', image, tags, patch),
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
  importImages: (): Promise<MediaImportResult> => ipcRenderer.invoke('import-images'),
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
};

// The full contextBridge IPC surface (window.hologram) — typeof the implementation,
// so there is no hand-maintained mirror to drift.
export type HologramPreload = typeof api;

contextBridge.exposeInMainWorld('hologram', api);
