'use strict';

// ⚠️ Scaffolding — remove before release (#441 tracks the removal).
//
// One-time migration of a pre-#5 library: reads a save folder's per-post sidecar
// JSON plus the organization-layer JSON (tag-types / ungrouped / folders /
// manual-groups / poster-folders / poster-tags / tabs) and writes it all into the
// SQLite database. Runs exactly once per database — index.ts's
// ensureDbTruthSource() calls it before stamping store_state.truthSource='db',
// and never again afterwards.
//
// Nothing in the app writes these files any more (#298/St5 moved in-app writes to
// the DB, #299/St6 moved native-host saves to the intake queue, #300/St7 made the
// export regenerate sidecar-format JSON from the DB), so this module is the last
// reader of the old on-disk format. It exists only so an existing library isn't
// stranded; a release-time install has nothing for it to find. Keep the whole
// migration in this one file so removing it is one `git rm` plus the call site.
//
// Deliberately NOT incremental: it runs against a folder nothing is writing, once,
// so the old filename+mtimeMs diff engine (`.index.json`, retired with #302) has
// no job here — a plain readdir is both simpler and the honest shape of a
// one-shot import.
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in plain node.

import nodeFs from 'node:fs';
import path from 'node:path';
import { fillCardDims } from './lib-card-dims.ts';
import { normFolders } from './lib-folder-tree.ts';
import { parseJsonLoose } from './lib-json.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { createDbWriter } from './lib-db-write.ts';
import type Database from 'better-sqlite3';

// The save-folder filenames that are app metadata rather than posts. Only this
// migration still cares: since #302 nothing else in the app reads or writes any
// of them, and a release-time library has none.
const LEGACY_INTERNAL_FILES = new Set(['config.json', '.index.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json', 'folders.json', 'tabs.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json']);

interface DbHandle {
  sqlite: Database.Database;
}

export interface LegacyImportReport {
  sidecarCount: number; // sidecar .json files recognized as post records
  parseFailures: Array<{ file: string; error: string }>; // JSON that failed to parse, or parsed but wasn't a post record
  postsWritten: number; // post rows inserted/updated
  dbPostCount: number; // SELECT COUNT(*) FROM posts afterwards — the reconciliation number against sidecarCount
}

// Something to show (an image, a poster-less video, downloaded media) OR a post
// identity with no media at all — a text-only post (#365). The identity clause is
// what keeps this a POST filter rather than "any JSON": a sidecar carries the
// permalink it was saved from and the id it was saved under, and the app's own
// files (config.json, folders.json, …) carry neither.
function isPostRecord(rec: any): boolean {
  if (!rec) return false;
  if (rec.image || rec.video || (Array.isArray(rec.media) && rec.media.length)) return true;
  return !!(rec.url && rec.captureId);
}

