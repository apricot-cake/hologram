'use strict';

// The shared single-post DB writer: posts + media + post_tags + posts_fts for
// ONE record, so every producer that turns a PostRecordInput into DB rows — the
// inbox consumer (lib-db-inbox.ts), the app-internal ZIP/media import handlers
// (ipc-transfer.ts), the complete-ZIP importer (lib-archive.ts) and orphan
// recovery (lib-db-integrity.ts) — shares one column list and one write order
// instead of four drifting copies.
//
// Electron-free (better-sqlite3 + node builtins only), mirroring lib-db.ts, so
// it unit-tests in plain node.
//
// This module writes ONLY the post-record tables. It does not open a
// transaction itself — callers that need post+media+post_tags+FTS (+ an
// inbox_events receipt, for the inbox consumer) to commit or roll back
// together wrap writePost() in their own sqlite.exec('BEGIN')/COMMIT.

import { normalizePostRecord } from '../../../native-host/post-record.mts';
import { normalizeTagName } from '../../../native-host/tag-normalize.mts';
import { POSTS_FTS_COLUMNS } from './lib-db-schema.ts';
import { hasPosterIdentity, posterAppearanceHash, posterInstanceOf, posterKeyOf } from './lib-poster-profile.ts';
import type Database from 'better-sqlite3';
import type { PostRecordInput, PostRecordShape } from '../../../native-host/post-record.mts';

function toDbBool(v: boolean | null): number | null {
  return v == null ? null : v ? 1 : 0;
}

// captureId leads because it is the one field every producer supplies itself,
// outside normalizePostRecord.
const POST_COLUMNS = [
  'captureId',
  'assetClass',
  'mediaType',
  'image',
  'video',
  'file',
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
  'cw',
  'sensitive',
  'quotedUrl',
  'replyToId',
  'seriesId',
  'seriesTitle',
  'seriesOrder',
  'hashtags',
  'eagleName',
  'memo',
  'source',
  'shotW',
  'shotH',
  'mediaMaxW',
  'mediaMaxH',
  'mediaMaxBytes',
  'trashedAt',
  'capturedVia',
  'replaces',
  'imageIndex',
  'imageCount',
  'domFilled',
  'quotedPost',
  'replyToPost',
  'customEmojis',
  'poll',
  'linkCard',
  'shotAnimated',
] as const;

const UPSERT_POST_SQL = `INSERT INTO posts (${POST_COLUMNS.join(',')}) VALUES (${POST_COLUMNS.map(() => '?').join(',')})
  ON CONFLICT(captureId) DO UPDATE SET ${POST_COLUMNS.filter((c) => c !== 'captureId')
    .map((c) => `${c}=excluded.${c}`)
    .join(',')}`;

// Built from named fields (not a positional literal) so a column added to
// POST_COLUMNS and forgotten here fails at the .map(...) below (undefined
// bound param -> better-sqlite3 throws) instead of silently misaligning.
function postParams(n: PostRecordShape): unknown[] {
  const byName: Record<string, unknown> = {
    captureId: n.captureId,
    assetClass: n.assetClass,
    mediaType: n.mediaType,
    image: n.image,
    video: n.video,
    file: n.file,
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
    isEdited: toDbBool(n.isEdited),
    editedAt: n.editedAt,
    cw: n.cw,
    sensitive: toDbBool(n.sensitive),
    quotedUrl: n.quotedUrl,
    replyToId: n.replyToId,
    seriesId: n.seriesId,
    seriesTitle: n.seriesTitle,
    seriesOrder: n.seriesOrder,
    hashtags: JSON.stringify(n.hashtags),
    eagleName: n.eagleName,
    memo: n.memo,
    source: n.source,
    shotW: n.shotW,
    shotH: n.shotH,
    mediaMaxW: n.mediaMaxW,
    mediaMaxH: n.mediaMaxH,
    mediaMaxBytes: n.mediaMaxBytes,
    trashedAt: n.trashedAt,
    capturedVia: n.capturedVia,
    replaces: n.replaces,
    imageIndex: n.imageIndex,
    imageCount: n.imageCount,
    // Same storage as hashtags above: a JSON string[] in one TEXT column (#202).
    domFilled: JSON.stringify(n.domFilled),
    // #180: 0-or-1 sub-record, JSON-serialized like the arrays above; null stays
    // null rather than the string "null" (JSON.stringify(null) === 'null' would
    // read back as a truthy non-empty column) -- lib-db-query.ts's parser
    // treats an empty column as "no sub-record", the same convention parseFrames
    // uses for a missing frame table.
    quotedPost: n.quotedPost ? JSON.stringify(n.quotedPost) : null,
    replyToPost: n.replyToPost ? JSON.stringify(n.replyToPost) : null,
    // #290: JSON string, empty array stored as '[]' rather than null -- unlike
    // quotedPost/replyToPost (a 0-or-1 sub-record where absence IS the
    // meaningful state), an empty customEmojis[] and "no column value" mean the
    // exact same thing here (same reasoning as hashtags/domFilled above, which
    // also never distinguish [] from absent).
    customEmojis: JSON.stringify(n.customEmojis),
    // #179: 0-or-1 sub-structure, so the same null-stays-null rule
    // quotedPost/replyToPost use above (not customEmojis' always-an-array one).
    poll: n.poll ? JSON.stringify(n.poll) : null,
    // #181: 0-or-1 sub-structure, same null-stays-null rule as quotedPost/
    // replyToPost/poll above.
    linkCard: n.linkCard ? JSON.stringify(n.linkCard) : null,
    // #8: 1 when the card image is an animated webp — see lib-card-dims.ts's
    // fillCardDims.
    shotAnimated: toDbBool(n.shotAnimated),
  };
  return POST_COLUMNS.map((c) => byName[c]);
}

