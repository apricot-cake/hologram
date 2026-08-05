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

/**
 * update-tags: the acknowledgement plus the record's tag arrays as the write
 * left them (#774). The renderer edits tags in place on the loaded record
 * rather than re-reading the library, and the id-keyed arrays cannot be derived
 * renderer-side from names alone — a new tag has no id yet, and two entities can
 * share a name. Handing them back is what keeps tags/tagIds/effective* parallel
 * after an edit, so the facet list and the tag leaves keep matching the entity
 * the user picked. Absent (write failed, or the DB is not open) means the caller
 * must DROP its stale copies, not keep them.
 */
export interface UpdateTagsResult extends OkResult {
  tags?: string[];
  tagIds?: number[];
  effectiveTagIds?: number[];
  effectiveTags?: string[];
  effectiveTagLabels?: string[];
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

/**
 * get-library-status (#37). `missing` is a fresh statSync of the CURRENT
 * explicit save folder, not a cached flag — the renderer re-asks this after a
 * retry or a repoint rather than listening for a push. `path` is null only
 * when there is no explicit save folder at all (fresh install), in which case
 * `missing` is always false — see native-host/config-recovery.cts's
 * libraryIsMissing.
 */
export interface LibraryStatus {
  missing: boolean;
  path: string | null;
}

/**
 * get-extension-contact (#71): whether the native-messaging bridge has EVER
 * touched its contact marker (native-host/paths.cts's extensionContactPath) —
 * i.e. the extension is installed and has processed at least one check/save.
 * The renderer's only use for this is empty/EmptyState.tsx's firstRun variant:
 * no contact yet means "show the install guide instead" (services/
 * library-status.ts's libraryEmptyVariant). A one-shot fetch like
 * get-library-status, not a push — nothing invalidates it mid-session, so a
 * boot-time read is all today's only caller needs.
 */
export interface ExtensionContactStatus {
  contacted: boolean;
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
  /** #618: the display axes are orthogonal — layout, then two independent grid switches. */
  layoutMode: string;
  squareThumbs: boolean;
  showInfo: boolean;
  /** #658: whether AuthorLine draws the author's avatar. */
  showAvatar: boolean;
  skipDeleteConfirm: boolean;
  /** Grid: column width px (the size slider's axis). */
  gridSize: number | null;
  /** List: thumbnail width px. */
  listThumb: number | null;
  theme: string;
  /** #137: user-chosen interface font, prepended to --font-sans. '' = default stack. */
  uiFontFamily: string;
  browseMode: string;
  /** #630: the poster grid's own axes — layout, then one switch (an avatar has no aspect to choose). */
  posterLayoutMode: string;
  posterShowInfo: boolean;
  /** Poster grid: column width px. The poster list has no size axis. */
  posterGridSize: number | null;
  sidebarOpen: boolean | null;
  sidebarWidth: number | null;
  inspectorOpen: boolean | null;
  inspectorWidth: number | null;
  /** #245: both panels above masked away at once. Independent of their own state. */
  panelsHidden: boolean | null;
  /** #88: one-key blur over every image surface (grid/list/inspector/viewer/lightbox). */
  privacyMode: boolean | null;
  /** #46: triage mode's manually-pinned number-key (1-9) quick tags, in slot order. */
  triagePinnedTags: string[];
  /** #207: web-search popover - which site rows "まとめて開く" targets (site ids), remembered across sessions. null = never set (defaults to every adopted site). */
  webSearchChecked: string[] | null;
  /** #207: home instance per fediverse platform - which host to open Misskey/Mastodon search on (search there is login-gated, so it must be a host the user can log into). null = never set. */
  fediverseHomeHosts: { misskey: string | null; mastodon: string | null } | null;
  /** #246: shortcut id -> custom key combo ("Ctrl+Shift+F" style string). Missing id = still on its default. */
  shortcutOverrides: Record<string, string>;
}

// --- Organization layer (DB-backed, ipc-organize.ts) ---------------------
/**
 * One kinded tag ENTITY (#810). `kind` hangs off the tags row, so two tags
 * sharing a name can legitimately carry different kinds — which is exactly what
 * the old `Record<name, kind>` shape could not express (it folded them, and the
 * whole-map write then erased the fold's loser from the DB).
 *
 * `name`/`label` are read-side decoration: they let the renderer list a kinded
 * tag no post carries (the picker's Work/Character sections) without a second
 * vocabulary fetch. `label` is #774's display-name rule — "name" normally,
 * "name(displayParentName)" when the tag has a display parent, which is the only
 * thing telling two same-named entities apart on sight. The write ignores both.
 */
export interface TagTypeRow {
  id: number;
  kind: string;
  name: string;
  label: string;
}

/** get/set-tag-types: the kinded tag entities, plus the renamable work/character labels. */
export interface TagTypesState {
  types: TagTypeRow[];
  labels: Record<string, string> | null;
}

/**
 * The name-keyed kind map — the `tag-types.json` interchange shape, NOT an IPC
 * payload. A tag id is library-local, so it means nothing inside an archive that
 * gets imported somewhere else; the ZIP therefore stays keyed by name and
 * lib-archive.ts reads/writes it through the by-name accessors on the DB writer.
 */
export interface TagTypeNamesState {
  types: Record<string, string>;
  labels: Record<string, string> | null;
}

/** get/set-ungrouped: post keys opted out of auto-grouping. */
// --- Tag vocabulary layer (#21, DB-backed, ipc-tag-vocab.ts) --------------
/** One row of the tag management page's overview table. */
export interface TagVocabRow {
  id: number;
  name: string;
  kind: string | null;
  reading: string | null;
  postCount: number;
  posterCount: number;
  parents: { id: number; name: string; isDisplay: boolean }[];
  displayName: string;
  isReferencedAsParent: boolean;
  isOrphan: boolean;
}
/** One (child, parent) edge, name-resolved — backs the "parent tags" left view. */
export interface TagParentRowResolved {
  tagId: number;
  tagName: string;
  parentTagId: number;
  parentName: string;
  isDisplay: boolean;
}
/** rename-tag's answer when the new name collides with a distinct tag entity — the caller resolves via merge-tags or keep-separate-rename-tag (2026-07-18 confirmed 2-way branch). */
export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
/** 'alias-collision' (#86): the attempted name is already registered as someone else's alias -- remove that alias first, or pick another name. */
export type RenameTagResult = { ok: true } | { ok: false; error: 'empty' | 'alias-collision' } | { ok: false; collision: RenameCollision };
/** A tag-vocab write's plain result (add/remove-tag-parent, merge-tags, keep-separate-rename-tag, set-tag-kind). */
export interface TagWriteResult {
  ok: boolean;
  error?: string;
}
export interface DeleteOrphanTagsResult {
  ok: boolean;
  deletedIds: number[];
}
/** One post in the split-review thumbnail grid (get-tag-split-preview) — #777. */
export interface TagSplitPost {
  postId: string;
  thumbFile: string | null;
  /** Co-occurs with the candidate display parent — seeds the "moves to the new entity" selection. */
  suggestedToNew: boolean;
}
/** split-tag's answer — the new entity's id on success. */
export type SplitTagResult = { ok: true; newTagId: number } | { ok: false; error: string };
/** One row of the tag management page's alias list (#86) — an alternate spelling that resolves to a canonical tag. */
export interface TagAliasRow {
  id: number;
  alias: string;
  tagId: number;
  canonicalName: string;
}
/** add-tag-alias's answer. 'self' = the alias text is the tag's own current name (redundant). 'name-collision' = a distinct tag already has that exact name (use merge-tags instead). 'conflict' = the alias text is already registered pointing at a different tag. */
export type AddTagAliasResult = { ok: true; id: number } | { ok: false; error: 'empty' | 'not-found' | 'self' | 'name-collision' | 'conflict' };

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

/**
 * One poster's tags (#810), in the same PARALLEL-ARRAY shape a post record
 * already carries (same index = same tag): names for what the editor shows and
 * writes back, ids for matching (a rename doesn't change the id, and one name
 * can belong to two entities).
 *
 * The effective* trio is #774's query-time application of tag parent
 * relationships, derived on every read and stored in no table — so deleting a
 * rule removes its effect from every poster at the next read, the same
 * reversibility posts have.
 */
export interface PosterTagRow {
  tags: string[];
  tagIds: number[];
  effectiveTagIds: number[];
  effectiveTags: string[];
  effectiveTagLabels: string[];
}

/** get-poster-tags: posterKey -> that poster's tag entities. */
export interface PosterTagsState {
  tags: Record<string, PosterTagRow>;
}

/**
 * set-poster-tags, and the `poster-tags.json` interchange shape: posterKey ->
 * tag NAMES. The write stays by name for the same reason post tags do — a tag
 * typed just now has no id until the write creates it — and the archive stays by
 * name for the same reason tag-types.json does (ids are library-local).
 */
export interface PosterTagNamesState {
  tags: Record<string, string[]>;
}

// --- Poster aliases (#23 St1) --------------------------------------------
/** One name-merge group. `primary` is the canonical key every reader folds
 *  onto (facets/predicates/buildUsers); `members` includes `primary` itself. */
export interface PosterAliasGroupRecord {
  id: string;
  primary: string;
  members: string[];
}

/** get/set-poster-aliases. */
export interface PosterAliasesState {
  groups: PosterAliasGroupRecord[];
}

// --- Tabs ---------------------------------------------------------------
/**
 * One persisted tab. Exactly these four fields cross the boundary: three the DB
 * indexes as columns, plus `state` — one opaque blob main stores verbatim and
 * never reads into. The renderer owns the blob's shape (services/tab-state.ts's
 * HologramTabPersist: the query snapshot, the nav stack, the scroll position),
 * so it can grow a field without a schema change; anything sent NEXT to `state`
 * is dropped on the way to the DB (#565).
 */
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

// --- Global history (#145, ipc-history.ts) --------------------------------
/** One row of the history table. `state` is the #144 nav entry's kind-specific restore state, verbatim. */
export interface HistoryRow {
  id: number;
  ts: number;
  u: string;
  kind: string;
  title: string;
  state: unknown;
}

/** query-history's cursor for the next page — the last row's (ts, id) keyset pair. */
export interface HistoryCursor {
  ts: number;
  id: number;
}

export interface HistoryQueryOptions {
  search?: string;
  before?: HistoryCursor | null;
}

export interface HistoryQueryResult {
  rows: HistoryRow[];
  hasMore: boolean;
}

// --- AI features opt-in (ipc-ai.ts, #830 / parent #98) -------------------
/** get-ai-config / the return of set-ai-config. Machine-local, off by default. */
export interface AiConfig {
  enabled: boolean;
}

// --- Index queue (ipc-index-queue.ts, #834 / parent #98) -----------------
/**
 * What the toolbar's progress indicator draws, pushed on 'index-queue-progress'
 * and fetchable once via 'get-index-queue-status'.
 *
 * `total` GROWS while `scanning` is true — the library walk decides what needs
 * work as it goes, so this is a progress bar whose end moves. The indicator says
 * so by showing an indeterminate bar until the scan is done, rather than
 * pretending to a percentage that would go backwards.
 */
export interface IndexQueueStatus {
  /** There is work: something queued, running, or still being scanned for. */
  active: boolean;
  paused: boolean;
  scanning: boolean;
  done: number;
  total: number;
  /** The job kind id being worked on, for the label. */
  currentKind: string | null;
}

// --- Model manager (ipc-model.ts, #832 / parent #98) ---------------------
/** get-model-list entry: one code-registry model, joined with its on-disk status. */
export interface ModelInfo {
  id: string;
  rev: string;
  state: 'absent' | 'partial' | 'complete';
  bytesDone: number;
  bytesTotal: number;
  /** Shown next to the model in Settings' AI Features section. */
  licenseNote: string;
  /** A different rev of this model is on disk — informational only, #832 never auto-fetches it. */
  installedRev: string | null;
}

/** Pushed `model-download-progress` events while download-model runs; `file` is null on the final event. */
export interface ModelDownloadProgress extends ModelInfo {
  file: string | null;
}

// --- Backup + integrity (ipc-backup.ts) ---------------------------------
/** The `lastResult` summary readBackupConfig hands back with the config. */
export interface BackupSummary {
  fileCount: number;
  written: number;
  /** Entries relocated at the destination — a post moving in or out of the trash (#233). */
  moved: number;
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
  /** 'local-folder' | 'google-drive' | 'onedrive' (#909). */
  kind: string;
  /** The picked folder, for the local kind only. */
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
  moved?: number;
  pruned?: number;
  pruneSkipped?: string | null;
  baselineCount?: number;
  lastGoodCount?: number;
  firstError?: string | null;
  orphanCount?: number;
  missingCount?: number;
  at?: string;
}

/** One entry of the DB generation store, as the restore list shows it (#233). */
export interface DbGeneration {
  name: string;
  /** ISO instant decoded from the file name (the store names in local time). */
  at: string;
  size: number;
  /** False when this restore point exists on this PC only. */
  atDestination: boolean;
}

/**
 * rollback-db-generation's answer. `stash` names the automatic snapshot of the
 * state that was left behind, and `reregistered` counts the posts carried
 * forward because the generation predates them (#233).
 */
export interface DbRollbackResult {
  ok: boolean;
  error?: string;
  generation?: string;
  stash?: string;
  reregistered?: number;
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

/** A file resolved by the window-drop door's recursive walk (#234) —
 * collect-dropped-paths' list, sent back unchanged to import-dropped-paths so
 * the import never re-walks. */
export interface DroppedFile {
  path: string;
  ext: string;
}

/** collect-dropped-paths — the pre-count; nothing is written yet. */
export interface DropCollectResult {
  files: DroppedFile[];
  mediaCount: number;
  otherCount: number;
  error?: string;
}

/** import-dropped-paths — the confirmed write. Same shape as MediaImportResult
 * minus `canceled` (there is no dialog here to cancel). */
export interface DropImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

/** #84: directories watched for non-destructive local-media intake. */
export interface WatchImportFolder {
  path: string;
  enabled: boolean;
}
export interface WatchImportConfig {
  folders: WatchImportFolder[];
  status: { imported: number; at: string | null };
}

/**
 * import-clipboard (#85). `empty:true` = the clipboard held no image, which is a
 * normal outcome (the user pressed Ctrl+V with text on the clipboard) and is
 * deliberately NOT reported as `error` — the renderer answers it with a plain
 * toast rather than a failure.
 */
export interface ClipboardImportResult {
  imported: number;
  empty?: boolean;
  error?: string;
}

/**
 * pick-repoint-folder (#37): resolves + validates a destination for repoint
 * WITHOUT writing anything — apply-repoint does the actual write, mirroring
 * pick-save-folder/move-save-folder's two-step shape. `hasEvidence` says
 * whether the folder looks like an existing Hologram library (a .trash or
 * .hologram-inbox subfolder, or a library media file directly inside it); the
 * renderer confirms with the user before repointing at a folder with none.
 */
export interface RepointPickResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  dest?: string;
  hasEvidence?: boolean;
}

/**
 * apply-repoint (#37, generalized by #176's switchLibrary): opens `dest` as the
 * current library — a copy-free pointer flip when the database was outside the
 * save folder is no longer the whole story once the database is INSIDE it
 * (#176), so this now closes the old database and opens (or creates, or
 * restores from a snapshot) one at `dest`. `error: 'busy'` means a switch was
 * already in flight; `'open-failed'` means the new location's database itself
 * would not open (rolled back to the previous library automatically).
 */
export interface RepointApplyResult {
  ok: boolean;
  error?: string;
  saveFolder?: string;
}

/**
 * pick-library-folder (#176): resolves + validates a destination for the
 * Settings "ライブラリ" section's 切り替え/新規作成 flow, WITHOUT opening
 * anything — switch-library performs the actual switch once the renderer has
 * shown whichever confirm `classification` calls for (none for 'has-db', "start
 * a new library?" for 'empty', "recover from the mirror/inbox?" for
 * 'evidence-no-db'). A folder that classifies as 'reject' is refused here
 * outright (`ok:false, error:'not-a-library'`) — never surfaced as a confirm.
 */
export interface PickLibraryFolderResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  dest?: string;
  classification?: 'has-db' | 'empty' | 'evidence-no-db';
}