// Reads an org-layer JSON file. Returns null (never throws) — a missing file
// means "nothing set yet"; a present-but-corrupt file is reported as a parse
// failure so the caller can surface it, same treatment as a corrupt sidecar.
function readJsonFile(folder: string, name: string, failures: Array<{ file: string; error: string }>): any {
  const full = path.join(folder, name);
  let raw: string;
  try {
    raw = nodeFs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
  try {
    return parseJsonLoose(raw);
  } catch (err: any) {
    failures.push({ file: name, error: err.message });
    return null;
  }
}

// Derives the organization-layer tables (tags' kind, ungrouped_keys,
// folders/folder_items, manual_groups/items, poster_folders/items, poster_tags,
// tabs/tab_windows) from their JSON files. Wipe-then-insert for every table
// EXCEPT tags (get-or-create, see makeTagResolver) — the database is empty of
// organization data when this runs, so there is nothing to merge with.
//
// validPostIds scopes out stale references (a captureId an org file still lists
// after its sidecar was deleted) — posts.captureId is a foreign key target from
// folder_items/manual_group_items, so an unfiltered insert would throw with
// foreign_keys=ON.
function importOrgLayer(folder: string, sqlite: Database.Database, resolveTagId: (name: string) => number, validPostIds: Set<string>, failures: Array<{ file: string; error: string }>) {
  // tag-types.json: { types: { "<tagName>": "<kind>" }, labels? }. A tag named
  // here gets (or keeps) a tags row even if no post/poster currently uses it —
  // the "vocabulary book" is about the tag, not any one usage of it.
  const tagTypes = readJsonFile(folder, 'tag-types.json', failures);
  if (tagTypes && tagTypes.types && typeof tagTypes.types === 'object') {
    const setKind = sqlite.prepare('UPDATE tags SET kind = ? WHERE id = ?');
    for (const [name, kind] of Object.entries(tagTypes.types)) {
      if (typeof name !== 'string' || !name) continue;
      setKind.run(typeof kind === 'string' ? kind : null, resolveTagId(name));
    }
  }

  // ungrouped.json: { keys: string[] } — postKey (url-derived), not captureId;
  // deliberately not FK'd to posts (module comment on ungrouped_keys' DDL).
  const ungrouped = readJsonFile(folder, 'ungrouped.json', failures);
  sqlite.prepare('DELETE FROM ungrouped_keys').run();
  if (ungrouped && Array.isArray(ungrouped.keys)) {
    const ins = sqlite.prepare('INSERT OR IGNORE INTO ungrouped_keys (postKey) VALUES (?)');
    for (const k of ungrouped.keys) if (typeof k === 'string' && k) ins.run(k);
  }

  // folders.json: { folders: [{id,name,kind,created,parentId,items,tree?}] }
  const foldersJson = readJsonFile(folder, 'folders.json', failures);
  sqlite.prepare('DELETE FROM folder_items').run();
  sqlite.prepare('DELETE FROM folders').run();
  if (foldersJson) {
    const folders = normFolders(foldersJson.folders);
    const insFolder = sqlite.prepare('INSERT INTO folders (id, name, kind, created, tree) VALUES (?,?,?,?,?)');
    const setParent = sqlite.prepare('UPDATE folders SET parentId = ? WHERE id = ?');
    const insItem = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) VALUES (?,?)');
    for (const f of folders) {
      const tree = f.kind === 'dynamic' && f.tree && typeof f.tree === 'object' ? JSON.stringify(f.tree) : null;
      insFolder.run(f.id, f.name, f.kind, f.created, tree);
      for (const postId of f.items) if (validPostIds.has(postId)) insItem.run(f.id, postId);
    }
    // A flat folder list can put a child before its parent. Create every row
    // first, then apply the repaired edges so the self-FK never depends on order.
    for (const f of folders) if (f.parentId) setParent.run(f.parentId, f.id);
  }

  // manual-groups.json: { groups: [[captureId,...],...] } — same length>1
  // filter set-manual-groups applies (a 1-item "group" is not a grouping).
  const manualGroups = readJsonFile(folder, 'manual-groups.json', failures);
  sqlite.prepare('DELETE FROM manual_group_items').run();
  sqlite.prepare('DELETE FROM manual_groups').run();
  if (manualGroups && Array.isArray(manualGroups.groups)) {
    const insGroup = sqlite.prepare('INSERT INTO manual_groups DEFAULT VALUES');
    const insItem = sqlite.prepare('INSERT INTO manual_group_items (groupId, postId, seq) VALUES (?,?,?)');
    for (const g of manualGroups.groups) {
      if (!Array.isArray(g) || g.length < 2) continue;
      const members = g.filter((id) => typeof id === 'string' && validPostIds.has(id));
      if (members.length < 2) continue;
      const groupId = Number(insGroup.run().lastInsertRowid);
      members.forEach((postId, seq) => insItem.run(groupId, postId, seq));
    }
  }

  // poster-folders.json: { folders: [{id,name,items:[posterKey]}] }
  const posterFolders = readJsonFile(folder, 'poster-folders.json', failures);
  sqlite.prepare('DELETE FROM poster_folder_items').run();
  sqlite.prepare('DELETE FROM poster_folders').run();
  if (posterFolders && Array.isArray(posterFolders.folders)) {
    const insFolder = sqlite.prepare('INSERT INTO poster_folders (id, name) VALUES (?,?)');
    const insItem = sqlite.prepare('INSERT OR IGNORE INTO poster_folder_items (folderId, posterKey) VALUES (?,?)');
    for (const f of posterFolders.folders) {
      if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') continue;
      insFolder.run(f.id, f.name);
      if (Array.isArray(f.items)) {
        for (const posterKey of f.items) if (typeof posterKey === 'string' && posterKey) insItem.run(f.id, posterKey);
      }
    }
  }

  // poster-tags.json: { tags: { "<posterKey>": ["tag",...] } }
  const posterTags = readJsonFile(folder, 'poster-tags.json', failures);
  sqlite.prepare('DELETE FROM poster_tags').run();
  if (posterTags && posterTags.tags && typeof posterTags.tags === 'object') {
    const ins = sqlite.prepare('INSERT OR IGNORE INTO poster_tags (posterKey, tagId) VALUES (?,?)');
    for (const [posterKey, tags] of Object.entries(posterTags.tags)) {
      if (typeof posterKey !== 'string' || !posterKey || !Array.isArray(tags)) continue;
      for (const name of tags) if (typeof name === 'string' && name) ins.run(posterKey, resolveTagId(name));
    }
  }

  // tabs.json: { activeTabId, tabs: [{id,pinned,title,state,...}] }. Single
  // window today (windowId is a sentinel — schema comment, #32 stage 3 readies
  // the column for more). state is stored opaque (replayed whole, not queried
  // by column — same schema comment); no nav/query-tree validation here, that
  // belongs to the renderer's own sanitizeSavedTabs at RESTORE time.
  const tabsJson = readJsonFile(folder, 'tabs.json', failures);
  // Children before parent: tab_windows.activeTabId references tabs(id) with no
  // ON DELETE CASCADE (schema comment — a window losing its active tab is a
  // read-path fallback concern, not a delete-time cleanup), so deleting tabs
  // first while a tab_windows row still points at one throws FOREIGN KEY
  // constraint failed under foreign_keys=ON.
  sqlite.prepare('DELETE FROM tab_windows').run();
  sqlite.prepare('DELETE FROM tabs').run();
  if (tabsJson && Array.isArray(tabsJson.tabs)) {
    const insTab = sqlite.prepare('INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES (?,?,?,?,?,?)');
    const ids = new Set<string>();
    tabsJson.tabs.forEach((t: any, position: number) => {
      if (!t || typeof t.id !== 'string') return;
      ids.add(t.id);
      insTab.run(t.id, 'main', position, t.pinned ? 1 : 0, typeof t.title === 'string' ? t.title : null, JSON.stringify(t.state ?? null));
    });
    const activeTabId = typeof tabsJson.activeTabId === 'string' && ids.has(tabsJson.activeTabId) ? tabsJson.activeTabId : null;
    sqlite.prepare('INSERT INTO tab_windows (windowId, activeTabId) VALUES (?,?)').run('main', activeTabId);
  }
}

