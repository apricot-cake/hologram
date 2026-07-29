'use strict';

// The v1 DDL for the metadata store (#5 St2 / #295): every table the sidecar →
// DB migration needs, confirmed across #5's design comments (2026-07-12 through
// 2026-07-22) and this issue's own scope note. Split out of lib-db.ts so the
// engine (open/migrate) and the shape (what "current" means) aren't one file —
// lib-db.ts's typed Schema interface is the hand-kept mirror of this string.
//
// St2 is schema-only: nothing populates these tables yet (St3 is the sidecar
// importer). A fresh v1 database is therefore all empty tables — the acceptance
// bar is "the DDL applies and the shape is queryable", not "data round-trips".
//
// Column names are camelCase, matching the sidecar JSON fields they replace
// (#5 2026-07-18 comment — SQLite is case-insensitive on identifiers, so this
// is a naming convention carried over for continuity, not an engine need).
//
// FOREIGN KEY ... ON DELETE CASCADE throughout: deleting a post/tag/folder drops
// its dependent rows the same way delete-post today deletes a sidecar and every
// file it owns — no separate cleanup pass needed. `PRAGMA foreign_keys = ON` is
// set by openDatabase() on every connection (SQLite does not persist it).
export const SCHEMA_V1_SQL = `
-- posts: the sidecar's fields, unchanged in name and nullability. assetClass is
-- deliberately unconstrained TEXT (#5 2026-07-19 comment: 'media' | 'file' today,
-- a 'link' card is expected to join the axis later — a CHECK enum would force a
-- migration for that, defeating the point of calling it extensible).
CREATE TABLE posts (
  captureId TEXT PRIMARY KEY,
  assetClass TEXT NOT NULL DEFAULT 'media',
  mediaType TEXT,
  image TEXT,
  url TEXT,
  platform TEXT,
  text TEXT,
  title TEXT,
  displayName TEXT,
  screenName TEXT,
  userId TEXT,
  avatar TEXT,
  avatarFile TEXT,
  followers INTEGER,
  authorCreatedAt TEXT,
  likes INTEGER,
  reposts INTEGER,
  replies INTEGER,
  bookmarks INTEGER,
  views INTEGER,
  date TEXT,
  capturedAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  lang TEXT,
  isReply INTEGER,
  isQuote INTEGER,
  isThread INTEGER,
  quotedUrl TEXT,
  replyToId TEXT,
  hashtags TEXT NOT NULL DEFAULT '[]',
  eagleName TEXT,
  description TEXT,
  source TEXT,
  shotW INTEGER,
  shotH INTEGER,
  trashedAt TEXT
);
CREATE INDEX idx_posts_url ON posts(url);
CREATE INDEX idx_posts_capturedAt ON posts(capturedAt);
CREATE INDEX idx_posts_trashedAt ON posts(trashedAt);

-- media: one row per downloaded media item, dimensions included (#5 2026-07-21
-- comment — the #286 standin-generation prerequisite). seq preserves the
-- sidecar's media[] array order (card display order). type/posterFile land via
-- the add-media-video-fields migration (#119 St1) and frames via
-- add-media-frames (#119 St3) — kept out of this historical v1 string like
-- every other post-v1 column.
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  url TEXT,
  alt TEXT,
  width INTEGER,
  height INTEGER,
  file TEXT NOT NULL
);
CREATE INDEX idx_media_postId ON media(postId, seq);

-- tags: ID-entity, not a name (#5 2026-07-18 comment — #21's same-name-character
-- problem). name has no UNIQUE constraint: two distinct tags may share a
-- display name, disambiguated by their parent (below). kind is free TEXT, not
-- an enum: #157 is redesigning the fixed work/character/general set into a
-- user-defined one, so a CHECK here would need re-migrating the moment #157
-- lands.
CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT,
  reading TEXT
);
CREATE INDEX idx_tags_name ON tags(name);

-- tag_parents: a tag may have several parents (2026-07-18 10:24 comment); at
-- most one is flagged the DISPLAY parent (disambiguation label + the search
-- containment that comment describes — "アリス（東方）"). The partial unique
-- index is the "at most one" half; "at most" (not "exactly one") is required
-- because most tags disambiguate nothing and carry isDisplay=0 throughout.
CREATE TABLE tag_parents (
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  parentTagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  isDisplay INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tagId, parentTagId)
);
CREATE UNIQUE INDEX idx_tag_parents_display ON tag_parents(tagId) WHERE isDisplay = 1;

-- tag_aliases: alternate names that resolve to a tag (#86 — danbooru/Hydrus
-- alias). The storage shape is uncontroversial (alias string -> tag id); #86's
-- open question is UI precedence when an alias collides with a real tag name,
-- which is a read-path concern for whichever stage wires this up, not a DDL one.
CREATE TABLE tag_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX idx_tag_aliases_alias ON tag_aliases(alias);

-- post_tags: the post<->tag junction. Saved searches keep a tag LEAF as a
-- tagId reference (#5 2026-07-18 10:24 comment) so a rename never orphans a
-- saved query; hashtags stay plain strings on posts.hashtags (non-tag leaf).
CREATE TABLE post_tags (
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (postId, tagId)
);
CREATE INDEX idx_post_tags_tagId ON post_tags(tagId);

-- folders: the unified container (formerly "collections", #42). kind is
-- constrained (unlike assetClass/tags.kind above) because normFolders' own
-- ternary has treated it as a closed static/dynamic pair since before this
-- migration existed — nothing in #5's confirmed scope opens a third kind.
-- tree is the saved-search query tree for a dynamic folder (JSON, opaque here
-- — the query-tree shape is query.ts's concern, not the DB's). This historical
-- v1 string stays immutable; folder nesting's parentId column (#41) is appended
-- by the add-folder-parent migration in lib-db.ts.
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'static' CHECK (kind IN ('static', 'dynamic')),
  created INTEGER,
  tree TEXT
);
CREATE TABLE folder_items (
  folderId TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  PRIMARY KEY (folderId, postId)
);
CREATE INDEX idx_folder_items_postId ON folder_items(postId);

-- clip_items and poster_workspace_items shipped here as part of v1 (this string
-- is historical and must not change) but both features are retired — the
-- 'drop-clip-items' and 'drop-poster-workspace-items' migrations in lib-db.ts
-- DROP these tables.
CREATE TABLE clip_items (
  postId TEXT PRIMARY KEY REFERENCES posts(captureId) ON DELETE CASCADE
);
CREATE TABLE poster_workspace_items (
  posterKey TEXT PRIMARY KEY
);

-- poster-folders.json / poster-tags.json: the poster-view peers of
-- folders/post_tags. poster_tags references tagId (not a bare string) because
-- the 2026-07-18 comment describes it as sharing the post tag vocabulary —
-- keeping it string-keyed would opt posters out of the rename-safety that is
-- the entire point of making tags an ID entity.
CREATE TABLE poster_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE poster_folder_items (
  folderId TEXT NOT NULL REFERENCES poster_folders(id) ON DELETE CASCADE,
  posterKey TEXT NOT NULL,
  PRIMARY KEY (folderId, posterKey)
);
CREATE TABLE poster_tags (
  posterKey TEXT NOT NULL,
  tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (posterKey, tagId)
);

-- manual-groups.json: user-defined image-view groupings. seq preserves the
-- original array order within a group.
CREATE TABLE manual_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);
CREATE TABLE manual_group_items (
  groupId INTEGER NOT NULL REFERENCES manual_groups(id) ON DELETE CASCADE,
  postId TEXT NOT NULL REFERENCES posts(captureId) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  PRIMARY KEY (groupId, postId)
);

-- ungrouped.json: postKey (the image-view grouping key, url-derived — NOT
-- captureId) is intentionally not a foreign key: a key can outlive any single
-- capture it once grouped, same as in the JSON store today.
CREATE TABLE ungrouped_keys (
  postKey TEXT PRIMARY KEY
);

-- tabs: one row per tab, windowId ready for #32 stage 3 (today every row uses
-- the same sentinel window). state is left as an opaque JSON blob (nav history
-- stack + query tree) rather than exploded into columns — nothing here queries
-- INTO a tab's state, it is replayed whole, so relational columns would buy
-- nothing but migration churn every time the renderer's state shape grows a
-- field.
CREATE TABLE tabs (
  id TEXT PRIMARY KEY,
  windowId TEXT NOT NULL DEFAULT 'main',
  position INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  state TEXT NOT NULL
);
CREATE INDEX idx_tabs_windowId ON tabs(windowId, position);
CREATE TABLE tab_windows (
  windowId TEXT PRIMARY KEY,
  activeTabId TEXT REFERENCES tabs(id)
);

-- posts_fts: FTS5 with the reading column included from the start (#5
-- 2026-07-17 comment — FTS5 cannot add a column later without a full
-- reindex, so the column + query contract land now even though nothing
-- populates it before #164). Rows are addressed by rowid from the
-- fts-rowid-addressing migration (#444) onward — see POSTS_FTS_SQL below,
-- which rebuilds this table with the identical column list.
-- Standalone (no content= external-content link):
-- St3 (the sidecar importer, "derived index stage") owns population, so this
-- migration only needs the shape to exist. hashtags/tagsText are pre-tokenized
-- (space-joined) copies for FTS, distinct from posts.hashtags' JSON — the
-- "事前トークン化" the design comment calls for. Query contract: rank is
-- bm25(posts_fts), not a stored column — "SELECT postId, bm25(posts_fts) AS
-- rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank". Column weighting
-- for bm25() and whether pre-tokenized reading matches word-for-word are both
-- left as implementation-time judgment calls (#5 2026-07-21 comment), decided
-- when St4 wires up the read path.
-- tokenize='trigram': the same tokenizer St1 (#294) proved gives correct
-- Japanese substring matching (unicode61 does not segment CJK text — a run
-- like "猫がすき" tokenizes as one opaque token, so a bare MATCH '猫' misses
-- it entirely). Column-scoped MATCH (col:term) still works under trigram.
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
`;

// The CURRENT posts_fts definition, as its own statement so a migration can drop
// and recreate the table (FTS5 has no ALTER; a rebuild is the only way to change
// anything about it). Deliberately a copy of the text inside SCHEMA_V1_SQL rather
// than an interpolation: that string is historical and must not move when this one
// does. The columns here are identical to v1's — the fts-rowid-addressing
// migration (#444) rebuilds the table to re-key its rows, it does not reshape it,
// so the MATCH/bm25 query contract is unchanged.
//
// Deliberately NOT an external-content table (content=posts), even though this
// index therefore keeps its own copy of the text — considered and rejected in
// #444. FTS5 reads an external content row as "SELECT <every fts column> FROM
// <content>", so `posts` would have to grow same-named columns for the three
// that do not exist on it: the pre-tokenized hashtags, tagsText and reading are
// derived from post_tags/tags and belong to the index, not to a post. Storage is
// all that pattern would buy here — row addressing, the actual defect #444 was
// about, is what the rowid key (posts.ftsRowid) solves.
export const POSTS_FTS_SQL = `
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
`;

// The posts_fts column list in write order, shared by the migration's reindex and
// the shared record writer's INSERT so the two cannot drift.
export const POSTS_FTS_COLUMNS = 'postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading';
