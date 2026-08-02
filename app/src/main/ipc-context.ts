'use strict';

// The `ctx` contract between index.ts and the seven ipc-*.ts handler modules
// (#228). index.ts builds one object exposing the core helpers and mutable state
// the extracted handlers close over (see registerExtractedIpc); every module's
// `register(ctx: IpcContext)` destructures the members it needs.
//
// Why it is a hand-written interface rather than `typeof ctx` from index.ts:
// index.ts imports the handler modules, so deriving the type from the assembly
// would make the modules import their own importer. Stating it here instead
// checks BOTH directions — index.ts annotates its literal `const ctx:
// IpcContext`, so a helper that changes name or return shape fails to build,
// and a handler that reaches for something ctx does not carry fails too. That
// was the hole: `register(ctx)` with no annotation typed all ~40 members as
// `any`, on the boundary that carries clear-all / import-complete /
// move-save-folder.
//
// Main-process only — it names BrowserWindow and the SQLite writer. The half the
// renderer needs (what each channel's payload looks like) is ./ipc-payloads.ts,
// which imports nothing so it can be reached from the renderer's DOM-only
// program.
import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import type { createDbWriter } from './lib-db-write.ts';
import type { relocateLibrary } from './lib-migrate.ts';
import type { BackupConfig, BackupRunResult, FullTextHit, IntegrityStatus, LibraryStatus, OrphanRecoveryResult, PostsDelta, PostsSnapshot, ValidationResult, WatchImportConfig, WatchImportFolder } from './ipc-payloads.ts';

/** The organization-state writer every DB-backed handler goes through. */
export type DbWriter = ReturnType<typeof createDbWriter>;

/**
 * An open database. `db` is the Kysely builder, `sqlite` the raw handle the
 * handlers use (same reason as lib-db-query.ts: no typed helper for bm25(), and
 * a second query style would just be inconsistency).
 */
export interface DbHandle {
  db: any;
  sqlite: Database.Database;
}

/**
 * config.json as read from disk. Only the two fields a handler dereferences by
 * name are declared; the rest stay open because the file is plain JSON a user
 * can edit and every reader already guards the value it takes out (the pref
 * allow-list in ipc-config.ts is the real gate).
 */
export interface HologramConfig {
  saveFolder?: string;
  extensionId?: string;
  [key: string]: any;
}

export interface IpcContext {
  // --- Library location + records ---
  /** Never null: a fresh install resolves to the default library dir. */
  getSaveFolder(): string;
  /** The library's .trash/, or null when there is no save folder. */
  getTrashDir(): string | null;
  /** The redundant save-folder pointer written beside config.json. */
  readSavePointer(): string | null;
  /** #37: is the CURRENT explicit save folder missing on disk right now? Fresh statSync, never cached. */
  isLibraryMissing(): boolean;
  /** #37: isLibraryMissing() plus the path — what get-library-status hands the renderer. */
  getLibraryStatus(): LibraryStatus;
  /** Resolves a name INSIDE the save folder, or null if it would escape it. */
  resolveInFolder(name: string): string | null;
  mimeForFile(name: string): string;
  /** The captureId a library filename belongs to. */
  baseOf(name: string | null | undefined): string;
  /** Every extension a downloaded library file can carry. */
  LIBRARY_MEDIA_EXTS: readonly string[];
  APP_ICON: string;

  // --- Database ---
  getDbWriter(): DbWriter;
  /** Opens the DB and drains the intake queue. */
  ensurePostsSynced(): DbHandle | null;
  scheduleSavedIndexWrite(handle: { sqlite: Database.Database }): void;
  /** Consumes pending `replaces` markers (#34) — no inbox event fires for an in-app write. */
  sweepReplacements(): Promise<void>;
  listPosts(): Promise<PostsSnapshot>;
  listPostsDelta(haveBaseline: boolean): Promise<PostsDelta>;
  /** #29: cross-tab full-text search — bm25() rank per posts_fts MATCH hit. */
  searchFullText(query: string, limit?: number): Promise<FullTextHit[]>;

  // --- Config ---
  readConfig(): HologramConfig;
  writeConfig(cfg: HologramConfig): void;
  /**
   * Drops the config cache (#61). Only needed by a handler that lets something
   * else write config.json — the installer persisting extensionId.
   */
  invalidateConfigCache(): void;
  /** True iff config.json is present but unparseable, as of right now. */
  isConfigCorrupt(): boolean;
  /** Why a wipe must be refused on a degraded config, or null. */
  clearAllBlockReason(args: { configCorrupt: boolean; hasExplicitSaveFolder: boolean; hasPointer: boolean; libraryMissing: boolean }): string | null;

  // --- Backup mirror + integrity ---
  readBackupConfig(): BackupConfig;
  writeBackupConfig(patch: Partial<BackupConfig> | null | undefined): BackupConfig;
  validateBackupDir(dir: string | null | undefined): ValidationResult;
  armBackupSchedule(): void;
  runBackup(reason: string): Promise<BackupRunResult>;
  readIntegrityStatus(): IntegrityStatus;
  runOrphanRecovery(): Promise<OrphanRecoveryResult>;

  // --- Relocation + intake ---
  validateSaveFolder(dir: string | null | undefined): ValidationResult;
  relocateLibrary: typeof relocateLibrary;
  /** (Re-)points the inbox watcher at the current save folder. */
  watchInboxFolder(): void;
  /** #84: refreshes chokidar after a config change or at startup. */
  watchImportFolders(): Promise<void>;
  getWatchImportConfig(): WatchImportConfig;
  setWatchImportFolders(folders: WatchImportFolder[], markExisting?: string[]): Promise<WatchImportConfig>;
  /** Drops the delta baseline so the renderer full-resyncs. */
  resetDelta(): void;

  // --- Media fetch (native-host layer) ---
  pixivRefererFor(url: unknown): string | undefined;
  downloadAvatar(avatar: unknown, referer: unknown, dir: string): Promise<string | null>;

  // --- Window ---
  /**
   * The main window. Null once it is gone — Electron types a dialog's parent as
   * non-null, so the handlers that parent one narrow at the call site.
   */
  getWin(): BrowserWindow | null;
  /** Pushes to the main window's renderer; a no-op when the window is gone. */
  send(channel: string, ...args: unknown[]): void;
}