// Reads every sidecar in `folder` and returns the ones that are post records.
// Failures (unparseable, or valid JSON that isn't a post) are collected rather
// than thrown: one bad file must not strand the rest of a library.
function readSidecars(folder: string, failures: Array<{ file: string; error: string }>): any[] {
  let names: string[];
  try {
    names = nodeFs.readdirSync(folder);
  } catch {
    return [];
  }
  const posts: any[] = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json') || LEGACY_INTERNAL_FILES.has(name)) continue;
    let rec: any;
    try {
      rec = parseJsonLoose(nodeFs.readFileSync(path.join(folder, name), 'utf8'));
    } catch (err: any) {
      failures.push({ file: name, error: err.message });
      continue;
    }
    if (isPostRecord(rec)) posts.push(rec);
    else failures.push({ file: name, error: 'not a post record (no media, and no url+captureId)' });
  }
  // Newest capture first, matching postsFromDb's ordering — irrelevant to the
  // write itself, kept so a report's first entries are the recognizable ones.
  posts.sort((a, b) => new Date(b.capturedAt || 0).getTime() - new Date(a.capturedAt || 0).getTime());
  return posts;
}

// The whole migration, in one transaction: a mid-run failure leaves the database
// untouched and the caller's truthSource stamp unwritten, so the next launch
// retries from scratch.
function importLegacyLibrary(folder: string, handle: DbHandle): LegacyImportReport {
  const { sqlite } = handle;
  const failures: Array<{ file: string; error: string }> = [];
  const posts = readSidecars(folder, failures);
  const validIds = new Set(posts.map((p) => p.captureId));
  const stmts = preparePostStmts(sqlite);

  sqlite.exec('BEGIN');
  try {
    const resolveTagId = makeTagResolver(sqlite);
    for (const rec of posts) writePost(stmts, resolveTagId, fillCardDims(folder, rec));
    importOrgLayer(folder, sqlite, resolveTagId, validIds, failures);
    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
  const dbPostCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n;
  return { sidecarCount: posts.length, parseFailures: failures, postsWritten: posts.length, dbPostCount };
}

// Copies the legacy metadata aside before the database is marked authoritative.
// The media files stay in the library; this is specifically the JSON the app will
// stop reading. Lands next to the DB (configDir), never inside the library, so it
// cannot be mistaken for a new post. Returns the destination for logging.
function backupLegacyMetadata(folder: string, backupRoot: string, trashSubdir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(backupRoot, stamp);
  nodeFs.mkdirSync(destination, { recursive: true });
  for (const name of nodeFs.readdirSync(folder)) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    nodeFs.copyFileSync(path.join(folder, name), path.join(destination, name));
  }
  try {
    const trashDestination = path.join(destination, trashSubdir);
    nodeFs.mkdirSync(trashDestination, { recursive: true });
    for (const name of nodeFs.readdirSync(path.join(folder, trashSubdir))) {
      if (name.toLowerCase().endsWith('.json')) nodeFs.copyFileSync(path.join(folder, trashSubdir, name), path.join(trashDestination, name));
    }
  } catch {
    // A library without a trash directory is the ordinary case.
  }
  return destination;
}

