'use strict';

// DB-backed read path (#5 St4 / #297): reconstructs the sidecar-shaped post
// record array from the tables lib-db-import.ts (#296) writes, and exposes
// the FTS5 free-text search contract lib-db-schema.ts's schema comment
// documents (SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE
// posts_fts MATCH ? ORDER BY rank).
//
// Read-only: this module never writes. postsFromDb()/postsByIds() are the
// mirror image of lib-db-import.ts's writePost() — same column list, same
// media ordering (seq), same tag resolution (post_tags -> tags.name), just
// SELECT instead of INSERT. tagIds accompanies tags as a PARALLEL array
// (same index = same tag) so query.ts's tag leaf can match by id (#5
// 2026-07-18 comment — a rename doesn't change the id) while still falling
// back to name matching for not-yet-migrated saved leaves.
//
// Electron-free (better-sqlite3 + node builtins only), mirroring
// lib-db.ts/lib-db-import.ts, so it unit-tests in plain node. Uses the raw
// sqlite handle (not the Kysely builder) throughout, same as
// lib-db-import.ts's writes — bm25() has no typed Kysely helper, and a
// second query style for the other reads would just be inconsistency.

import type Database from 'better-sqlite3';

const POST_COLUMNS = [
  'captureId',
  'assetClass',
  'mediaType',
  'image',
  'video',
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
  'userKind',
  'tagReviewed',
] as const;

function fromDbBool(v: unknown): boolean | null {
  return v == null ? null : !!v;
}

interface MediaRow {
  postId: string;
  seq: number;
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type: string | null;
  posterFile: string | null;
}
interface TagRow {
  postId: string;
  id: number;
  name: string;
}

// Assembles complete post records from already-fetched `posts` rows plus their
// media/tags, grouped by postId. Shared by postsFromDb (all rows) and
// postsByIds (a captureId subset) so both produce the exact same shape.
function assemble(sqlite: Database.Database, postRows: any[]): any[] {
  if (!postRows.length) return [];
  const ids = postRows.map((r) => r.captureId);
  const placeholders = ids.map(() => '?').join(',');

  const mediaByPost = new Map<string, MediaRow[]>();
  const mediaRows = sqlite.prepare(`SELECT postId, seq, url, alt, width, height, file, type, posterFile FROM media WHERE postId IN (${placeholders}) ORDER BY postId, seq`).all(...ids) as MediaRow[];
  for (const m of mediaRows) {
    let list = mediaByPost.get(m.postId);
    if (!list) mediaByPost.set(m.postId, (list = []));
    list.push(m);
  }

  // rowid = insertion order (post_tags has no explicit seq column — writePost()
  // inserts in the sidecar's original tags[] order, and a plain rowid table
  // preserves that as the read order without needing one).
  const tagsByPost = new Map<string, TagRow[]>();
  const tagRows = sqlite.prepare(`SELECT pt.postId AS postId, t.id AS id, t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId IN (${placeholders}) ORDER BY pt.postId, pt.rowid`).all(...ids) as TagRow[];
  for (const t of tagRows) {
    let list = tagsByPost.get(t.postId);
    if (!list) tagsByPost.set(t.postId, (list = []));
    list.push(t);
  }

  return postRows.map((r) => {
    const media = (mediaByPost.get(r.captureId) || []).map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height, file: m.file, type: m.type, posterFile: m.posterFile }));
    const tags = tagsByPost.get(r.captureId) || [];
    return {
      captureId: r.captureId,
      assetClass: r.assetClass,
      mediaType: r.mediaType,
      image: r.image,
      video: r.video,
      url: r.url,
      platform: r.platform,
      text: r.text,
      title: r.title,
      displayName: r.displayName,
      screenName: r.screenName,
      userId: r.userId,
      avatar: r.avatar,
      avatarFile: r.avatarFile,
      followers: r.followers,
      authorCreatedAt: r.authorCreatedAt,
      likes: r.likes,
      reposts: r.reposts,
      replies: r.replies,
      bookmarks: r.bookmarks,
      views: r.views,
      date: r.date,
      capturedAt: r.capturedAt,
      updatedAt: r.updatedAt,
      lang: r.lang,
      isReply: fromDbBool(r.isReply),
      isQuote: fromDbBool(r.isQuote),
      isThread: fromDbBool(r.isThread),
      quotedUrl: r.quotedUrl,
      replyToId: r.replyToId,
      hashtags: JSON.parse(r.hashtags || '[]'),
      tags: tags.map((t) => t.name),
      tagIds: tags.map((t) => t.id),
      media,
      eagleName: r.eagleName,
      description: r.description,
      source: r.source,
      shotW: r.shotW,
      shotH: r.shotH,
      trashedAt: r.trashedAt,
      userKind: r.userKind,
      tagReviewed: fromDbBool(r.tagReviewed),
    };
  });
}

