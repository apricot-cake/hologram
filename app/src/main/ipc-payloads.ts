'use strict';

// The PAYLOAD half of the main⇄renderer IPC contract (#228): the shapes that
// actually travel over ipcMain.handle / ipcRenderer.invoke, plus the ones pushed
// with webContents.send. Nothing here is Electron- or SQLite-aware, and this
// module imports nothing at all — that is deliberate. The renderer's strict
// program reaches these types transitively (types/globals.d.ts aliases
// HologramPreload, which annotates every bridge method with them), so anything
// this file pulled in would be pulled into a DOM-only program too.
//
// The main-process-internal half — the `ctx` dependency object the ipc-*
// modules receive — is ./ipc-context.ts, which is main-only precisely because it
// does name BrowserWindow and the DB writer.
//
// What these types are and are not:
//   * They are a hand-checked statement of what each handler returns, read off
//     the handlers. `ipcRenderer.invoke` is `Promise<any>` by construction, so
//     no compiler links a channel's two ends; a channel MAP that does is the
//     central-wrapper work in #10, not this Issue. Where a handler's own return
//     type lines up cleanly, it is annotated with the type below so at least the
//     producing side is checked.
//   * They are written as ONE flat shape per channel with optional members,
//     not as discriminated unions, because that is how the callers read them
//     (`res.ok`, `res.posts || []`, `res.error`). A union would be a stricter
//     description of the same values, and would force narrowing rewrites into
//     renderer call sites this Issue does not touch.

// --- Post records ---------------------------------------------------------
// One assembled post record. Deliberately an open map rather than the column
// list: the record is assembled by SELECT (lib-db-query.ts's postsFromDb), the
// renderer treats it as an open object throughout (HologramPost) and adds
// derived fields to it (records.ts's stampPost), and #295's PostRecordShape is
// the authority on the WRITE side. Pinning the read shape is a renderer-side
// pass, not part of typing this boundary — but naming it here means the
// boundary says "a post record", not "any".
export type IpcPostRecord = Record<string, any>;

/** list-posts: the whole library plus the folder it was read from. */
export interface PostsSnapshot {
  saveFolder: string | null;
  posts: IpcPostRecord[];
}

/**
 * list-posts-delta. `full` says which of the two payloads this is: a full
 * snapshot carries `posts`, an incremental one carries `added` + `removed`
 * (captureIds).
 */
export interface PostsDelta {
  saveFolder: string | null;
  full: boolean;
  posts?: IpcPostRecord[];
  added?: IpcPostRecord[];
  removed?: string[];
}

// --- Generic results -----------------------------------------------------
/** The bare acknowledgement most write handlers answer with. */
export interface OkResult {
  ok: boolean;
}

/** A guard's verdict (validateSaveFolder / validateBackupDir). */
export interface ValidationResult {
  ok: boolean;
  error?: string;
}

// --- Config / preferences ------------------------------------------------
/** get-config — the two config.json fields the renderer is allowed to see. */
export interface ConfigSummary {
  saveFolder: string | null;
  extensionId: string | null;
}

/** set-extension-id — the id as stored, i.e. '' when the input was refused. */
export interface ExtensionIdResult {
  extensionId: string;
}

/** app-info — the settings "About" panel's build info. */
export interface AppInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
}

/**
 * get-prefs. Every member is resolved by the handler (allow-list + fallback),
 * so nothing here is optional; `null` means "never set", which the renderer
 * distinguishes from a value.
 */
export interface AppPrefs {
  language: string;
  viewMode: string;
  skipDeleteConfirm: boolean;
  sortBy: string;
  imageTileSize: number | null;
  cardSize: number | null;
  listThumb: number | null;
  tileOverlay: boolean;
  theme: string;
  browseMode: string;
  posterViewMode: string;
  posterTileSize: number | null;
  posterCardSize: number | null;
  sidebarOpen: boolean | null;
  sidebarWidth: number | null;
  inspectorOpen: boolean | null;
  inspectorWidth: number | null;
}

// --- Organization layer (DB-backed, ipc-organize.ts) ---------------------
/** get/set-tag-types: tag name -> 種別, plus the renamable work/character labels. */
export interface TagTypesState {
  types: Record<string, string>;
  labels: Record<string, string> | null;
}

/** get/set-ungrouped: post keys opted out of auto-grouping. */
export interface UngroupedState {
  keys: string[];
}

/** get/set-manual-groups: user-built groups of captureIds. */
export interface ManualGroupsState {
  groups: string[][];
}

/** One named folder. A dynamic folder carries a saved search and holds no items. */
export interface FolderRecord {
  id: string;
  name: string;
  kind: string;
  created: number | null;
  parentId: string | null;
  items: string[];
  tree?: unknown;
}

/** get/set-folders. `activeId` is legacy and settles to null. */
export interface FoldersState {
  folders: FolderRecord[];
  activeId: string | null;
}

/** One poster folder (poster view's flat peer of FolderRecord). */
export interface PosterFolderRecord {
  id: string;
  name: string;
  items: string[];
}

export interface PosterFoldersState {
  folders: PosterFolderRecord[];
}

