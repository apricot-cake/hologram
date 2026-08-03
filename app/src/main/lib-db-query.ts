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
  'userKind',
  'tagReviewed',
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

// The ugoira frame table comes back out as the array the sidecar carried
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

// posts.quotedPost/replyToPost (#180) and posts.poll (#179): a JSON object in
// one TEXT column, with the same all-or-nothing read parseFrames above uses --
// a row with none (the overwhelming majority: no quote/renote, no poll, or a
// reply-to on a platform #180's scope excludes) stores NULL and reads back as
// null, and a value
// that no longer parses as an object reads the same way rather than reaching
// the renderer as something its `.text`/`.media`/`.choices` readers can't use.
// One reader for both because the read is identical -- neither shape is
// inspected here beyond "is it still an object".
function parseJsonObject(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// posts.customEmojis (#290): a JSON CustomEmojiShape[] column. Empty-array
// convention like parseHashtags below (not parseJsonObject's null-means-none
// above) -- an empty array and a NULL column mean the exact same "this post
// used no custom emoji" here, same as hashtags/domFilled.
function parseCustomEmojis(raw: unknown): { shortcode: string; url: string; file: string | null }[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((e): e is { shortcode: string; url: string; file: string | null } => !!e && typeof e === 'object' && typeof e.shortcode === 'string' && typeof e.url === 'string') : [];
  } catch {
    return [];
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

// #774: the query-time application of tag parent relationships (#21's confirmed
// 2026-07-18 method -- rules are never burned into post data, so deleting one
// removes its effect from every post at the next read). This builds the two
// lookups a post record's derived tag arrays need, from tag_parents:
//
//   closureOf(id) -- id plus every ancestor reachable by walking tagId ->
//     parentTagId, so a post tagged with a child effectively carries the parent.
//   nameOf(id)    -- the tag's own name.
//   labelOf(id)   -- the display name rule lib-db-tag-vocab.ts's tagVocabOverview
//     uses: "name" normally, "name(displayParentName)" when the tag has an
//     isDisplay parent (the disambiguation two same-named entities get).
//
// Returns null when tag_parents is empty -- the library has no rules, so the
// effective set IS the raw set and assemble() below skips the extra tags-table
// read entirely.
//
// Cycles cannot be written through lib-db-tag-vocab.ts (addTagParent/mergeTags
// both reject them), but a foreign or damaged database could hold one, and this
// runs over the app's ENTIRE post list -- so the walk carries a seen-set and
// terminates with a partial answer rather than hanging the load.
interface TagClosure {
  closureOf(id: number): number[];
  nameOf(id: number): string;
  labelOf(id: number): string;
}
function tagClosureResolver(sqlite: Database.Database): TagClosure | null {
  const edges = sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents').all() as Array<{ tagId: number; parentTagId: number; isDisplay: number }>;
  if (!edges.length) return null;
  const parentsOf = new Map<number, number[]>();
  const displayParentOf = new Map<number, number>();
  for (const e of edges) {
    const list = parentsOf.get(e.tagId);
    if (list) list.push(e.parentTagId);
    else parentsOf.set(e.tagId, [e.parentTagId]);
    if (e.isDisplay) displayParentOf.set(e.tagId, e.parentTagId);
  }
  const nameById = new Map((sqlite.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>).map((t) => [t.id, t.name]));
  const nameOf = (id: number): string => nameById.get(id) || '';
  const labels = new Map<number, string>();
  const labelOf = (id: number): string => {
    const hit = labels.get(id);
    if (hit != null) return hit;
    const dp = displayParentOf.get(id);
    const label = dp != null ? nameOf(id) + '(' + nameOf(dp) + ')' : nameOf(id);
    labels.set(id, label);
    return label;
  };
  // Memoized per tag id: a library has far fewer tags than posts, so every
  // closure is walked once no matter how many posts carry the tag.
  const closures = new Map<number, number[]>();
  const closureOf = (id: number): number[] => {
    const hit = closures.get(id);
    if (hit) return hit;
    const out: number[] = [];
    const seen = new Set<number>();
    let frontier = [id];
    while (frontier.length) {
      const next: number[] = [];
      for (const cur of frontier) {
        if (seen.has(cur)) continue;
        seen.add(cur);
        out.push(cur);
        for (const p of parentsOf.get(cur) || []) next.push(p);
      }
      frontier = next;
    }
    closures.set(id, out);
    return out;
  };
  return { closureOf, nameOf, labelOf };
}

// The effective tag set of ONE tagged thing: the raw tags plus every ancestor
// the tag_parents edges imply, deduped, raw tags first. THREE parallel arrays
// (same index = same tag), the same shape tags/tagIds already are: ids for
// matching (query.ts's tag leaf), names for the value a picked facet row writes
// into a leaf, labels for what that row SHOWS (two same-named entities are only
// told apart by their display parent).
//
// Shared rather than inlined because posters carry tags too (#810): poster_tags
// is a second junction table over the SAME tags/tag_parents, so applying the
// parent relationships there has to mean bit-for-bit what it means for a post —
// two implementations of one derivation would drift into the asymmetry #810 is
// closing. A null closure (no rules in the library) makes the effective set the
// raw set, and the labels the plain names.
interface EffectiveTags {
  effectiveTagIds: number[];
  effectiveTags: string[];
  effectiveTagLabels: string[];
}
function effectiveTagsOf(closure: TagClosure | null, tags: ReadonlyArray<{ id: number; name: string }>): EffectiveTags {
  const effectiveTagIds: number[] = [];
  const effectiveTags: string[] = [];
  const effectiveTagLabels: string[] = [];
  if (!closure) {
    for (const t of tags) {
      effectiveTagIds.push(t.id);
      effectiveTags.push(t.name);
      effectiveTagLabels.push(t.name);
    }
    return { effectiveTagIds, effectiveTags, effectiveTagLabels };
  }
  const seen = new Set<number>();
  for (const t of tags)
    for (const id of closure.closureOf(t.id)) {
      if (seen.has(id)) continue;
      seen.add(id);
      effectiveTagIds.push(id);
      effectiveTags.push(closure.nameOf(id));
      effectiveTagLabels.push(closure.labelOf(id));
    }
  return { effectiveTagIds, effectiveTags, effectiveTagLabels };
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

  const closure = tagClosureResolver(sqlite);

  return postRows.map((r) => {
    const media = (mediaByPost.get(r.captureId) || []).map((m) => ({ url: m.url, alt: m.alt, width: m.width, height: m.height, file: m.file, type: m.type, posterFile: m.posterFile, frames: parseFrames(m.frames) }));
    const tags = tagsByPost.get(r.captureId) || [];
    // #774: the effective tag set (effectiveTagsOf above) -- derived on every
    // SELECT and stored in no table, per #21's 2026-07-18 comment: "the post
    // data is always only what the user tagged".
    const { effectiveTagIds, effectiveTags, effectiveTagLabels } = effectiveTagsOf(closure, tags);
    return {
      captureId: r.captureId,
      assetClass: r.assetClass,
      mediaType: r.mediaType,
      image: r.image,
      video: r.video,
      file: r.file,
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
      // #178: cw is the author's own CW text. sensitive is a definite answer
      // wherever the platform carries the signal (Mastodon/X/Bluesky), not the
      // null-means-no-signal convention above — see PostRecordShape.sensitive.
      cw: r.cw,
      sensitive: fromDbBool(r.sensitive),
      quotedUrl: r.quotedUrl,
      replyToId: r.replyToId,
      // #188: pixiv series membership. Read for the same reason quotedUrl/
      // replyToId are — the inspector shows it and the export sidecar carries it.
      seriesId: r.seriesId,
      seriesTitle: r.seriesTitle,
      seriesOrder: r.seriesOrder,
      hashtags: parseHashtags(r.hashtags),
      tags: tags.map((t) => t.name),
      tagIds: tags.map((t) => t.id),
      // #774 (derived, never stored -- see the effective-set comment above).
      effectiveTagIds,
      effectiveTags,
      effectiveTagLabels,
      media,
      eagleName: r.eagleName,
      memo: r.memo,
      source: r.source,
      shotW: r.shotW,
      shotH: r.shotH,
      // #162: per-record media-size aggregates (dimension/file-size facet).
      // Null on rows written before the add-media-max-dims migration, same
      // as every other column added by a migration nothing backfills.
      mediaMaxW: r.mediaMaxW,
      mediaMaxH: r.mediaMaxH,
      mediaMaxBytes: r.mediaMaxBytes,
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
      // #180: quote/renote and (Misskey-only) reply-to sidecar sub-records.
      // Read for the same reasons quotedUrl/replyToId are — the inspector (once
      // #180's viewer stage lands) and the export sidecar both need them.
      quotedPost: parseJsonObject(r.quotedPost),
      replyToPost: parseJsonObject(r.replyToPost),
      // #179: the post's poll. Read for the inspector's poll card and the
      // export sidecar, the same two consumers quotedPost has.
      poll: parseJsonObject(r.poll),
      // #290: the post's own :shortcode: custom emoji. Read for the inspector
      // (once its display stage lands, per #290's own scope note) and the
      // export sidecar.
      customEmojis: parseCustomEmojis(r.customEmojis),
      // #181: the OGP preview card of a link-share post. Read for the
      // inspector's link-card row and the export sidecar, the same two
      // consumers quotedPost/poll have.
      linkCard: parseJsonObject(r.linkCard),
      // #8: the card image is an animated webp — see lib-card-dims.ts's
      // fillCardDims and records.ts's imgW carve-out (the same treatment a
      // real .gif already gets by extension alone).
      shotAnimated: fromDbBool(r.shotAnimated),
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
// #810: shared with lib-db-write.ts's poster-tag read — see effectiveTagsOf.
export { tagClosureResolver, effectiveTagsOf };
export type { TagClosure, EffectiveTags };

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