/** switch-library (#176): the outcome of an already-confirmed switchLibrary(dest) call. */
export interface SwitchLibraryResult {
  ok: boolean;
  error?: string;
  saveFolder?: string;
}

/** get-recent-libraries (#176) — newest first; `exists` is a live statSync, not cached. */
export interface RecentLibraryEntry {
  path: string;
  lastOpenedAt: string | null;
  exists: boolean;
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

/**
 * search-full-text (#29): one posts_fts MATCH row. `postId` is actually the
 * post's captureId (the FTS table's UNINDEXED column is named postId — see
 * lib-db-schema.ts), `rank` is SQLite's bm25() score (more negative = more
 * relevant, so callers sort it ascending). The renderer decides WHICH posts
 * match (services/fulltext.ts runs the same in-tab matcher the quick search
 * uses, over every field including ones posts_fts does not index yet — #288's
 * ALT-column homework); this channel supplies relevance ORDER only, for
 * whichever of those hits it also covers.
 */
export interface FullTextHit {
  postId: string;
  rank: number;
}

/**
 * One tile in a pin (floating mini-viewer) window's set (#79). `captureId` is
 * best-effort identity (the owning post's, or the source tab's when a single
 * exact record can't be named — e.g. the toolbar's "pin what's on screen"
 * entry point) used only to highlight an already-pinned tile on a duplicate
 * add; the tile itself is keyed by `file`, which is unique in the library.
 * Window-local state only — nothing here is ever written back to a post record.
 */
export interface PinItem {
  captureId: string;
  file: string;
  video: boolean;
}