// Every post, newest capturedAt first — the same ordering lib-index.ts's
// list() returns, so nothing downstream (masonry order, delta bookkeeping)
// needs to know the source moved.
async function postsFromDb(sqlite: Database.Database): Promise<any[]> {
  const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts ORDER BY capturedAt DESC`).all();
  return assemble(sqlite, rows);
}

// A specific captureId subset — the targeted-refresh path (added/updated posts
// from one watch-triggered importChanged batch). No ordering guarantee (the
// caller folds these into a Map, not a rendered list).
async function postsByIds(sqlite: Database.Database, captureIds: string[]): Promise<any[]> {
  if (!captureIds.length) return [];
  const placeholders = captureIds.map(() => '?').join(',');
  const rows = sqlite.prepare(`SELECT ${POST_COLUMNS.join(',')} FROM posts WHERE captureId IN (${placeholders})`).all(...captureIds);
  return assemble(sqlite, rows);
}

// FTS5 free-text search (#5 St4 / #297's query contract): rank is bm25() —
// more negative is more relevant, so plain ascending ORDER BY rank puts the
// best match first (schema comment in lib-db-schema.ts). Not wired into the
// live search UX by this stage (renderer keeps its in-memory fuzzy matcher —
// #29 is the dedicated full-text search UX and is the eventual consumer);
// this is the contract itself, exercised by scripts/test-db-query.cts and the
// bench-baseline.cts DB adapter. A malformed MATCH expression (unbalanced
// quotes, a bare leading operator) throws from better-sqlite3 — caught here
// and treated as "no results" rather than surfaced, since nothing downstream
// yet has a way to show a query-syntax error to the user.
interface FtsHit {
  postId: string;
  rank: number;
}
function searchPostsFts(sqlite: Database.Database, query: string, limit = 200): FtsHit[] {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    return sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank LIMIT ?').all(q, limit) as FtsHit[];
  } catch {
    return [];
  }
}

export { postsFromDb, postsByIds, searchPostsFts, POST_COLUMNS };

// --- #300 (St7) additions: exports these tables have never had a reader for ---
// (tag_parents is dormant schema for #86/#157; capturedVia was added to the
// writer's POST_COLUMNS — lib-db-record-writer.ts — after this file's list was
// last touched, and was never backfilled here.) Kept as a separate export
// statement so the pre-existing four-name export above never needs editing.

interface TagRow2 {
  id: number;
  name: string;
  kind: string | null;
  reading: string | null;
}
// Every tag row, unfiltered (tag-types.json only round-trips tags that have a
// kind; tag-parents.json needs every tag that participates in a parent edge
// regardless of kind).
function tagsFromDb(sqlite: Database.Database): TagRow2[] {
  return sqlite.prepare('SELECT id, name, kind, reading FROM tags ORDER BY id').all() as TagRow2[];
}

interface TagParentRow {
  tagId: number;
  parentTagId: number;
  isDisplay: boolean;
}
function tagParentsFromDb(sqlite: Database.Database): TagParentRow[] {
  return (sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents ORDER BY tagId, parentTagId').all() as Array<{ tagId: number; parentTagId: number; isDisplay: number }>).map((r) => ({
    tagId: r.tagId,
    parentTagId: r.parentTagId,
    isDisplay: !!r.isDisplay,
  }));
}

// Supplemental lookup for the one POST_COLUMNS gap (see module comment above)
// rather than editing POST_COLUMNS/assemble() in place — keeps this file's
// existing read path byte-for-byte unchanged for every other caller.
function postCapturedVia(sqlite: Database.Database, captureIds: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!captureIds.length) return out;
  const placeholders = captureIds.map(() => '?').join(',');
  for (const row of sqlite.prepare(`SELECT captureId, capturedVia FROM posts WHERE captureId IN (${placeholders})`).all(...captureIds) as Array<{ captureId: string; capturedVia: string | null }>) {
    out.set(row.captureId, row.capturedVia);
  }
  return out;
}

export { tagsFromDb, tagParentsFromDb, postCapturedVia };
