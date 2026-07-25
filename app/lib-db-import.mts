'use strict';

// Sidecar -> DB sync importer (#5 St3 / #296): reads the save folder's sidecar
// JSON (posts) + organization-layer JSON (tag-types / ungrouped / folders /
// manual-groups / poster-folders / poster-tags) + tabs.json, and writes them
// into the SQLite database opened by lib-db.mts (schema from #295 St2).
//
// The DB at this stage is a DERIVED index (#5 2026-07-22 stage-split comment,
// "expand" phase of parallel-change): sidecars remain the truth. A failed or
// stale import never loses data — importAll() re-derives the whole DB from
// whatever is on disk right now, so the worst case is a re-run.
//
// Reuses lib-index.mts's filename+mtimeMs diff engine for the incremental path
// (#296 issue body: "lib-index の filename+mtimeMs 差分機構を流用") — both the
// full and incremental entry points share ONE createPostIndex() instance (same
// role, same .index.json snapshot the renderer's own postIndex in main.mts
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
// node, mirroring lib-db.mts / lib-index.mts.

import nodeFs from 'node:fs';
import path from 'node:path';
import { createPostIndex } from './lib-index.mts';
import { parseJsonLoose } from './lib-json.mts';
import { normalizePostRecord } from '../native-host/post-record.mts';
import type Database from 'better-sqlite3';
import type { PostRecordInput, PostRecordShape } from '../native-host/post-record.mts';

// Mirrors main.mts's INTERNAL_FILES (not exported there — main.mts is the
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

function toDbBool(v: boolean | null): number | null {
  return v == null ? null : v ? 1 : 0;
}

const POST_COLUMNS = [
  'captureId',
  'assetClass',
  'mediaType',
  'image',
  'url',
  'platform',
  'text',
  'title',
  'displayName',
  'screenName',
  'userId',
  'avatar',
  'avatarFile',
  'followers',
  'authorCreatedAt',
  'likes',
  'reposts',
  'replies',
  'bookmarks',
  'views',
  'date',
  'capturedAt',
  'updatedAt',
  'lang',
  'isReply',
  'isQuote',
  'isThread',
  'quotedUrl',
  'replyToId',
  'hashtags',
  'eagleName',
  'description',
  'source',
  'shotW',
  'shotH',
  'trashedAt',
  'sourceMtimeMs',
] as const;

const UPSERT_POST_SQL = `INSERT INTO posts (${POST_COLUMNS.join(',')}) VALUES (${POST_COLUMNS.map(() => '?').join(',')})
  ON CONFLICT(captureId) DO UPDATE SET ${POST_COLUMNS.filter((c) => c !== 'captureId')
    .map((c) => `${c}=excluded.${c}`)
    .join(',')}`;

// Built from named fields (not a positional literal) so a column added to
// POST_COLUMNS and forgotten here fails at the .map(...) below (undefined
// bound param -> better-sqlite3 throws) instead of silently misaligning.
function postParams(n: PostRecordShape, sourceMtimeMs: number | null): unknown[] {
  const byName: Record<string, unknown> = {
    captureId: n.captureId,
    assetClass: n.assetClass,
    mediaType: n.mediaType,
    image: n.image,
    url: n.url,
    platform: n.platform,
    text: n.text,
    title: n.title,
    displayName: n.displayName,
    screenName: n.screenName,
    userId: n.userId,
    avatar: n.avatar,
    avatarFile: n.avatarFile,
    followers: n.followers,
    authorCreatedAt: n.authorCreatedAt,
    likes: n.likes,
    reposts: n.reposts,
    replies: n.replies,
    bookmarks: n.bookmarks,
    views: n.views,
    date: n.date,
    capturedAt: n.capturedAt,
    updatedAt: n.updatedAt,
    lang: n.lang,
    isReply: toDbBool(n.isReply),
    isQuote: toDbBool(n.isQuote),
    isThread: toDbBool(n.isThread),
    quotedUrl: n.quotedUrl,
    replyToId: n.replyToId,
    hashtags: JSON.stringify(n.hashtags),
    eagleName: n.eagleName,
    description: n.description,
    source: n.source,
    shotW: n.shotW,
    shotH: n.shotH,
    trashedAt: n.trashedAt,
    sourceMtimeMs,
  };
  return POST_COLUMNS.map((c) => byName[c]);
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

function makeTagResolver(sqlite: Database.Database) {
  const cache = new Map<string, number>();
  for (const row of sqlite.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>) {
    if (!cache.has(row.name)) cache.set(row.name, row.id);
  }
  const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return function resolveTagId(name: string): number {
    const existing = cache.get(name);
    if (existing != null) return existing;
    const id = Number(insertTag.run(name).lastInsertRowid);
    cache.set(name, id);
    return id;
  };
}

interface PostStmts {
  upsertPost: Database.Statement;
  deleteMedia: Database.Statement;
  insertMedia: Database.Statement;
  deletePostTags: Database.Statement;
  insertPostTag: Database.Statement;
  deleteFts: Database.Statement;
  insertFts: Database.Statement;
  deletePost: Database.Statement;
}

function preparePostStmts(sqlite: Database.Database): PostStmts {
  return {
    upsertPost: sqlite.prepare(UPSERT_POST_SQL),
    deleteMedia: sqlite.prepare('DELETE FROM media WHERE postId = ?'),
    insertMedia: sqlite.prepare('INSERT INTO media (postId, seq, url, alt, width, height, file) VALUES (?,?,?,?,?,?,?)'),
    deletePostTags: sqlite.prepare('DELETE FROM post_tags WHERE postId = ?'),
    insertPostTag: sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)'),
    deleteFts: sqlite.prepare('DELETE FROM posts_fts WHERE postId = ?'),
    insertFts: sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    deletePost: sqlite.prepare('DELETE FROM posts WHERE captureId = ?'),
  };
}

