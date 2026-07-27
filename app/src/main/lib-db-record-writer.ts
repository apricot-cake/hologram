'use strict';

// The shared single-post DB writer (#299 St6): posts + media + post_tags +
// posts_fts for ONE record, extracted out of lib-db-import.ts so every
// producer that turns a PostRecordInput into DB rows — the legacy sidecar
// importer (lib-db-import.ts), the inbox consumer (lib-db-inbox.ts), and the
// app-internal import-posts/import-images handlers (ipc-transfer.ts) — shares
// one column list and one write order instead of three drifting copies.
//
// Electron-free (better-sqlite3 + node builtins only), mirroring lib-db.ts /
// lib-db-import.ts, so it unit-tests in plain node.
//
// This module writes ONLY the post-record tables. It does not open a
// transaction itself — callers that need post+media+post_tags+FTS (+ an
// inbox_events receipt, for the inbox consumer) to commit or roll back
// together wrap writePost() in their own sqlite.exec('BEGIN')/COMMIT.

import { normalizePostRecord } from '../../../native-host/post-record.mts';
import type Database from 'better-sqlite3';
import type { PostRecordInput, PostRecordShape } from '../../../native-host/post-record.mts';

function toDbBool(v: boolean | null): number | null {
  return v == null ? null : v ? 1 : 0;
}

// captureId first, sourceMtimeMs last: both are handled outside normalizePostRecord
// (captureId is the one field every producer supplies itself; sourceMtimeMs is a
// sidecar-file-scan bookkeeping value the inbox/import-posts/import-images
// producers don't have — they pass null, same as any post-#298 write path).
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
  'capturedVia',
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
    video: n.video,
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
    capturedVia: n.capturedVia,
    sourceMtimeMs,
  };
  return POST_COLUMNS.map((c) => byName[c]);
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
    insertMedia: sqlite.prepare('INSERT INTO media (postId, seq, url, alt, width, height, file, type, posterFile) VALUES (?,?,?,?,?,?,?,?,?)'),
    deletePostTags: sqlite.prepare('DELETE FROM post_tags WHERE postId = ?'),
    insertPostTag: sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)'),
    deleteFts: sqlite.prepare('DELETE FROM posts_fts WHERE postId = ?'),
    insertFts: sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    deletePost: sqlite.prepare('DELETE FROM posts WHERE captureId = ?'),
  };
}

// Writes (or overwrites) everything derived from ONE record: the posts row,
// its media rows, its tag junction rows, and its FTS row. Tag NAMES are
// resolved to ids via resolveTagId (get-or-create — tags are never wiped, see
// lib-db-import.ts's module comment for why). sourceMtimeMs (#297) records
// the sidecar file's mtime this write was derived from, for callers that
// track it (the legacy sidecar importer); every other producer passes null.
function writePost(stmts: PostStmts, resolveTagId: (name: string) => number, rec: PostRecordInput, sourceMtimeMs: number | null = null): PostRecordShape {
  const n = normalizePostRecord(rec);
  stmts.upsertPost.run(...postParams(n, sourceMtimeMs));
  stmts.deleteMedia.run(n.captureId);
  n.media.forEach((m, seq) => stmts.insertMedia.run(n.captureId, seq, m.url, m.alt, m.width, m.height, m.file, m.type, m.posterFile));
  stmts.deletePostTags.run(n.captureId);
  const tagIds = n.tags.map(resolveTagId);
  for (const tagId of tagIds) stmts.insertPostTag.run(n.captureId, tagId);
  stmts.deleteFts.run(n.captureId);
  stmts.insertFts.run(n.captureId, n.text, n.title, n.displayName, n.screenName, n.eagleName, n.description, n.hashtags.join(' '), n.tags.join(' '), null);
  return n;
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

export { POST_COLUMNS, UPSERT_POST_SQL, postParams, preparePostStmts, writePost, makeTagResolver, toDbBool };
export type { PostStmts };