// userKind/tagReviewed (the tagging wizard's plain/media + reviewed flags) were
// sidecar-only fields written by the old update-tags handler — never part of
// PostRecordShape (native-host/post-record.mts excludes them on purpose), so
// writePost has never carried them. This is the only chance to pull an existing
// library's review state in. Runs after the posts import so every captureId
// already has a row to update.
function backfillPostFlags(folder: string, sqlite: Database.Database): void {
  let names: string[];
  try {
    names = nodeFs.readdirSync(folder);
  } catch {
    return;
  }
  const writer = createDbWriter(sqlite);
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.json') || LEGACY_INTERNAL_FILES.has(name)) continue;
    let rec: any;
    try {
      rec = parseJsonLoose(nodeFs.readFileSync(path.join(folder, name), 'utf8'));
    } catch {
      continue;
    }
    if (rec) writer.restorePostFlags(name.slice(0, -5), rec);
  }
}

// The whole scaffolding, behind one call: preserve the old JSON, import it, then
// pull in the two sidecar-only flags. The caller stamps truthSource='db' only
// after this returns, so a throw here means the next launch retries.
function migrateLegacyLibrary(opts: { folder: string; sqlite: Database.Database; backupRoot: string; trashSubdir: string }): LegacyImportReport & { backupPath: string } {
  const backupPath = backupLegacyMetadata(opts.folder, opts.backupRoot, opts.trashSubdir);
  const report = importLegacyLibrary(opts.folder, { sqlite: opts.sqlite });
  backfillPostFlags(opts.folder, opts.sqlite);
  return { ...report, backupPath };
}

export { LEGACY_INTERNAL_FILES, backfillPostFlags, backupLegacyMetadata, importLegacyLibrary, importOrgLayer, isPostRecord, migrateLegacyLibrary, readSidecars };
