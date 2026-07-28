'use strict';

// Sidecar -> DB sync importer (#5 St3 / #296): reads the save folder's sidecar
// JSON (posts) + organization-layer JSON (tag-types / ungrouped / folders /
// manual-groups / poster-folders / poster-tags) + tabs.json, and writes them
// into the SQLite database opened by lib-db.ts (schema from #295 St2).
//
// The DB at this stage is a DERIVED index (#5 2026-07-22 stage-split comment,
// "expand" phase of parallel-change): sidecars remain the truth. A failed or
// stale import never loses data — importAll() re-derives the whole DB from
// whatever is on disk right now, so the worst case is a re-run.
//
// Reuses lib-index.ts's filename+mtimeMs diff engine for the incremental path
// (#296 issue body: "lib-index の filename+mtimeMs 差分機構を流用") — both the
// full and incremental entry points share ONE createPostIndex() instance (same
// role, same .index.json snapshot the renderer's own postIndex in index.ts
// reads/writes: "what does sidecar X currently look like", not a DB-specific
// concern, so there is nothing DB-specific to keep separate).
//
// Idempotency (posts table): every write is either an upsert keyed on the
// sidecar's own captureId, or a delete-then-reinsert of that post's dependent
// rows (media / post_tags / posts_fts) — never an append. A full import also
// deletes any posts row whose captureId is no longer present on disk (FK
// CASCADE takes its dependents with it). Re-running against unchanged sidecars
// therefore lands the exact same rows both times.
//
// Idempotency (tags): tags are get-or-create BY NAME, never wiped. Deleting and
// reinserting a tag would mint a new AUTOINCREMENT id and cascade away any
// tag_parents/tag_aliases rows curated against the old one (#86/#157 territory,
// not populated by this importer) — so once a name has a row, that row's id is
// permanent as far as this importer is concerned. This importer resolves tag
// NAMES only; it cannot express "two tags share a name but are different
// entities" (#5 2026-07-18 comment's #21 problem) because sidecars carry plain
// name strings with no parent/entity info to disambiguate — that curation
// happens later, directly against the DB, once something wires up write access.
//
// Electron-free (better-sqlite3 + node builtins only) so it unit-tests in plain
// node, mirroring lib-db.ts / lib-index.ts.

import nodeFs from 'node:fs';
import path from 'node:path';
import { normFolders } from './lib-folder-tree.ts';
import { createPostIndex } from './lib-index.ts';
import { parseJsonLoose } from './lib-json.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import type Database from 'better-sqlite3';

// Mirrors index.ts's INTERNAL_FILES (not exported there — index.ts is the
// Electron entry point, not an importable engine module). Kept in lockstep by
// hand; a name this importer doesn't yet know about just gets scanned as a
// (likely non-post) sidecar and dropped by isPostRecord — not silently wrong.
// tag-groups.json / collections.json are deliberately absent: tag-groups was
// retired in #315 (66dd3d1), collections renamed to folders.json in #42
// (#296 2026-07-23 scope-correction comment).
const INTERNAL_FILES = new Set(['config.json', '.index.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json', 'folders.json', 'tabs.json', 'poster-favorites.json', 'poster-folders.json', 'poster-tags.json']);

interface DbHandle {
  sqlite: Database.Database;
}

export interface ImportReport {
  sidecarCount: number; // sidecar .json files recognized as post records this run (full: all of them; incremental: just the named batch)
  parseFailures: Array<{ file: string; error: string }>; // sidecar-candidate or org-layer JSON that failed to parse, or parsed but wasn't a post record
  postsWritten: number; // post rows inserted/updated this run
  postsRemoved: number; // post rows deleted because their sidecar is gone
  dbPostCount: number; // SELECT COUNT(*) FROM posts after this run — the reconciliation number against sidecarCount
  addedIds: string[]; // captureIds upserted this run (#297: lets a caller re-SELECT just these instead of the whole table)
  removedIds: string[]; // captureIds deleted this run
}

// Reads an org-layer JSON file. Returns null (never throws) — a missing file
// means "nothing set yet" (same as the get-* IPC handlers' empty defaults);
// a present-but-corrupt file is reported as a parse failure so the caller can
// surface it, same treatment as a corrupt sidecar.
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

// Re-derives the organization-layer tables (tags' kind, ungrouped_keys,
// folders/folder_items, manual_groups/items, poster_folders/items,
// poster_tags, tabs/tab_windows) from their JSON files.
// Wholesale wipe-then-reinsert for every table EXCEPT tags (get-or-create,
// per the module comment) — these files are small, so re-reading and
// rewriting them in full on every run is simpler than diffing and costs
// nothing measurable next to the sidecar scan.
//
// validPostIds scopes out stale references (a captureId an org file still
// lists after its sidecar was deleted) — posts.captureId is a foreign key
// target from folder_items/manual_group_items, so an unfiltered
// insert would throw with foreign_keys=ON.
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
  // belongs to the renderer's own sanitizeSavedTabs at RESTORE time, not to
  // this derived-index write.
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

