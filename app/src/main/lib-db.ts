'use strict';

// SQLite engine layer for the metadata store (#5 / #294 St1, schema from #295
// St2): opens the database, applies pending migrations, and hands back a typed
// Kysely instance. The DDL itself lives in lib-db-schema.ts — this file stays
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
import { POSTS_FTS_COLUMNS, POSTS_FTS_SQL, SCHEMA_V1_SQL } from './lib-db-schema.ts';

// One entry per schema change, applied in array order and never reordered or
// edited once shipped — `user_version` records how many have run, so rewriting
// an applied entry leaves existing databases silently inconsistent. Append only.
//
// add-source-mtime / drop-source-mtime (#297, retired by #302): posts.sourceMtimeMs
// let the repeating sidecar->DB sync skip re-deriving a post whose file hadn't
// moved. There is no sync any more — the DB is written directly — so the column
// has no reader left. Both entries stay because the list is append-only; a fresh
// database runs them back to back and ends up in the right shape.
const MIGRATIONS: Migration[] = [
  { name: 'schema-v1', up: (db) => db.exec(SCHEMA_V1_SQL) },
  { name: 'add-source-mtime', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN sourceMtimeMs INTEGER') },
  // #135: the clip feature is retired (folders/favorites/pin boards took over its roles).
  { name: 'drop-clip-items', up: (db) => db.exec('DROP TABLE clip_items') },
  // The poster-side workspace UI was retired 2026-06-27 (poster organization
  // consolidated into poster-folder) but this persistence layer was left behind —
  // no renderer code has read or written it since.
  { name: 'drop-poster-workspace-items', up: (db) => db.exec('DROP TABLE poster_workspace_items') },
  // St5 (#298) needs a durable, transactional switch between the temporary
  // sidecar-derived index and the DB-owned write path. Keeping it in SQLite
  // (rather than config.json) means a copied/restored database carries its
  // own interpretation and cannot silently be re-imported from stale JSON.
  {
    name: 'add-store-state',
    up: (db) =>
      db.exec(`
        CREATE TABLE store_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        ALTER TABLE posts ADD COLUMN userKind TEXT;
        ALTER TABLE posts ADD COLUMN tagReviewed INTEGER;
      `),
  },
  // #41: folders stay a flat table; parentId is the only tree edge. The
  // renderer repairs orphaned/cyclic edges when it reads, while the FK keeps a
  // valid persisted parent from outliving its subtree.
  { name: 'add-folder-parent', up: (db) => db.exec('ALTER TABLE folders ADD COLUMN parentId TEXT REFERENCES folders(id) ON DELETE CASCADE') },
  // #119 St1: video/gif media items carry their kind + downloaded poster-frame
  // filename (a still image can't be measured/thumbnailed from the video file
  // itself). Both nullable — pre-migration rows and every still-image entry
  // (the vast majority) leave them null.
  {
    name: 'add-media-video-fields',
    up: (db) =>
      db.exec(`
        ALTER TABLE media ADD COLUMN type TEXT;
        ALTER TABLE media ADD COLUMN posterFile TEXT;
      `),
  },
  // #362: which intake route produced the record ('x-bookmarks' bulk intake;
  // later bulk adapters add their own values). A capture-time fact, not
  // organization — recorded because it cannot be reconstructed after intake
  // (X has no bookmark export). Nullable: every ordinary save leaves it null.
  { name: 'add-captured-via', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN capturedVia TEXT') },
  // #299: the app-internal video import path (ipc-transfer.ts's import-images)
  // has produced a sidecar `video` field since before this column existed —
  // normalizePostRecord/PostRecordShape gained it alongside this migration.
  // The `image`/`video` split mirrors the renderer's own `image || video` UI
  // contract (a post has at most one of the two as its primary artifact).
  { name: 'add-post-video', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN video TEXT') },
  // #299 (St6): the durable native-host intake queue's apply-once receipts.
  // inbox_events records one row per envelope (eventId = captureId) actually
  // applied to `posts` — the idempotency ledger a re-scan or a replayed
  // segment checks before writing anything (design comment's "apply rules").
  // sourceSegment is NULL for a still-loose event and the segment's id once
  // compaction folds it in (#299 design comment, "retention volume and compaction") —
  // recorded so a segment can be proven fully-applied without re-reading it.
  // inbox_segments records one row per compacted segment file actually
  // replayed, so a normal restart can skip re-opening a segment whose events
  // are all already accounted for (only a DB-loss recovery, where these rows
  // are gone too, replays segment contents again).
  {
    name: 'add-inbox-tables',
    up: (db) =>
      db.exec(`
        CREATE TABLE inbox_events (
          eventId TEXT PRIMARY KEY,
          captureId TEXT NOT NULL,
          payloadSha256 TEXT NOT NULL,
          importedAt TEXT NOT NULL,
          sourceSegment TEXT
        );
        CREATE INDEX idx_inbox_events_captureId ON inbox_events(captureId);
        CREATE TABLE inbox_segments (
          segmentId TEXT PRIMARY KEY,
          payloadSha256 TEXT NOT NULL,
          importedAt TEXT NOT NULL
        );
      `),
  },
  // #302: the sidecar scan is gone, so nothing derives a post from a file whose
  // mtime could be compared — see the add-source-mtime note above.
  { name: 'drop-source-mtime', up: (db) => db.exec('ALTER TABLE posts DROP COLUMN sourceMtimeMs') },
  // #292: the acquisition-original layer. One row per payload that arrived FOR
  // a post — several per post is normal (a platform's post endpoint plus its
  // author-profile endpoint), which is why sourceKind is a column and not a
  // single blob on `posts`. payload is gzip of the received bytes; sha256 is
  // over the UNCOMPRESSED bytes so it identifies the payload rather than one
  // compression of it, and byteLength records the uncompressed size even when
  // the per-record cap left the bytes out (encoding = 'omitted:oversize',
  // payload NULL). See native-host/raw-payload.mts for the shape and the cap,
  // docs/decisions/0011 for why the layer exists.
  //
  // UNIQUE(postId, sourceKind, sha256) makes re-applying the same write
  // idempotent (a replayed inbox segment, a re-imported ZIP) without ever
  // deleting an earlier acquisition — this table is append-only, unlike the
  // media/post_tags/FTS rows writePost rewrites wholesale. Identical bytes from
  // the same route ARE the same original, so collapsing them is not the
  // cross-record dedup #292 defers out of v1.
  {
    name: 'add-raw-payloads',
    up: (db) =>
      db.exec(`
        CREATE TABLE raw_payloads (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
          sourceKind TEXT NOT NULL,
          acquiredAt TEXT NOT NULL,
          contentType TEXT,
          encoding TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          byteLength INTEGER NOT NULL,
          payload BLOB
        );
        CREATE INDEX idx_raw_payloads_postId ON raw_payloads(postId);
        CREATE UNIQUE INDEX idx_raw_payloads_identity ON raw_payloads(postId, sourceKind, sha256);
      `),
  },
  // #119 St3: a pixiv ugoira is saved as pixiv's own zip of frame images, and
  // the per-frame display times live nowhere inside it. JSON in one column
  // rather than a frames table: the list is only ever read whole, for one media
  // item, by the player — nothing queries or joins an individual frame. Null on
  // every other media row (i.e. almost all of them).
  { name: 'add-media-frames', up: (db) => db.exec('ALTER TABLE media ADD COLUMN frames TEXT') },
  // #444: give every post a stable FTS row key so the write path stops addressing
  // posts_fts by its UNINDEXED postId column. An FTS5 virtual table has no index
  // but MATCH and rowid, so `WHERE postId = ?` is a full scan of the index — the
  // per-post write cost therefore grew with the library (10,000 rows 2.2ms -> 30,000 rows 8.0ms
  // measured on the pre-change tree) and every bulk operation was O(N²).
  //
  // ftsRowid rather than posts' own implicit rowid: an implicit rowid on a table
  // whose primary key is TEXT is not stable across VACUUM (SQLite's own caveat),
  // which would silently re-point every FTS row at the wrong post. Nothing in the
  // app VACUUMs today; an explicit column means nothing has to keep not doing so.
  //
  // The seeding UPDATE reads that implicit rowid exactly once, while it is still
  // the truth — after this migration the column is owned by the record writer
  // (lib-db-record-writer.ts), which reuses a post's key on rewrite and lets FTS5
  // allocate one for a post that has none.
  //
  // posts_fts is dropped and rebuilt from `posts` rather than copied across: a
  // rebuild is FTS5's only way to re-key rows, re-deriving is what makes exactly
  // one FTS row per post true afterwards (any orphan row left by an older write
  // path disappears), and the two derived columns are cheap to recompute —
  // hashtags is posts.hashtags' JSON array space-joined (the pre-tokenized copy,
  // schema comment in lib-db-schema.ts) and tagsText is the post's tag names.
  // reading stays NULL because nothing writes it yet (#164).
  //
  // The posts_fts DDL and column list are INLINED here rather than
  // interpolating POSTS_FTS_SQL/POSTS_FTS_COLUMNS (unlike the
  // add-post-cw-sensitive migration below, which is the one that gets to call
  // itself "current"): this migration is historical and must keep rebuilding
  // the exact 10-column shape it shipped with, even after a later migration
  // (#178) makes those constants describe an 11-column table. Interpolating
  // the shared constant here silently changed this frozen migration's SQL out
  // from under it the moment #178 landed — caught by db.test.ts/db-schema.test.ts
  // failing on every fresh database ("11 values for 12 columns").
  {
    name: 'fts-rowid-addressing',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN ftsRowid INTEGER;
        UPDATE posts SET ftsRowid = rowid;
        CREATE UNIQUE INDEX idx_posts_ftsRowid ON posts(ftsRowid);
        DROP TABLE posts_fts;
        CREATE VIRTUAL TABLE posts_fts USING fts5(
          postId UNINDEXED,
          text,
          title,
          displayName,
          screenName,
          eagleName,
          description,
          hashtags,
          tagsText,
          reading,
          tokenize = 'trigram'
        );
        INSERT INTO posts_fts (rowid, postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading)
          SELECT
            p.ftsRowid, p.captureId, p.text, p.title, p.displayName, p.screenName, p.eagleName, p.description,
            COALESCE(CASE WHEN json_valid(p.hashtags) THEN (SELECT group_concat(h.value, ' ' ORDER BY h.key) FROM json_each(p.hashtags) h) END, ''),
            COALESCE((SELECT group_concat(t.name, ' ' ORDER BY pt.rowid) FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = p.captureId), ''),
            NULL
          FROM posts p;
      `),
  },
  // #34: the captureId a record replaces, written by the duplicate-save
  // warning's "replace" answer. A PENDING marker, not a relation — the app
  // consumes it (trash the old capture, merge its tags, re-point its folder /
  // manual-group rows) and sets it back to NULL, so a non-null value means
  // "not swept yet". Deliberately NOT a foreign key: the old post is gone by
  // the time the sweep finishes, and a replay may carry a marker naming a
  // captureId this database never had.
  { name: 'add-post-replaces', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN replaces TEXT') },
  // #560: which picture of a multi-image post a drag save took (1-based) and how
  // many the post had. The extension has sent both since drag-save existed, but
  // no column held them, so the inspector row reading them could never fill.
  // Two plain nullable columns rather than a media-row position: the record's
  // media[] holds only the ONE downloaded picture, so there is no row whose
  // position could carry this — it is a fact about the post the picture came
  // from, and the post row is where facts about that post live. Null on every
  // other route (see PostRecordShape.imageIndex).
  {
    name: 'add-post-image-index',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN imageIndex INTEGER;
        ALTER TABLE posts ADD COLUMN imageCount INTEGER;
      `),
  },
  // #202: which of the record's fields were read off the PAGE because the
  // platform API answered nothing for them. A JSON string[] in one TEXT column,
  // exactly like `hashtags` — it is a small annotation read WITH the post, never
  // a thing to join or filter on, so it needs no table of its own.
  // Empty ('[]') on every record whose API fetch succeeded in full.
  { name: 'add-post-dom-filled', up: (db) => db.exec('ALTER TABLE posts ADD COLUMN domFilled TEXT') },
  // #189: whether the platform's own API reports this post as edited, and
  // when. Two columns because they answer independent questions — X's
  // edit_control has no timestamp at all (see PostRecordShape.editedAt), so a
  // row can have isEdited=1 and editedAt=NULL. Both null on every row written
  // before this migration and on every platform with no edit signal.
  {
    name: 'add-post-edited-fields',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN isEdited INTEGER;
        ALTER TABLE posts ADD COLUMN editedAt TEXT;
      `),
  },
  // #178: content-warning text (Misskey note.cw / Mastodon spoiler_text) and
  // the platform's own sensitive/adult flag (Mastodon sensitive / X
  // possibly_sensitive / Bluesky self-labels) — see PostRecordShape.cw/sensitive
  // for the per-platform sourcing. Both null on every row written before this
  // migration and on every platform with no such signal (Misskey has no
  // note-level sensitivity boolean; X and Bluesky have no CW free text).
  //
  // cw is the author's own written words — same footing as text/title — so
  // posts_fts is reshaped to index it too, not just the posts row. FTS5 has no
  // ALTER; a rebuild is the only way to add a column (same rationale as
  // fts-rowid-addressing, #444). The rebuild reuses each post's existing
  // ftsRowid (fts-rowid-addressing already ran by this point in the migration
  // order) and recomputes hashtags/tagsText exactly like that migration did;
  // reading stays NULL because nothing writes it yet (#164). cw itself just
  // added by the ALTER above is NULL for every existing row, so the copied
  // value is a no-op today and becomes real the first time each post is
  // rewritten.
  {
    name: 'add-post-cw-sensitive',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN cw TEXT;
        ALTER TABLE posts ADD COLUMN sensitive INTEGER;
        DROP TABLE posts_fts;
        ${POSTS_FTS_SQL}
        INSERT INTO posts_fts (rowid, ${POSTS_FTS_COLUMNS})
          SELECT
            p.ftsRowid, p.captureId, p.text, p.title, p.displayName, p.screenName, p.eagleName, p.description,
            COALESCE(CASE WHEN json_valid(p.hashtags) THEN (SELECT group_concat(h.value, ' ' ORDER BY h.key) FROM json_each(p.hashtags) h) END, ''),
            COALESCE((SELECT group_concat(t.name, ' ' ORDER BY pt.rowid) FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = p.captureId), ''),
            NULL,
            p.cw
          FROM posts p;
      `),
  },
  // #188: pixiv series membership — which series a work belongs to and its
  // 1-based position in it, from the illust payload's seriesNavData (see
  // PostRecordShape.seriesId/seriesTitle/seriesOrder). All three null on every
  // row written before this migration and on every non-series/non-pixiv post.
  {
    name: 'add-post-series-fields',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN seriesId TEXT;
        ALTER TABLE posts ADD COLUMN seriesTitle TEXT;
        ALTER TABLE posts ADD COLUMN seriesOrder INTEGER;
      `),
  },
  // #180: quote/renote and (Misskey-only) reply-to sidecar sub-records — see
  // native-host/post-record.mts's QuotedPostShape for the field set. Stored as
  // JSON text (same convention as hashtags/domFilled): each is 0-or-1 per post,
  // not a fan-out worth its own table. Not added to posts_fts: that FTS5 index
  // has no live caller yet (lib-db-query.ts's module comment — the renderer's
  // in-memory textHaystackOf is the only wired-up free-text search path), so
  // rebuilding it for a column nothing reads would be migration cost with no
  // present payoff; the eventual FTS consumer picks this up when it lands.
  {
    name: 'add-post-quoted-refs',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts ADD COLUMN quotedPost TEXT;
        ALTER TABLE posts ADD COLUMN replyToPost TEXT;
      `),
  },
  // #36: a free-text memo the user attaches to a post, unifying the Eagle-migration
  // `description` field into the same column instead of keeping two synonymous
  // fields (see PostRecordShape.memo / the acceptance note on #36 — "description
  // を参照するコードが残っていない"). RENAME COLUMN is used rather than
  // add-then-copy-then-drop: it is already relied on elsewhere in this file
  // (drop-source-mtime uses the newer DROP COLUMN, which needs the same SQLite
  // version support), and it keeps every existing row's content without a second
  // pass.
  //
  // posts_fts has no ALTER (same FTS5 limitation fts-rowid-addressing/
  // add-post-cw-sensitive above worked around) so it is dropped and rebuilt here
  // too, reusing each post's ftsRowid — the identical rebuild recipe those two
  // migrations used, just reading the newly-renamed posts.memo column instead of
  // posts.description. This migration is now the one that gets to call itself
  // "current" for POSTS_FTS_SQL/POSTS_FTS_COLUMNS (add-post-cw-sensitive held that
  // role until now): nothing runs after it in this append-only list that still
  // expects a `description` column, on a fresh database or an existing one alike.
  {
    name: 'rename-description-to-memo',
    up: (db) =>
      db.exec(`
        ALTER TABLE posts RENAME COLUMN description TO memo;
        DROP TABLE posts_fts;
        ${POSTS_FTS_SQL}
        INSERT INTO posts_fts (rowid, ${POSTS_FTS_COLUMNS})
          SELECT
            p.ftsRowid, p.captureId, p.text, p.title, p.displayName, p.screenName, p.eagleName, p.memo,
            COALESCE(CASE WHEN json_valid(p.hashtags) THEN (SELECT group_concat(h.value, ' ' ORDER BY h.key) FROM json_each(p.hashtags) h) END, ''),
            COALESCE((SELECT group_concat(t.name, ' ' ORDER BY pt.rowid) FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = p.captureId), ''),
            NULL,
            p.cw
          FROM posts p;
      `),
  },
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
// engine requirement. Kept in lockstep with lib-db-schema.ts by hand: Kysely
// has no DDL-to-type codegen for a hand-rolled migration string, so a column
// added there and not here just fails to type-check at the first query that
// uses it — no runtime drift is possible.
interface PostsTable {
  captureId: string;
  assetClass: string;
  mediaType: string | null;
  image: string | null;
  video: string | null; // add-post-video migration (#299) — see PostRecordShape.video
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
  memo: string | null; // rename-description-to-memo migration (#36) — see PostRecordShape.memo
  source: string | null;
  shotW: number | null;
  shotH: number | null;
  trashedAt: string | null;
  userKind: string | null;
  tagReviewed: number | null;
  capturedVia: string | null; // add-captured-via migration (#362) — intake route, null = ordinary save
  // fts-rowid-addressing migration (#444) — this post's posts_fts rowid. An
  // internal key, deliberately absent from POST_COLUMNS: it identifies a row in
  // THIS database's FTS index and means nothing in an export or another library.
  ftsRowid: number | null;
  replaces: string | null; // add-post-replaces migration (#34) — pending replacement marker, null once swept
  // add-post-image-index migration (#560) — see PostRecordShape.imageIndex
  imageIndex: number | null;
  imageCount: number | null;
  // add-post-dom-filled migration (#202) — JSON string[], same storage as
  // hashtags. See PostRecordShape.domFilled. Null on rows written before it.
  domFilled: string | null;
  // add-post-edited-fields migration (#189) — see PostRecordShape.isEdited/editedAt.
  isEdited: number | null;
  editedAt: string | null;
  // add-post-cw-sensitive migration (#178) — see PostRecordShape.cw/sensitive.
  cw: string | null;
  sensitive: number | null;
  // add-post-series-fields migration (#188) — see PostRecordShape.seriesId/seriesTitle/seriesOrder.
  seriesId: string | null;
  seriesTitle: string | null;
  seriesOrder: number | null;
  // add-post-quoted-refs migration (#180) — JSON QuotedPostShape, same storage
  // convention as hashtags/domFilled. See PostRecordShape.quotedPost/replyToPost.
  quotedPost: string | null;
  replyToPost: string | null;
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
  type: string | null; // add-media-video-fields migration (#119 St1)
  posterFile: string | null; // add-media-video-fields migration (#119 St1)
  frames: string | null; // add-media-frames migration (#119 St3) — JSON [{file,delay}], ugoira only
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
  parentId: string | null;
  tree: string | null; // JSON saved-search tree, dynamic folders only
}
interface FolderItemsTable {
  folderId: string;
  postId: string;
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
interface StoreStateTable {
  key: string;
  value: string;
}
// add-inbox-tables migration (#299 St6) — see MIGRATIONS comment.
interface InboxEventsTable {
  eventId: string;
  captureId: string;
  payloadSha256: string;
  importedAt: string;
  sourceSegment: string | null;
}
interface InboxSegmentsTable {
  segmentId: string;
  payloadSha256: string;
  importedAt: string;
}
// add-raw-payloads migration (#292) — see the MIGRATIONS entry. payload is a
// BLOB: better-sqlite3 binds a Buffer and reads one back, so the type is the
// node buffer type rather than a string.
interface RawPayloadsTable {
  id: Generated<number>;
  postId: string;
  sourceKind: string;
  acquiredAt: string;
  contentType: string | null;
  encoding: string;
  sha256: string;
  byteLength: number;
  payload: Buffer | null;
}
// postsFts is FTS5 (posts_fts): a virtual table, not a normal one, so Kysely's
// typed insert/select work but its DDL helpers do not apply — it is created as
// raw SQL in lib-db-schema.ts. postId is UNINDEXED (match results carry it
// back to `posts`; MATCH never searches it). rank is a query-time bm25()
// expression, not a stored column, so it has no field here.
interface PostsFtsTable {
  postId: string;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  eagleName: string | null;
  memo: string | null; // rename-description-to-memo migration (#36)
  hashtags: string | null; // space-joined tokens, NOT the posts.hashtags JSON
  tagsText: string | null; // resolved tag names, space-joined (post_tags has no text to index directly)
  reading: string | null; // #164 backfills this; empty at every row until then
  cw: string | null; // add-post-cw-sensitive migration (#178) — the author's own CW text
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
  poster_folders: PosterFoldersTable;
  poster_folder_items: PosterFolderItemsTable;
  poster_tags: PosterTagsTable;
  manual_groups: ManualGroupsTable;
  manual_group_items: ManualGroupItemsTable;
  ungrouped_keys: UngroupedKeysTable;
  tabs: TabsTable;
  tab_windows: TabWindowsTable;
  store_state: StoreStateTable;
  posts_fts: PostsFtsTable;
  inbox_events: InboxEventsTable;
  inbox_segments: InboxSegmentsTable;
  raw_payloads: RawPayloadsTable;
}

export { openDatabase, runMigrations, DatabaseCorruptError, MIGRATIONS };
export type { Migration, MigrationDb, Schema };
