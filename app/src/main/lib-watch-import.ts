'use strict';

// Watch-folder intake (#84).  This is deliberately separate from the save-folder
// inbox watcher: it observes user-owned source folders, waits for writes to settle,
// then hands the completed file to the shared local-intake DB writer.
import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';

import { configDir } from './native-host.ts';
import { importLocalFile } from './lib-local-intake.ts';
import { ensureLibraryId } from './lib-db-write.ts';
import type { DbHandle, HologramConfig } from './ipc-context.ts';

// #236: names a watch folder must never pick up, even though collection is no
// longer limited to IMPORTABLE_MEDIA. OS/cloud-sync litter, not user files —
// picking one up would create a library record for a file the user never chose.
const EXCLUDED_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
// A download still being written (Chrome/Firefox/Edge conventions). chokidar's
// awaitWriteFinish (below) already waits for a file to stop growing before
// firing 'add' — this excludes the IN-PROGRESS name outright so a stale partial
// left behind by a cancelled download is never picked up by a directory scan either.
const PARTIAL_EXTS = new Set(['crdownload', 'part', 'tmp', 'download']);

export interface WatchImportFolder {
  path: string;
  enabled: boolean;
}
export interface WatchImportStatus {
  imported: number;
  at: string | null;
}
type Seen = Record<string, Record<string, { size: number; mtimeMs: number }>>;
// #176: watched folders are device-wide (below), but "already imported" is a
// per-LIBRARY fact — the same file dropped into a watch folder must be
// collectable again once you have switched to a different library, and must
// not be re-collected on switching BACK. Keyed by the current DB's own
// identity (lib-db-write.ts's ensureLibraryId) rather than by save-folder
// path, so a folder that was repointed onto the same library (its path
// changed, its identity did not) keeps its "already seen" history.
type SeenByLibrary = Record<string, Seen>;

const STATE_PATH = () => path.join(configDir(), 'watch-import-state.json');
const emptyStatus = (): WatchImportStatus => ({ imported: 0, at: null });

export function watchFoldersOf(value: unknown): WatchImportFolder[] {
  const entries = value && typeof value === 'object' && Array.isArray((value as any).folders) ? (value as any).folders : [];
  const out: WatchImportFolder[] = [];
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) continue;
    const folder = path.resolve(entry.path);
    const key = process.platform === 'win32' ? folder.toLowerCase() : folder;
    if (paths.has(key)) continue;
    paths.add(key);
    out.push({ path: folder, enabled: entry.enabled !== false });
  }
  return out;
}

export function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function readState(): SeenByLibrary {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeState(state: SeenByLibrary) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(STATE_PATH(), JSON.stringify(state, null, 2));
}
// #236: a watch folder collects any file now (not just IMPORTABLE_MEDIA — that
// list still decides assetClass, in buildLocalRecord via importLocalFile below).
// Dotfiles and the fixed OS/cloud-sync litter names above are excluded outright;
// 0-byte files are excluded in processFile (needs a stat, which this — called
// from a plain filename in the initial scan too — does not always have handy).
function supported(file: string) {
  const base = path.basename(file);
  if (base.startsWith('.')) return false;
  if (EXCLUDED_NAMES.has(base.toLowerCase())) return false;
  const ext = path.extname(file).slice(1).toLowerCase();
  if (PARTIAL_EXTS.has(ext)) return false;
  return true;
}

export interface WatchImportDeps {
  readConfig(): HologramConfig;
  writeConfig(config: HologramConfig): void;
  getSaveFolder(): string;
  isLibraryMissing(): boolean;
  ensurePostsSynced(): DbHandle | null;
  send(channel: string, ...args: unknown[]): void;
}