interface PostStmts {
  upsertPost: Database.Statement;
  deleteMedia: Database.Statement;
  insertMedia: Database.Statement;
  deletePostTags: Database.Statement;
  insertPostTag: Database.Statement;
  selectFtsRowid: Database.Statement;
  deleteFts: Database.Statement;
  insertFts: Database.Statement;
  claimFtsRowid: Database.Statement;
  deletePost: Database.Statement;
  insertRawPayload: Database.Statement;
  selectPosterProfile: Database.Statement;
  insertPosterProfile: Database.Statement;
  updatePosterProfileCurrent: Database.Statement;
  insertPosterProfileSnapshot: Database.Statement;
}

function preparePostStmts(sqlite: Database.Database): PostStmts {
  return {
    upsertPost: sqlite.prepare(UPSERT_POST_SQL),
    deleteMedia: sqlite.prepare('DELETE FROM media WHERE postId = ?'),
    insertMedia: sqlite.prepare('INSERT INTO media (postId, seq, url, alt, width, height, file, type, posterFile, frames) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    deletePostTags: sqlite.prepare('DELETE FROM post_tags WHERE postId = ?'),
    insertPostTag: sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)'),
    // posts_fts rows are addressed by ROWID, never by the UNINDEXED postId column
    // (#444): FTS5 offers no index but MATCH and rowid, so a WHERE on postId scans
    // the whole index and makes the per-post write cost grow with the library.
    // posts.ftsRowid is that key — see the fts-rowid-addressing migration.
    selectFtsRowid: sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?'),
    deleteFts: sqlite.prepare('DELETE FROM posts_fts WHERE rowid = ?'),
    insertFts: sqlite.prepare(`INSERT INTO posts_fts (rowid, ${POSTS_FTS_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    claimFtsRowid: sqlite.prepare('UPDATE posts SET ftsRowid = ? WHERE captureId = ?'),
    deletePost: sqlite.prepare('DELETE FROM posts WHERE captureId = ?'),
    // OR IGNORE, and no matching DELETE: raw_payloads is append-only (#292 —
    // an original that was preserved once is never dropped by a later write of
    // the same post), and idx_raw_payloads_identity turns a replayed write of
    // the same acquisition into a no-op instead of a duplicate row.
    insertRawPayload: sqlite.prepare('INSERT OR IGNORE INTO raw_payloads (postId, sourceKind, acquiredAt, contentType, encoding, sha256, byteLength, payload) VALUES (?,?,?,?,?,?,?,?)'),
    // #289: poster_profiles/poster_profile_snapshots — see writePosterProfile.
    selectPosterProfile: sqlite.prepare('SELECT contentHash, lastObservedAt FROM poster_profiles WHERE posterKey = ?'),
    insertPosterProfile: sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, userId, instance, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
    updatePosterProfileCurrent: sqlite.prepare('UPDATE poster_profiles SET displayName=?, screenName=?, bio=?, links=?, avatar=?, avatarFile=?, banner=?, bannerFile=?, followers=?, authorCreatedAt=?, contentHash=?, provenance=?, lastObservedAt=? WHERE posterKey=?'),
    // OR IGNORE: idx_poster_profile_snapshots_identity (posterKey, contentHash,
    // observedAt) turns a replayed write of the same observation into a no-op,
    // same convention insertRawPayload above already uses for raw_payloads.
    insertPosterProfileSnapshot: sqlite.prepare('INSERT OR IGNORE INTO poster_profile_snapshots (posterKey, observedAt, displayName, screenName, bio, links, avatar, avatarFile, banner, bannerFile, followers, authorCreatedAt, contentHash, provenance) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
  };
}

// #289: one poster observation per post write, in the SAME transaction the
// caller wraps writePost() in below — the post row and the poster snapshot it
// evidences commit or roll back together, never one without the other.
//
// Skipped entirely for a record with no author identity (hasPosterIdentity) —
// see that function's comment for why a bookmark/platform-less record must
// not fall through to posterKeyOf's hostless fallback key.
function writePosterProfile(stmts: PostStmts, n: PostRecordShape): void {
  if (!hasPosterIdentity(n)) return;
  const posterKey = posterKeyOf(n);
  // links travels as JSON text, same storage convention as hashtags/domFilled
  // — null (not '[]') when the platform/post carries none, so an absent field
  // and an empty list are never confused the way #290's customEmojis note
  // warns against for a DIFFERENT kind of field.
  const links = n.profileLinks && n.profileLinks.length ? JSON.stringify(n.profileLinks) : null;
  const contentHash = posterAppearanceHash({ displayName: n.displayName, screenName: n.screenName, bio: n.bio, links, avatar: n.avatar, avatarFile: n.avatarFile, banner: n.banner, bannerFile: n.bannerFile });
  const provenance = `api:${n.platform || 'unknown'}`;
  const observedAt = n.capturedAt;
  const existing = stmts.selectPosterProfile.get(posterKey) as { contentHash: string; lastObservedAt: string } | undefined;

  if (!existing) {
    stmts.insertPosterProfile.run(posterKey, n.platform, n.userId, posterInstanceOf(n), n.displayName, n.screenName, n.bio, links, n.avatar, n.avatarFile, n.banner, n.bannerFile, n.followers, n.authorCreatedAt, contentHash, provenance, observedAt, observedAt);
    stmts.insertPosterProfileSnapshot.run(posterKey, observedAt, n.displayName, n.screenName, n.bio, links, n.avatar, n.avatarFile, n.banner, n.bannerFile, n.followers, n.authorCreatedAt, contentHash, provenance);
    return;
  }

  // A history row is earned only when the "appearance" hash actually moved —
  // followers/authorCreatedAt intentionally play no part in that comparison
  // (see posterAppearanceHash's own comment).
  if (contentHash !== existing.contentHash) {
    stmts.insertPosterProfileSnapshot.run(posterKey, observedAt, n.displayName, n.screenName, n.bio, links, n.avatar, n.avatarFile, n.banner, n.bannerFile, n.followers, n.authorCreatedAt, contentHash, provenance);
  }
  // #289 design comment #4: a STRICTLY OLDER observation (a replayed inbox
  // segment, a re-imported ZIP carrying an observedAt from before this run)
  // must not rewind the "current" row, even though it still earned a history
  // row above if its content differed from what's there now. Equal
  // timestamps (two posts by the same poster captured in the same
  // millisecond) fall through and DO update current — there is nothing to
  // protect against there.
  if (observedAt < existing.lastObservedAt) return;
  stmts.updatePosterProfileCurrent.run(n.displayName, n.screenName, n.bio, links, n.avatar, n.avatarFile, n.banner, n.bannerFile, n.followers, n.authorCreatedAt, contentHash, provenance, observedAt, posterKey);
}

// Writes (or overwrites) everything derived from ONE record: the posts row,
// its media rows, its tag junction rows, and its FTS row. Tag NAMES are
// resolved to ids via resolveTagId (get-or-create — see makeTagResolver).
function writePost(stmts: PostStmts, resolveTagId: (name: string) => number, rec: PostRecordInput): PostRecordShape {
  const n = normalizePostRecord(rec);
  stmts.upsertPost.run(...postParams(n));
  stmts.deleteMedia.run(n.captureId);
  // frames is the only structured value on a media row — stored as JSON text
  // (see the add-media-frames migration) and re-parsed on read.
  n.media.forEach((m, seq) => stmts.insertMedia.run(n.captureId, seq, m.url, m.alt, m.width, m.height, m.file, m.type, m.posterFile, m.frames ? JSON.stringify(m.frames) : null));
  stmts.deletePostTags.run(n.captureId);
  const tagIds = n.tags.map(resolveTagId);
  for (const tagId of tagIds) stmts.insertPostTag.run(n.captureId, tagId);
  // The FTS row is rewritten wholesale, keeping this post's existing key so
  // posts.ftsRowid stays valid. A post that has none yet (its first write) lets
  // FTS5 allocate one and records it — the upsert above cannot have cleared the
  // column, since ftsRowid is deliberately not in POST_COLUMNS.
  const ftsRowid = (stmts.selectFtsRowid.get(n.captureId) as { ftsRowid: number | null } | undefined)?.ftsRowid ?? null;
  if (ftsRowid != null) stmts.deleteFts.run(ftsRowid);
  const ftsInsert = stmts.insertFts.run(ftsRowid, n.captureId, n.text, n.title, n.displayName, n.screenName, n.eagleName, n.memo, n.hashtags.join(' '), n.tags.join(' '), null, n.cw);
  if (ftsRowid == null) stmts.claimFtsRowid.run(Number(ftsInsert.lastInsertRowid), n.captureId);
  // Acquisition originals (#292), in the SAME transaction the caller opened for
  // the post — the design's "finalize the reference in the same transaction as the post save". A
  // post committed without its originals would be a post whose unrecoverable
  // half was silently discarded.
  for (const r of n.raw) {
    // base64 on the wire (envelopes and export sidecars are JSON), BLOB in the
    // database — this is the one place the two representations meet.
    const payload = r.payloadBase64 ? Buffer.from(r.payloadBase64, 'base64') : null;
    stmts.insertRawPayload.run(n.captureId, r.sourceKind, r.acquiredAt, r.contentType, r.encoding, r.sha256, r.byteLength, payload);
  }
  // #289: the poster-profile snapshot this post's author info evidences, in
  // the same transaction as everything above.
  writePosterProfile(stmts, n);
  return n;
}

// Tags are get-or-create BY NAME, never wiped. Deleting and reinserting a tag
// would mint a new AUTOINCREMENT id and cascade away any tag_parents/tag_aliases
// rows curated against the old one (#86/#157 territory), so once a name has a
// row, that row's id is permanent as far as any producer here is concerned.
//
// resolveTagId normalizes (NFKC + trim, #197) before every lookup/insert — a
// second gate behind normalizePostRecord's (writePost's tags already arrive
// normalized, so this is idempotent there), and the ONLY gate for
// importTagParents below, whose tag-parents.json names never pass through
// normalizePostRecord.
function makeTagResolver(sqlite: Database.Database) {
  const cache = new Map<string, number>();
  for (const row of sqlite.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>) {
    if (!cache.has(row.name)) cache.set(row.name, row.id);
  }
  const insertTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  return function resolveTagId(rawName: string): number {
    const name = normalizeTagName(rawName) || rawName;
    const existing = cache.get(name);
    if (existing != null) return existing;
    const id = Number(insertTag.run(name).lastInsertRowid);
    cache.set(name, id);
    return id;
  };
}

// --- tag_parents write path (#300/St7) -----------------------------------------
// tag_parents (a tag's parent edges + at-most-one display-parent flag, DDL comment
// in lib-db-schema.ts) has no in-app write path yet — it's dormant schema for
// #86/#157. Its only producer today is a complete-export ZIP's library/tag-parents.json
// (lib-archive.ts), a format invented for #300 with no sidecar-era predecessor.
// Shape: { tags: [{ref,name,kind,reading}], parents: [{tagRef,parentRef,isDisplay}] }
// — `ref` is the EXPORTING database's own tags.id, meaningful only within that one
// export (a ZIP is a point-in-time snapshot; no cross-export id space exists).
export interface TagParentsJson {
  tags: Array<{ ref: number; name: string; kind?: string | null; reading?: string | null }>;
  parents: Array<{ tagRef: number; parentRef: number; isDisplay?: boolean }>;
}

// Resolves each exported tag by NAME (resolveTagId — get-or-create, the same resolver
// posts/poster_tags use) and writes the parent edges.
//
// Known limitation, accepted for v1: resolveTagId cannot distinguish two tags that
// share a name but are different entities (exactly the case tag_parents/isDisplay
// exists to disambiguate) — importing into a library that already has a
// same-named-but-different tag will resolve both to the same row. Importing into an
// EMPTY database is unaffected (nothing to collide with), and curating same-name
// entities apart happens directly against the DB (#21 territory), not here.
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

export { POST_COLUMNS, UPSERT_POST_SQL, postParams, preparePostStmts, writePost, makeTagResolver, toDbBool, importTagParents };
export type { PostStmts };