// Writes (or overwrites) everything derived from ONE sidecar record: the posts
// row, its media rows, its tag junction rows, and its FTS row. Tag NAMES are
// resolved to ids via resolveTagId (get-or-create — see the module comment on
// why tags are never wiped). sourceMtimeMs (#297) records the sidecar file's
// mtime this write was derived from, so a later importAll can tell "unchanged"
// apart from "actually edited" without redoing the FTS5 rewrite — null from a
// caller that doesn't track it (e.g. a future write path once #298 flips the
// truth source) just means the next importAll can't skip that post's rewrite.
function writePost(stmts: PostStmts, resolveTagId: (name: string) => number, rec: PostRecordInput, sourceMtimeMs: number | null = null): PostRecordShape {
  const n = normalizePostRecord(rec);
  stmts.upsertPost.run(...postParams(n, sourceMtimeMs));
  stmts.deleteMedia.run(n.captureId);
  n.media.forEach((m, seq) => stmts.insertMedia.run(n.captureId, seq, m.url, m.alt, m.width, m.height, m.file));
  stmts.deletePostTags.run(n.captureId);
  const tagIds = n.tags.map(resolveTagId);
  for (const tagId of tagIds) stmts.insertPostTag.run(n.captureId, tagId);
  stmts.deleteFts.run(n.captureId);
  stmts.insertFts.run(n.captureId, n.text, n.title, n.displayName, n.screenName, n.eagleName, n.description, n.hashtags.join(' '), n.tags.join(' '), null);
  return n;
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

  // folders.json: { folders: [{id,name,kind,created,items,tree?}] }
  const foldersJson = readJsonFile(folder, 'folders.json', failures);
  sqlite.prepare('DELETE FROM folder_items').run();
  sqlite.prepare('DELETE FROM folders').run();
  if (foldersJson && Array.isArray(foldersJson.folders)) {
    const insFolder = sqlite.prepare('INSERT INTO folders (id, name, kind, created, tree) VALUES (?,?,?,?,?)');
    const insItem = sqlite.prepare('INSERT OR IGNORE INTO folder_items (folderId, postId) VALUES (?,?)');
    for (const f of foldersJson.folders) {
      if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') continue;
      const kind = f.kind === 'dynamic' ? 'dynamic' : 'static';
      const tree = kind === 'dynamic' && f.tree && typeof f.tree === 'object' ? JSON.stringify(f.tree) : null;
      insFolder.run(f.id, f.name, kind, typeof f.created === 'number' ? f.created : null, tree);
      if (Array.isArray(f.items)) {
        for (const postId of f.items) if (typeof postId === 'string' && validPostIds.has(postId)) insItem.run(f.id, postId);
      }
    }
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
// (main.mts's renderer-facing postIndex, once a later stage wires this in)
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
    // it's main.mts's DB-backed listPosts()/listPostsDelta() full-resync path)
    // must not redo the expensive half of writePost — delete+reinsert media/
    // post_tags/posts_fts, the FTS5 trigram rewrite in particular — for a post
    // that hasn't actually changed since the last import. Measured at 12s ->
    // 23s cold->warm for a 10k-post library before this guard (bench-baseline.cts
    // --adapter db) — a relaunch with nothing new would otherwise cost MORE
    // than the cold import that just populated the DB. The sidecar's own
    // mtimeMs (`stamps`, from the shared postIndex — the same signal
    // lib-index.mts's own applyChanges uses) is the comparison, NOT
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

      const existing = sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>;
      const removedIds: string[] = [];
      for (const row of existing) {
        if (!validIds.has(row.captureId)) {
          stmts.deletePost.run(row.captureId);
          removedIds.push(row.captureId);
        }
      }

      // Once St5 has flipped the truth source, sidecars remain only as the
      // native-host intake format until #299. Re-reading their organization
      // JSON here would overwrite DB edits on every launch, so only post
      // sidecars continue through the incremental compatibility path.
      const truthSource = sqlite.prepare("SELECT value FROM store_state WHERE key = 'truthSource'").get() as { value: string } | undefined;
      if (truthSource?.value !== 'db') importOrgLayer(folder, sqlite, resolveTagId, validIds, failures);

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
  // (main.mts's watchChanged batch — see lib-index.mts's applyChanges doc).
  // Only touches posts/media/post_tags/posts_fts for the named files; the
  // organization layer is not part of this path (its own writes never appear
  // in the watch hint — main.mts's watcher explicitly skips INTERNAL_FILES,
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

export { INTERNAL_FILES as DB_IMPORT_INTERNAL_FILES };