export function createWatchImportManager(deps: WatchImportDeps) {
  let watcher: FSWatcher | null = null;
  const state = readState();
  let queued = Promise.resolve();
  let status = emptyStatus();

  const folders = () => watchFoldersOf(deps.readConfig().watchImport);
  const seenFor = (libraryId: string, folder: string) => ((state[libraryId] ||= {})[folder] ||= {});
  const fingerprint = (st: fs.Stats) => ({ size: st.size, mtimeMs: st.mtimeMs });
  const same = (a: { size: number; mtimeMs: number } | undefined, b: { size: number; mtimeMs: number }) => !!a && a.size === b.size && a.mtimeMs === b.mtimeMs;

  async function processFile(folder: string, file: string): Promise<boolean> {
    if (!supported(file)) return false;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    if (stat.size === 0) return false; // #236: an empty file (still being created) is not a collectable item
    if (deps.isLibraryMissing()) return false;
    const handle = deps.ensurePostsSynced();
    if (!handle) return false;
    // #176: "already imported" is scoped to the CURRENT library — the DB has
    // to be open to know which one that is, so this check moved after
    // ensurePostsSynced (it used to run first, as a cheap skip before opening
    // the DB at all; libraryId is the price of the per-library ledger).
    const libraryId = ensureLibraryId(handle.sqlite);
    const key = path.basename(file);
    const current = fingerprint(stat);
    if (same(seenFor(libraryId, folder)[key], current)) return false;
    const ext = path.extname(file).slice(1).toLowerCase();
    await importLocalFile({
      folder: deps.getSaveFolder(),
      sqlite: handle.sqlite,
      srcPath: file,
      ext,
      source: 'watch',
      idPrefix: 'watch',
      title: path.basename(file, path.extname(file)) || null,
      date: stat.mtime.toISOString(),
    });
    seenFor(libraryId, folder)[key] = current;
    writeState(state);
    return true;
  }

  function enqueue(folder: string, file: string) {
    queued = queued
      .then(async () => {
        if (await processFile(folder, file)) {
          status = { imported: status.imported + 1, at: new Date().toISOString() };
          deps.send('posts-changed', null);
          deps.send('intake-imported', { source: 'watch', count: 1 });
        }
      })
      .catch(() => undefined);
    return queued;
  }

  async function scan(folder: string, markKnown = false) {
    let names: string[];
    try {
      names = await fs.promises.readdir(folder);
    } catch {
      return;
    }
    // markKnown ("mark these as already imported, don't import them") needs
    // the current library's id up front — the non-markKnown branch does not,
    // since enqueue → processFile resolves it per file itself.
    let libraryId: string | null = null;
    if (markKnown) {
      const handle = deps.ensurePostsSynced();
      if (!handle) return;
      libraryId = ensureLibraryId(handle.sqlite);
    }
    for (const name of names) {
      const file = path.join(folder, name);
      if (!supported(file)) continue;
      if (markKnown) {
        try {
          const st = await fs.promises.stat(file);
          if (st.isFile()) seenFor(libraryId as string, folder)[name] = fingerprint(st);
        } catch {
          /* file changed while scanning; the watcher will retry it */
        }
      } else {
        enqueue(folder, file);
      }
    }
    if (markKnown) writeState(state);
  }

  async function refresh() {
    await watcher?.close();
    watcher = null;
    const active = folders().filter((f) => f.enabled);
    for (const folder of active) await scan(folder.path);
    if (!active.length) return;
    watcher = chokidar.watch(
      active.map((f) => f.path),
      {
        awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 200 },
        depth: 0,
        ignoreInitial: true,
      },
    );
    watcher.on('add', (file) => {
      const folder = active.find((f) => path.dirname(file) === f.path);
      if (folder) enqueue(folder.path, file);
    });
    watcher.on('change', (file) => {
      const folder = active.find((f) => path.dirname(file) === f.path);
      if (folder) enqueue(folder.path, file);
    });
  }

  async function setFolders(value: unknown, markExisting: string[] = []) {
    const next = watchFoldersOf({ folders: value });
    const cfg = deps.readConfig();
    cfg.watchImport = { folders: next };
    deps.writeConfig(cfg);
    for (const folder of markExisting) await scan(path.resolve(folder), true);
    await refresh();
    return { folders: next, status };
  }

  return { folders, status: () => status, refresh, setFolders, scan };
}
