'use strict';

// SQLite engine layer for the metadata store (#5 / #294 St1, schema from #295
// St2): opens the database, applies pending migrations, and hands back a typed
// Kysely instance. The DDL itself lives in lib-db-schema.mts — this file stays
// the engine (open/migrate), that one the shape (what "current" means).
//
// Kept Electron-free (better-sqlite3 and node builtins only) so the migration
// runner unit-tests in plain node, mirroring lib-index/lib-archive.
//
// Single writer: only the Electron MAIN process opens this database for writing.
// Other processes (the Chrome-spawned native host) never touch the .db — they
// append to the intake queue and the app ingests it (#299). WAL still lets
// readers in (a read-only snapshot open for the perf harness, #293).
//
// The prebuilt native binary is N-API, so the SAME better-sqlite3 .node loads
// under both plain node and Electron without a rebuild step (verified 2026-07-24
// on node 24 / Electron 43 — NODE_MODULE_VERSION 137 vs 148). Do not add
// electron-rebuild wiring for it; see docs/build.md.

import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import type { Generated } from 'kysely';
import { SCHEMA_V1_SQL } from './lib-db-schema.mts';

// One entry per schema change, applied in array order and never reordered or
// edited once shipped — `user_version` records how many have run, so rewriting
// an applied entry leaves existing databases silently inconsistent. Append only.
//
// add-source-mtime (#297): posts.sourceMtimeMs lets the importer (lib-db-import.mts's
// importAll) tell "this post's sidecar hasn't changed since the last import"
// apart from "this post's content changed" — updatedAt is producer-controlled
// and NOT bumped on every edit (proven by scripts/test-db-import.cts's edit
// case), so it can't be trusted as a change signal; the sidecar's own mtimeMs
// (already tracked by lib-index.mts's postIndex) can. Nullable: pre-migration
// rows just re-sync once on the next importAll (self-heals, no backfill needed).
const MIGRATIONS: Migration[] = [
  { name: 'schema-v1', up: (db) => db.exec(SCHEMA_V1_SQL) },
  { name: 'add-source-mtime', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN sourceMtimeMs INTEGER') },
  // #135: the clip feature is retired (folders/favorites/pin boards took over its roles).
  { name: 'drop-clip-items', up: (db) => db.exec('DROP TABLE clip_items') },
];

interface Migration {
  name: string;
  up: (db: MigrationDb) => void;
}

// The slice of better-sqlite3 a migration needs. Narrow on purpose: tests pass a
// plain fake, and migrations get no access to the query builder (raw DDL only —
// Kysely's typed schema describes the CURRENT shape, not historical ones).
interface MigrationDb {
  exec: (sql: string) => unknown;
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
}

class DatabaseCorruptError extends Error {}

// Runs every migration past `user_version`, each in its own transaction, and
// bumps `user_version` in that same transaction so an interrupted run replays
// cleanly. `user_version` is a 4-byte int in the SQLite header itself — no
// bookkeeping table to create before the first migration can run.
//
// Exported for the unit test: takes any MigrationDb, so the ordering and
// resume-from-partial guarantees are checkable without a real database.
function runMigrations(db: MigrationDb, migrations = MIGRATIONS) {
  const applied = Number(db.pragma('user_version', { simple: true })) || 0;
  if (applied > migrations.length) {
    throw new Error(`database schema is newer than this build (user_version=${applied}, known=${migrations.length})`);
  }
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      migrations[i].up(db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${i + 1} (${migrations[i].name}) failed: ${err.message}`);
    }
  }
  return { from: applied, to: migrations.length };
}

// Opens (creating if absent) the database at `file` and returns { db, sqlite }:
// `db` is the Kysely query builder, `sqlite` the raw handle for the operations
// Kysely does not cover (backup snapshots #301, pragma checks).
//
// quick_check runs before any migration: it is the cheap structural scan
// (page/index integrity, no cross-table verification) that integrity_check does
// in full. Opening a corrupt file and writing to it makes recovery harder, so a
// failure throws DatabaseCorruptError here rather than surfacing as a confusing
// query error later. The full integrity_check belongs to the periodic sweep (#301).
function openDatabase(file: string, opts: { readonly?: boolean } = {}) {
  const sqlite = new Database(file, { readonly: !!opts.readonly });

  // A file that is not SQLite at all throws SQLITE_NOTADB here rather than
  // returning a verdict, so both shapes have to funnel into the same error —
  // and the handle has to be closed either way or the file stays locked.
  let check: unknown;
  try {
    check = sqlite.pragma('quick_check', { simple: true });
  } catch (err) {
    sqlite.close();
    throw new DatabaseCorruptError(`cannot read ${file} as a database: ${err.message}`);
  }
  if (check !== 'ok') {
    sqlite.close();
    throw new DatabaseCorruptError(`quick_check failed for ${file}: ${check}`);
  }

  // WAL survives across connections (it is stored in the file header), but set it
  // every open so a database restored from a non-WAL backup gets it back.
  if (!opts.readonly) sqlite.pragma('journal_mode = WAL');
  // Wait rather than throw when another connection holds the write lock — the
  // read-only perf harness and the backup snapshot both overlap normal use.
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  if (!opts.readonly) runMigrations(sqlite);

  const db = new Kysely<Schema>({ dialect: new SqliteDialect({ database: sqlite }) });
  return { db, sqlite };
}

// The typed mirror of SCHEMA_V1_SQL (#295 St2). Column names are camelCase to
// match the sidecar JSON they replace (#5 2026-07-18 comment) — SQLite itself
// is case-insensitive on identifiers, so this is a naming convention, not an
// engine requirement. Kept in lockstep with lib-db-schema.mts by hand: Kysely
// has no DDL-to-type codegen for a hand-rolled migration string, so a column
// added there and not here just fails to type-check at the first query that
// uses it — no runtime drift is possible.
interface PostsTable {
  captureId: string;
  assetClass: string;
  mediaType: string | null;
  image: string | null;
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarFile: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  date: string | null;
  capturedAt: string;
  updatedAt: string;
  lang: string | null;
  isReply: number | null;
  isQuote: number | null;
  isThread: number | null;
  quotedUrl: string | null;
  replyToId: string | null;
  hashtags: string; // JSON string[] — non-tag leaves stay plain text (#5 2026-07-18 comment)
  eagleName: string | null;
  description: string | null;
  source: string | null;
  shotW: number | null;
  shotH: number | null;
  trashedAt: string | null;
  sourceMtimeMs: number | null; // add-source-mtime migration (#297) — see MIGRATIONS comment
}
interface MediaTable {
  id: Generated<number>;
  postId: string;
  seq: number;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
}
interface TagsTable {
  id: Generated<number>;
  name: string;
  kind: string | null; // free text on purpose — #157 has the fixed 3-value enum under redesign
  reading: string | null; // #164 backfills this; empty at every row until then
}
interface TagParentsTable {
  tagId: number;
  parentTagId: number;
  isDisplay: number;
}
interface TagAliasesTable {
  id: Generated<number>;
  alias: string;
  tagId: number;
}
interface PostTagsTable {
  postId: string;
  tagId: number;
}
interface FoldersTable {
  id: string;
  name: string;
  kind: string;
  created: number | null;
  tree: string | null; // JSON saved-search tree, dynamic folders only
}
interface FolderItemsTable {
  folderId: string;
  postId: string;
}
interface PosterWorkspaceItemsTable {
  posterKey: string;
}
interface PosterFoldersTable {
  id: string;
  name: string;
}
interface PosterFolderItemsTable {
  folderId: string;
  posterKey: string;
}
interface PosterTagsTable {
  posterKey: string;
  tagId: number;
}
interface ManualGroupsTable {
  id: Generated<number>;
}
interface ManualGroupItemsTable {
  groupId: number;
  postId: string;
  seq: number;
}
interface UngroupedKeysTable {
  postKey: string;
}
interface TabsTable {
  id: string;
  windowId: string;
  position: number;
  pinned: number;
  title: string | null;
  state: string; // JSON — nav history + query tree, opaque replay state (not queried by column)
}
interface TabWindowsTable {
  windowId: string;
  activeTabId: string | null;
}
// postsFts is FTS5 (posts_fts): a virtual table, not a normal one, so Kysely's
// typed insert/select work but its DDL helpers do not apply — it is created as
// raw SQL in lib-db-schema.mts. postId is UNINDEXED (match results carry it
// back to `posts`; MATCH never searches it). rank is a query-time bm25()
// expression, not a stored column, so it has no field here.
interface PostsFtsTable {
  postId: string;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  eagleName: string | null;
  description: string | null;
  hashtags: string | null; // space-joined tokens, NOT the posts.hashtags JSON
  tagsText: string | null; // resolved tag names, space-joined (post_tags has no text to index directly)
  reading: string | null; // #164 backfills this; empty at every row until then
}

interface Schema {
  posts: PostsTable;
  media: MediaTable;
  tags: TagsTable;
  tag_parents: TagParentsTable;
  tag_aliases: TagAliasesTable;
  post_tags: PostTagsTable;
  folders: FoldersTable;
  folder_items: FolderItemsTable;
  poster_workspace_items: PosterWorkspaceItemsTable;
  poster_folders: PosterFoldersTable;
  poster_folder_items: PosterFolderItemsTable;
  poster_tags: PosterTagsTable;
  manual_groups: ManualGroupsTable;
  manual_group_items: ManualGroupItemsTable;
  ungrouped_keys: UngroupedKeysTable;
  tabs: TabsTable;
  tab_windows: TabWindowsTable;
  posts_fts: PostsFtsTable;
}

export { openDatabase, runMigrations, DatabaseCorruptError, MIGRATIONS };
export type { Migration, MigrationDb, Schema };