export interface DbImporter {
  importAll(folder: string, handle: DbHandle): Promise<ImportReport>;
  importChanged(folder: string, handle: DbHandle, names: string[]): Promise<ImportReport>;
}

// opts.postIndex lets a caller that already owns a createPostIndex() instance
// (index.ts's renderer-facing postIndex, once a later stage wires this in)
// share it instead of standing up a second one — both read/write the same
// .index.json snapshot regardless, so sharing only saves the duplicate cold
// scan. Standalone callers (tests, a rebuild script) get their own.
export function createDbImporter(opts: { internalFiles?: Set<string>; postIndex?: ReturnType<typeof createPostIndex>; fs?: any } = {}): DbImporter {
  const internalFiles = opts.internalFiles || INTERNAL_FILES;
  const index = opts.postIndex || createPostIndex({ fs: opts.fs, internalFiles });

  // Full rebuild: cold-scans every sidecar (via the shared index, so an
  // existing .index.json snapshot still short-circuits unchanged files),
  // upserts every current post, deletes any post row no longer on disk, then
  // re-derives the whole organization layer. Runs inside one transaction —
  // a mid-run failure leaves the previous DB state untouched.
  async function importAll(folder: string, handle: DbHandle): Promise<ImportReport> {
    const { sqlite } = handle;
    const failures: Array<{ file: string; error: string }> = [];
    const { posts, skipped, stamps } = await index.list(folder);
    for (const s of skipped) if (s.error) failures.push({ file: s.file, error: s.error });

    const validIds = new Set(posts.map((p: any) => p.captureId));
    const stmts = preparePostStmts(sqlite);

    // #297: a repeat importAll (every app relaunch/refresh now calls this —
    // it's index.ts's DB-backed listPosts()/listPostsDelta() full-resync path)
    // must not redo the expensive half of writePost — delete+reinsert media/
    // post_tags/posts_fts, the FTS5 trigram rewrite in particular — for a post
    // that hasn't actually changed since the last import. Measured at 12s ->
    // 23s cold->warm for a 10k-post library before this guard (bench-baseline.cts
    // --adapter db) — a relaunch with nothing new would otherwise cost MORE
    // than the cold import that just populated the DB. The sidecar's own
    // mtimeMs (`stamps`, from the shared postIndex — the same signal
    // lib-index.ts's own applyChanges uses) is the comparison, NOT
    // updatedAt: updatedAt is producer-controlled and not guaranteed to move
    // on every edit (an editor that changes text without bumping it would
    // silently go unsynced), where mtimeMs is the filesystem's own truth.
    const existingStamps = new Map<string, number | null>();
    for (const row of sqlite.prepare('SELECT captureId, sourceMtimeMs FROM posts').all() as Array<{ captureId: string; sourceMtimeMs: number | null }>) {
      existingStamps.set(row.captureId, row.sourceMtimeMs);
    }

    sqlite.exec('BEGIN');
    try {
      const resolveTagId = makeTagResolver(sqlite);
      const addedIds: string[] = [];
      for (const rec of posts) {
        const captureId = rec && rec.captureId;
        const mtimeMs = stamps?.get(captureId) ?? null;
        if (mtimeMs != null && existingStamps.get(captureId) === mtimeMs) continue; // unchanged since last import -- skip the rewrite
        writePost(stmts, resolveTagId, rec, mtimeMs);
        addedIds.push(captureId);
      }

      // Once St5 has flipped the truth source, sidecars are no longer the
      // write path at all: #299 (St6) moved native-host saves to the inbox
      // queue, so a post can legitimately exist in the DB with NO sidecar on
      // disk. Both org-layer re-derivation AND "sidecar absent -> delete this
      // post" are therefore sidecar-authority behaviors that must stop the
      // moment the DB is authoritative — deletion becomes a DB-only operation
      // (trash/restore, #301's orphan handling), never inferred from a scan.
      // Pre-flip (a library mid-migration, or a test exercising St3 in
      // isolation) keeps the original "disk is truth" behavior on both counts.
      const truthSource = sqlite.prepare("SELECT value FROM store_state WHERE key = 'truthSource'").get() as { value: string } | undefined;
      const dbIsTruth = truthSource?.value === 'db';

      const removedIds: string[] = [];
      if (!dbIsTruth) {
        const existing = sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>;
        for (const row of existing) {
          if (!validIds.has(row.captureId)) {
            stmts.deletePost.run(row.captureId);
            removedIds.push(row.captureId);
          }
        }
      }

      if (!dbIsTruth) importOrgLayer(folder, sqlite, resolveTagId, validIds, failures);

      sqlite.exec('COMMIT');
      const dbPostCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n;
      // postsWritten stays "every post reconciled this call" (idempotency
      // contract scripts/test-db-import.cts pins: an unchanged re-run still
      // reports the full count) -- addedIds is the finer-grained "actually
      // rewrote these" list the skip-guard above produces, for callers (the
      // #297 read path) that want to know what really changed.
      return { sidecarCount: posts.length, parseFailures: failures, postsWritten: posts.length, postsRemoved: removedIds.length, dbPostCount, addedIds, removedIds };
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  // Incremental sync: applies exactly the sidecars named by an fs.watch hint
  // (index.ts's watchChanged batch — see lib-index.ts's applyChanges doc).
  // Only touches posts/media/post_tags/posts_fts for the named files; the
  // organization layer is not part of this path (its own writes never appear
  // in the watch hint — index.ts's watcher explicitly skips INTERNAL_FILES,
  // so an org edit has nothing here to react to. importAll re-derives it).
  async function importChanged(folder: string, handle: DbHandle, names: string[]): Promise<ImportReport> {
    const { sqlite } = handle;
    const { added, removed, skipped } = await index.applyChanges(folder, names);
    const failures: Array<{ file: string; error: string }> = [];
    for (const s of skipped) if (s.error) failures.push({ file: s.file, error: s.error });
    const stmts = preparePostStmts(sqlite);

    sqlite.exec('BEGIN');
    try {
      const resolveTagId = makeTagResolver(sqlite);
      for (const entry of added) writePost(stmts, resolveTagId, entry.record, entry.mtimeMs);
      for (const captureId of removed) stmts.deletePost.run(captureId);
      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
    const dbPostCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get() as { n: number }).n;
    return { sidecarCount: added.length, parseFailures: failures, postsWritten: added.length, postsRemoved: removed.length, dbPostCount, addedIds: added.map((a: any) => a.record.captureId), removedIds: removed };
  }

  return { importAll, importChanged };
}

// --- #300 (St7): tag_parents write path ----------------------------------------
// tag_parents (a tag's parent edges + at-most-one display-parent flag, DDL comment
// in lib-db-schema.ts) has never had a write path anywhere in the app — it's
// dormant schema for #86/#157. There is correspondingly no prior sidecar/org-JSON
// format for it; library/tag-parents.json (lib-archive.ts, #300 export side) is a
// new format invented for this issue. Shape: { tags: [{ref,name,kind,reading}],
// parents: [{tagRef,parentRef,isDisplay}] } — `ref` is the EXPORTING database's own
// tags.id, meaningful only within this one export (a ZIP is a point-in-time
// snapshot; no cross-export id space exists or is needed).
export interface TagParentsJson {
  tags: Array<{ ref: number; name: string; kind?: string | null; reading?: string | null }>;
  parents: Array<{ tagRef: number; parentRef: number; isDisplay?: boolean }>;
}

// Resolves each exported tag by NAME (resolveTagId — get-or-create, same resolver
// posts/poster_tags/tag-types already use) and writes the parent edges.
//
// Known limitation, accepted for v1: resolveTagId cannot distinguish two tags that
// share a name but are different entities (exactly the case tag_parents/isDisplay
// exists to disambiguate) — importing into a library that already has a
// same-named-but-different tag will resolve both to the same row. This matches
// the resolver's own documented contract (module comment above: "this importer
// resolves tag NAMES only; it cannot express 'two tags share a name but are
// different entities' ... that curation happens later, directly against the DB").
// Importing into an EMPTY database is unaffected (nothing to collide with).
//
// isDisplay is written respecting the "at most one display parent per tag" partial
// unique index (idx_tag_parents_display): if the landing database already has a
// DIFFERENT display parent for a tag, the incoming edge is still inserted (so the
// parent/child relationship itself round-trips) but with isDisplay downgraded to
// false — LOCAL wins, the same convention every other merge in lib-archive.ts uses.
function importTagParents(sqlite: Database.Database, resolveTagId: (name: string) => number, data: TagParentsJson | null | undefined): void {
  if (!data || !Array.isArray(data.tags) || !Array.isArray(data.parents)) return;

  const refToId = new Map<number, number>();
  for (const t of data.tags) {
    if (!t || typeof t.ref !== 'number' || typeof t.name !== 'string' || !t.name) continue;
    refToId.set(t.ref, resolveTagId(t.name));
  }

  const existingDisplay = new Map<number, number>();
  for (const row of sqlite.prepare('SELECT tagId, parentTagId FROM tag_parents WHERE isDisplay = 1').all() as Array<{ tagId: number; parentTagId: number }>) {
    existingDisplay.set(row.tagId, row.parentTagId);
  }
  const insertEdge = sqlite.prepare('INSERT OR IGNORE INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
  for (const p of data.parents) {
    if (!p || typeof p.tagRef !== 'number' || typeof p.parentRef !== 'number') continue;
    const tagId = refToId.get(p.tagRef);
    const parentTagId = refToId.get(p.parentRef);
    if (tagId == null || parentTagId == null || tagId === parentTagId) continue; // unresolved ref, or a tag listed as its own parent
    const currentDisplay = existingDisplay.get(tagId);
    const setDisplay = !!p.isDisplay && (currentDisplay == null || currentDisplay === parentTagId);
    insertEdge.run(tagId, parentTagId, setDisplay ? 1 : 0);
    if (setDisplay) existingDisplay.set(tagId, parentTagId);
  }
}

export { INTERNAL_FILES as DB_IMPORT_INTERNAL_FILES, importTagParents };