/** get/set-poster-tags: posterKey -> tags. */
export interface PosterTagsState {
  tags: Record<string, string[]>;
}

// --- Tabs ---------------------------------------------------------------
export interface TabRecord {
  id: string;
  pinned: boolean;
  title: string | null;
  state: unknown;
}

/** get-tabs answers null when the library has never persisted a tab strip. */
export interface TabsState {
  tabs: TabRecord[];
  activeTabId: string | null;
}

// --- Backup mirror + integrity (ipc-backup.ts) --------------------------
/** The `lastResult` summary readBackupConfig hands back with the config. */
export interface BackupSummary {
  fileCount: number;
  written: number;
  pruned: number;
  reason: string;
  ok: boolean;
  error: string | null;
  at: string;
  pruneSkipped: string | null;
  baselineCount: number;
  lastGoodCount: number;
  orphanCount: number;
  missingCount: number;
}

/** get-backup / the `backup` member of a write result. */
export interface BackupConfig {
  dir: string | null;
  interval: boolean;
  intervalValue: number;
  intervalUnit: string;
  lastRunAt: string | null;
  lastResult: BackupSummary | null;
}

export interface BackupWriteResult {
  ok: boolean;
  error?: string;
  backup?: BackupConfig;
}

/** pick-backup-dir — a write result that can also report a cancelled dialog. */
export interface BackupDirPickResult extends BackupWriteResult {
  canceled?: boolean;
}

/**
 * run-backup's answer, and the payload of the pushed `backup-done` event
 * (#383: the renderer callback receives this and nothing else). A refused run
 * answers with `ok:false` + `error` only; a run that happened fills in the
 * counters.
 */
export interface BackupRunResult {
  ok: boolean;
  error?: string;
  reason?: string;
  fileCount?: number;
  written?: number;
  pruned?: number;
  pruneSkipped?: string | null;
  baselineCount?: number;
  lastGoodCount?: number;
  firstError?: string | null;
  orphanCount?: number;
  missingCount?: number;
  at?: string;
}

/**
 * get-integrity-status, and the payload of the pushed `integrity-check-done`
 * event (#383). `dbOk: null` = never checked.
 */
export interface IntegrityStatus {
  lastCheckAt: string | null;
  dbOk: boolean | null;
  orphanCount: number;
  missingCount: number;
}

/** run-orphan-recovery. `adopted` = recovered from the orphan's own sidecar. */
export interface OrphanRecoveryResult {
  ok: boolean;
  error?: string;
  recovered?: number;
  adopted?: number;
}

// --- Transfer: wipe / export / import / relocation (ipc-transfer.ts) ----
/** clear-all. `blocked` names the degraded-config reason a wipe was refused for. */
export interface ClearAllResult {
  ok: boolean;
  count: number;
  blocked?: string | null;
}

/** export-save (renderer-supplied bytes to a chosen path). */
export interface ExportSaveResult {
  saved: boolean;
  path?: string;
  error?: string;
}

/** export-complete. `empty:true` = nothing to export, so no dialog was shown. */
export interface ExportCompleteResult {
  saved: boolean;
  path?: string;
  fileCount?: number;
  empty?: boolean;
  error?: string;
}

/**
 * import-complete. `legacy:true` + `path` means the archive is a pre-#300
 * export: main picked the path, and the renderer finishes through
 * import-legacy-zip once it has asked the duplicate question (#34).
 */
export interface CompleteImportResult {
  ok: boolean;
  canceled?: boolean;
  legacy?: boolean;
  path?: string;
  error?: string;
  imported?: number;
  skipped?: number;
  notComplete?: boolean;
}

/**
 * import-legacy-zip. Called without a mode it may answer `needsChoice` with the
 * duplicate count instead of importing (#34); call again with the answer.
 */
export interface LegacyImportResult {
  ok: boolean;
  error?: string;
  imported: number;
  skipped: number;
  needsChoice?: boolean;
  duplicates?: number;
  total?: number;
}

/** import-images (the user's own local files). */
export interface MediaImportResult {
  imported: number;
  skipped: number;
  error?: string;
  canceled?: boolean;
}

/** move-save-folder — the relocation's own outcome. */
export interface SaveFolderMoveResult {
  ok: boolean;
  error?: string;
  name?: string;
  saveFolder?: string;
  moved?: number;
  leftover?: number;
}

/**
 * pick-save-folder: a relocation outcome, a cancelled dialog, or a destination
 * the user has to accept a warning for first (`confirm` + `dest`, #95).
 */
export interface SaveFolderPickResult extends SaveFolderMoveResult {
  canceled?: boolean;
  confirm?: string;
  provider?: string;
  dest?: string;
}

/** Pushed `save-folder-progress` events, one per relocation phase. */
export interface SaveFolderProgress {
  phase: string;
  done?: number;
  total?: number;
  percent?: number;
  moved?: number;
  leftover?: number;
  left?: number;
  error?: string;
}

/** Pushed `export-progress` events: counters while running, then `done:true`. */
export interface ExportProgress {
  written?: number;
  total?: number;
  pct?: number;
  done?: boolean;
}
