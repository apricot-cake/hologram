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
import type { RawPayloadShape } from '../../../native-host/raw-payload.mts';

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
  'isEdited',
  'editedAt',
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
  'imageIndex',
  'imageCount',
  'domFilled',
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
  frames: string | null; // JSON [{file,delay}] (#119 St3), ugoira rows only
}
interface TagRow {
  postId: string;
  id: number;
  name: string;
}

// The うごイラ frame table comes back out as the array the sidecar carried
// (#119 St3). A row written before the column existed, or one whose JSON no
// longer parses, reads as null — the player then has no timings and falls back
// to the poster, which is the same outcome as an archive that never downloaded.
function parseFrames(raw: string | null): { file: string; delay: number }[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

// posts.hashtags is a JSON string[] column (lib-db-schema.ts). writePost is the
// only writer and always stores a normalized array, so a value that is neither
// is a damaged or foreign database — but this read is the app's ENTIRE post
// list, so an uncaught JSON.parse here would fail the whole library rather than
// one record, and a parsed non-array would reach the renderer's `hashtags.map`
// consumers as something that has no map (#324). Same all-or-nothing shape as
// parseFrames above: unreadable becomes empty, which is what a record whose
// hashtags never arrived already looks like.
function parseHashtags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Assembles complete post records from already-fetched `posts` rows plus their
// media/tags, grouped by postId. Shared by postsFromDb (all rows) and
// postsByIds (a captureId subset) so both produce the exact same shape.
function assemble(sqlite: Database.Database, postRows: any[]): any[] {
  if (!postRows.length) return [];
  const ids = postRows.map((r) => r.captureId);
  const placeholders = ids.map(() => '?').join(',');

  const mediaByPost = new Map<string, MediaRow[]>();
  const mediaRows = sqlite.prepare(`SELECT postId, seq, url, alt, width, height, file, type, posterFile, frames FROM media WHERE postId IN (${placeholders}) ORDER BY postId, seq`).all(...ids) as MediaRow[];
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
    const media = (mediaByPost.get(r.captureId) || []).map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height, file: m.file, type: m.type, posterFile: m.posterFile, frames: parseFrames(m.frames) }));
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
      // #189: platform-reported edit state. Same null-means-no-signal
      // convention as isReply/isQuote/isThread above.
      isEdited: fromDbBool(r.isEdited),
      editedAt: r.editedAt,
      quotedUrl: r.quotedUrl,
      replyToId: r.replyToId,
      hashtags: parseHashtags(r.hashtags),
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
      // #560: the drag save's place in the original post. Read (unlike
      // capturedVia/replaces, which stay writer-only) because the inspector shows
      // it and the export sidecar has to carry it.
      imageIndex: r.imageIndex,
      imageCount: r.imageCount,
      // #202: which fields came from the page rather than the platform API.
      // Read for the same reason imageIndex is — the export sidecar has to
      // carry it, or a ZIP round trip would quietly relabel a page-read value
      // as one the API vouched for. Same JSON string[] storage as hashtags, so
      // the same all-or-nothing parse.
      domFilled: parseHashtags(r.domFilled),
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

// The acquisition originals for a set of posts (#292), keyed by postId and back
// in their wire shape (base64 rather than BLOB) — the export sidecar and the
// inbox envelope are both JSON, so base64 is what crosses any boundary out of
// this database. Ordered by id so an export lists a post's acquisitions in the
// order they were preserved.
//
// Separate from postsFromDb's column list for the same reason postCapturedVia
// is: this is a per-post COLLECTION, not a post column, and the read path that
// feeds the viewer has no use for it (nothing displays originals — #292 leaves
// a disclosure surface out of scope).
function postRawPayloads(sqlite: Database.Database, captureIds: string[]): Map<string, RawPayloadShape[]> {
  const out = new Map<string, RawPayloadShape[]>();
  if (!captureIds.length) return out;
  const placeholders = captureIds.map(() => '?').join(',');
  const rows = sqlite.prepare(`SELECT postId, sourceKind, acquiredAt, contentType, encoding, sha256, byteLength, payload FROM raw_payloads WHERE postId IN (${placeholders}) ORDER BY id`).all(...captureIds) as Array<{
    postId: string;
    sourceKind: string;
    acquiredAt: string;
    contentType: string | null;
    encoding: string;
    sha256: string;
    byteLength: number;
    payload: Buffer | null;
  }>;
  for (const row of rows) {
    const list = out.get(row.postId) || [];
    list.push({
      sourceKind: row.sourceKind,
      acquiredAt: row.acquiredAt,
      contentType: row.contentType,
      encoding: row.encoding,
      sha256: row.sha256,
      byteLength: row.byteLength,
      payloadBase64: row.payload ? Buffer.from(row.payload).toString('base64') : null,
    });
    out.set(row.postId, list);
  }
  return out;
}

export { tagsFromDb, tagParentsFromDb, postCapturedVia, postRawPayloads };
