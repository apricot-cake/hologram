'use strict';

// #21: the tag-vocabulary read/write layer behind the tag management page --
// overview (list + usage counts + parent edges), rename (with the confirmed
// 2-way collision branch: merge / keep-separate-with-required-display-parent),
// merge, parent-relationship CRUD (cycle-checked), orphan cleanup, and the
// row-scoped kind write the page's reused KindMenu needs (NOT the legacy
// name-keyed replaceTagTypes in lib-db-write.ts -- that whole-map replace
// silently drops one same-name entity's kind whenever two tags share a name,
// which #21's own entities make possible; this module updates one row by id).
//
// Every write here mutates the tags/tag_parents/post_tags/poster_tags tables
// AND sweeps the query-leaf tagId references those changes could orphan
// (folders.tree, tabs.state -- lib-tag-tree-sweep.ts) inside the SAME
// transaction, per the 2026-07-19/07-23 design comments' confirmed write order:
// post junction -> poster junction -> parent edges -> query leaves -> alias
// repoint (#86) -> entity delete.
//
// #86 (tag aliases): addTagAlias/removeTagAlias/listTagAliases below are the
// tag_aliases CRUD; the actual apply-time resolution (an alias redirects a
// write to its canonical tag) lives in the two get-or-create resolvers this
// module does NOT own -- lib-db-write.ts's tagResolver and
// lib-db-record-writer.ts's makeTagResolver -- since those are the confirmed
// "single gate" every tag write (post/poster/import) already passes through.
//
// Precedence decision (the schema DDL comment's flagged open question,
// resolved here 2026-08-03): an alias and a real tag name share ONE
// namespace. addTagAlias refuses an alias string that already names a real
// tag (findCollision reuse), and renameTag/keepSeparateRename refuse a new
// name that is already registered as someone else's alias (aliasCollision) --
// symmetric guards, so a string can never simultaneously BE a tag's name and
// point away from it as an alias. Given that invariant, a write-path lookup
// checking tag_aliases before the tags table is unambiguous and needs no
// separate "which wins" rule at read time.

import type Database from 'better-sqlite3';
import { normalizeTagName } from '../../../native-host/tag-normalize.mts';
import { sweepFoldersAndTabs } from './lib-tag-tree-sweep.ts';

type Sqlite = Database.Database;

export interface TagParentEdge {
  id: number;
  name: string;
  isDisplay: boolean;
}

export interface TagVocabRow {
  id: number;
  name: string;
  kind: string | null;
  reading: string | null;
  postCount: number;
  posterCount: number;
  parents: TagParentEdge[];
  /** name, or "name(displayParentName)" when a display parent is set (2026-07-18 comment). */
  displayName: string;
  /** Another tag's tag_parents row points at this one -- deleting it would sever that edge. */
  isReferencedAsParent: boolean;
  /** postCount === 0 && posterCount === 0 && !isReferencedAsParent (#315: no group axis in this definition any more). */
  isOrphan: boolean;
}

function countsByTag(sqlite: Sqlite, table: string): Map<number, number> {
  const sql = 'SELECT tagId, COUNT(*) AS c FROM ' + table + ' GROUP BY tagId';
  const rows = sqlite.prepare(sql).all() as Array<{ tagId: number; c: number }>;
  return new Map(rows.map((r) => [r.tagId, r.c]));
}

export function tagVocabOverview(sqlite: Sqlite): TagVocabRow[] {
  const tags = sqlite.prepare('SELECT id, name, kind, reading FROM tags ORDER BY id').all() as Array<{ id: number; name: string; kind: string | null; reading: string | null }>;
  const nameById = new Map(tags.map((t) => [t.id, t.name]));
  const postCounts = countsByTag(sqlite, 'post_tags');
  const posterCounts = countsByTag(sqlite, 'poster_tags');
  const parentRows = sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents').all() as Array<{ tagId: number; parentTagId: number; isDisplay: number }>;
  const parentsByTag = new Map<number, TagParentEdge[]>();
  const referencedAsParent = new Set<number>();
  for (const r of parentRows) {
    referencedAsParent.add(r.parentTagId);
    const list = parentsByTag.get(r.tagId) || [];
    list.push({ id: r.parentTagId, name: nameById.get(r.parentTagId) || '', isDisplay: !!r.isDisplay });
    parentsByTag.set(r.tagId, list);
  }
  return tags.map((t) => {
    const postCount = postCounts.get(t.id) || 0;
    const posterCount = posterCounts.get(t.id) || 0;
    const parents = (parentsByTag.get(t.id) || []).slice().sort((a, b) => Number(b.isDisplay) - Number(a.isDisplay) || a.name.localeCompare(b.name));
    const displayParent = parents.find((p) => p.isDisplay);
    const isReferencedAsParent = referencedAsParent.has(t.id);
    const displayName = displayParent ? t.name + '(' + displayParent.name + ')' : t.name;
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      reading: t.reading,
      postCount,
      posterCount,
      parents,
      displayName,
      isReferencedAsParent,
      isOrphan: postCount === 0 && posterCount === 0 && !isReferencedAsParent,
    };
  });
}

// Every (tagId, parentTagId) edge, name-resolved -- the left-column
// "parent-child" view's full list (2026-07-19 comment: one list backs both the
// standalone view and a single tag row's "set parent tag..." filtered to that tag).
export interface TagParentRowResolved {
  tagId: number;
  tagName: string;
  parentTagId: number;
  parentName: string;
  isDisplay: boolean;
}
export function tagParentEdges(sqlite: Sqlite): TagParentRowResolved[] {
  const sql = 'SELECT tp.tagId AS tagId, tc.name AS tagName, tp.parentTagId AS parentTagId, tpar.name AS parentName, tp.isDisplay AS isDisplay ' + 'FROM tag_parents tp JOIN tags tc ON tc.id = tp.tagId JOIN tags tpar ON tpar.id = tp.parentTagId ' + 'ORDER BY tc.name, tpar.name';
  const rows = sqlite.prepare(sql).all() as Array<{ tagId: number; tagName: string; parentTagId: number; parentName: string; isDisplay: number }>;
  return rows.map((r) => ({ tagId: r.tagId, tagName: r.tagName, parentTagId: r.parentTagId, parentName: r.parentName, isDisplay: !!r.isDisplay }));
}

// Walking UP from `fromId` through existing tag_parents edges, would we ever
// reach `targetId`? Used to reject an edge tagId->parentTagId when parentTagId
// (or one of its ancestors) is already tagId -- i.e. the new edge would close a
// loop. Self-edges (fromId===targetId on the first call) are caught by the
// caller before this runs.
function ancestorReaches(sqlite: Sqlite, fromId: number, targetId: number): boolean {
  const parentsOf = sqlite.prepare('SELECT parentTagId FROM tag_parents WHERE tagId = ?');
  const seen = new Set<number>();
  let frontier = [fromId];
  while (frontier.length) {
    const next: number[] = [];
    for (const id of frontier) {
      if (id === targetId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const row of parentsOf.all(id) as Array<{ parentTagId: number }>) next.push(row.parentTagId);
    }
    frontier = next;
  }
  return false;
}

/** True if tagId -> parentTagId would create a cycle (self-edge counts). */
export function wouldCreateCycle(sqlite: Sqlite, tagId: number, parentTagId: number): boolean {
  if (tagId === parentTagId) return true;
  return ancestorReaches(sqlite, parentTagId, tagId);
}

function tagExists(sqlite: Sqlite, id: number): boolean {
  return !!sqlite.prepare('SELECT 1 FROM tags WHERE id = ?').get(id);
}

// Upserts one tag_parents edge. When isDisplay is requested, first clears any
// OTHER display row this tag already has (idx_tag_parents_display allows only
// one) -- done as a separate statement so the partial unique index never sees
// two isDisplay=1 rows for the same tagId even transiently.
function upsertTagParent(sqlite: Sqlite, tagId: number, parentTagId: number, isDisplay: boolean) {
  if (isDisplay) sqlite.prepare('UPDATE tag_parents SET isDisplay = 0 WHERE tagId = ? AND isDisplay = 1 AND parentTagId != ?').run(tagId, parentTagId);
  sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?) ON CONFLICT(tagId, parentTagId) DO UPDATE SET isDisplay = excluded.isDisplay').run(tagId, parentTagId, isDisplay ? 1 : 0);
}

export type TagWriteResult = { ok: true } | { ok: false; error: string };

export function addTagParent(sqlite: Sqlite, tagId: number, parentTagId: number, isDisplay: boolean): TagWriteResult {
  if (!tagExists(sqlite, tagId) || !tagExists(sqlite, parentTagId)) return { ok: false, error: 'not-found' };
  if (wouldCreateCycle(sqlite, tagId, parentTagId)) return { ok: false, error: 'cycle' };
  upsertTagParent(sqlite, tagId, parentTagId, isDisplay);
  return { ok: true };
}

export function removeTagParent(sqlite: Sqlite, tagId: number, parentTagId: number): TagWriteResult {
  sqlite.prepare('DELETE FROM tag_parents WHERE tagId = ? AND parentTagId = ?').run(tagId, parentTagId);
  return { ok: true };
}

// #157 preempt (2026-07-19 comment): a row-scoped kind write, NOT
// lib-db-write.ts's replaceTagTypes (that one keys by NAME and wholesale-resets
// every tag's kind from a {name: kind} map -- the wrong shape once two entities
// can share a name). Reuses the existing kind-menu UI; this is just its wire.
export function setTagKind(sqlite: Sqlite, tagId: number, kind: string | null): TagWriteResult {
  if (!tagExists(sqlite, tagId)) return { ok: false, error: 'not-found' };
  sqlite.prepare('UPDATE tags SET kind = ? WHERE id = ?').run(kind, tagId);
  return { ok: true };
}

function findCollision(sqlite: Sqlite, tagId: number, name: string): number | null {
  const row = sqlite.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(name, tagId) as { id: number } | undefined;
  return row ? row.id : null;
}

// #86: true if `name` is already registered as an alias (of ANY tag) -- the
// other half of the shared-namespace invariant addTagAlias's own
// name-collision check enforces (see the header comment's precedence note).
function aliasCollision(sqlite: Sqlite, name: string): boolean {
  return !!sqlite.prepare('SELECT 1 FROM tag_aliases WHERE alias = ?').get(name);
}

export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
export type RenameResult = { ok: true } | { ok: false; error: 'empty' | 'alias-collision' } | { ok: false; collision: RenameCollision };

// Plain rename -- the no-collision path. A collision (another tag entity
// already has this exact name) is reported back rather than applied; the
// caller resolves it via mergeTags or keepSeparateRename (2026-07-18 confirmed
// 2-way branch: same-name entities are legitimate under the ID-entity model,
// so "rename into an existing name" is no longer an automatic error).
export function renameTag(sqlite: Sqlite, tagId: number, newName: string): RenameResult {
  const name = normalizeTagName(newName) || newName.trim();
  if (!name) return { ok: false, error: 'empty' };
  const collisionId = findCollision(sqlite, tagId, name);
  if (collisionId != null) {
    const p = sqlite.prepare('SELECT COUNT(*) AS c FROM post_tags WHERE tagId = ?').get(collisionId) as { c: number };
    const u = sqlite.prepare('SELECT COUNT(*) AS c FROM poster_tags WHERE tagId = ?').get(collisionId) as { c: number };
    return { ok: false, collision: { tagId: collisionId, name, postCount: p.c, posterCount: u.c } };
  }
  if (aliasCollision(sqlite, name)) return { ok: false, error: 'alias-collision' };
  sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, tagId);
  return { ok: true };
}

// The "keep separate" branch: rename anyway, requiring a display parent (the
// UI must not let the user create a parentless same-name pair -- 2026-07-18
// comment item 2) so the two same-named tags stay distinguishable on sight.
export function keepSeparateRename(sqlite: Sqlite, tagId: number, newName: string, displayParentTagId: number): TagWriteResult {
  const name = normalizeTagName(newName) || newName.trim();
  if (!name) return { ok: false, error: 'empty' };
  if (!displayParentTagId) return { ok: false, error: 'parent-required' };
  if (!tagExists(sqlite, displayParentTagId)) return { ok: false, error: 'not-found' };
  if (wouldCreateCycle(sqlite, tagId, displayParentTagId)) return { ok: false, error: 'cycle' };
  if (aliasCollision(sqlite, name)) return { ok: false, error: 'alias-collision' };
  const tx = sqlite.transaction(() => {
    sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, tagId);
    upsertTagParent(sqlite, tagId, displayParentTagId, true);
  });
  tx();
  return { ok: true };
}

// --- tag_aliases CRUD (#86) --------------------------------------------------
export interface TagAliasRow {
  id: number;
  alias: string;
  tagId: number;
  canonicalName: string;
}

export function listTagAliases(sqlite: Sqlite): TagAliasRow[] {
  const sql = 'SELECT ta.id AS id, ta.alias AS alias, ta.tagId AS tagId, t.name AS canonicalName FROM tag_aliases ta JOIN tags t ON t.id = ta.tagId ORDER BY ta.alias';
  return sqlite.prepare(sql).all() as TagAliasRow[];
}

export type AddTagAliasResult = { ok: true; id: number } | { ok: false; error: 'empty' | 'not-found' | 'self' | 'name-collision' | 'conflict' };

// Registers `aliasRaw` (NFKC + trim, #197) as an alternate spelling of tagId.
// Guards (in order): the alias must resolve to non-empty text; the target tag
// must exist; the alias must not equal the target's OWN current name (a
// self-alias is a no-op, not a real registration); the alias must not already
// be the exact name of a DIFFERENT real tag (the shared-namespace invariant --
// use mergeTags for that case instead of silently shadowing an existing
// entity); and if the alias text is already registered, this call is
// idempotent when it already points at the same tag, otherwise it is a
// conflict (two tags cannot both claim the same alias spelling). There is no
// separate "reject a cycle" check beyond these: aliases resolve to a tag id in
// a single hop (never chain through another alias row), so a multi-node loop
// cannot form structurally once the two collision guards above hold.
//
// excludeTagId: internal-only, used by mergeTags' keepOldNameAsAlias step. The
// text being registered there is literally the SOURCE tag's own (still
// undeleted, mid-transaction) name, which would otherwise self-collide against
// its own row every single time -- excluding it from the name-collision
// lookup is what lets that step ever succeed. Every other caller (the IPC
// handler included) leaves this unset.
export function addTagAlias(sqlite: Sqlite, tagId: number, aliasRaw: string, excludeTagId?: number): AddTagAliasResult {
  const alias = normalizeTagName(aliasRaw);
  if (!alias) return { ok: false, error: 'empty' };
  const tag = sqlite.prepare('SELECT name FROM tags WHERE id = ?').get(tagId) as { name: string } | undefined;
  if (!tag) return { ok: false, error: 'not-found' };
  if (alias === tag.name) return { ok: false, error: 'self' };
  if (sqlite.prepare('SELECT 1 FROM tags WHERE name = ? AND id != ?').get(alias, excludeTagId ?? -1)) return { ok: false, error: 'name-collision' };
  const existing = sqlite.prepare('SELECT id, tagId FROM tag_aliases WHERE alias = ?').get(alias) as { id: number; tagId: number } | undefined;
  if (existing) return existing.tagId === tagId ? { ok: true, id: existing.id } : { ok: false, error: 'conflict' };
  const id = Number(sqlite.prepare('INSERT INTO tag_aliases (alias, tagId) VALUES (?, ?)').run(alias, tagId).lastInsertRowid);
  return { ok: true, id };
}

export function removeTagAlias(sqlite: Sqlite, aliasId: number): TagWriteResult {
  sqlite.prepare('DELETE FROM tag_aliases WHERE id = ?').run(aliasId);
  return { ok: true };
}

// mergeTags step 5: existing aliases pointing at the about-to-be-deleted
// source must move to target FIRST -- tag_aliases.tagId has ON DELETE CASCADE,
// which would otherwise silently drop them the moment the source row goes
// (the "連鎖の平坦化" the design calls for: an alias never double-hops through
// a merged-away entity). A straggler (the same alias text already pointing at
// target) is dropped rather than left to violate nothing -- the table carries
// no UNIQUE constraint on alias, but two rows saying the same thing is not a
// state worth keeping either.
function repointAliases(sqlite: Sqlite, sourceTagId: number, targetTagId: number): void {
  for (const row of sqlite.prepare('SELECT id, alias FROM tag_aliases WHERE tagId = ?').all(sourceTagId) as Array<{ id: number; alias: string }>) {
    const dup = sqlite.prepare('SELECT 1 FROM tag_aliases WHERE alias = ? AND tagId = ?').get(row.alias, targetTagId);
    if (dup) sqlite.prepare('DELETE FROM tag_aliases WHERE id = ?').run(row.id);
    else sqlite.prepare('UPDATE tag_aliases SET tagId = ? WHERE id = ?').run(targetTagId, row.id);
  }
}

// Merge sourceTagId into targetTagId -- confirmed write order (2026-07-19,
// updated 2026-07-23 to drop the group-membership face #315 retired, 2026-08-03
// to land the alias step): post junction -> poster junction -> parent edges ->
// query leaves -> alias repoint (#86) -> entity delete. Every step is
// dedupe-safe (UPDATE OR IGNORE / ON CONFLICT) since the target may already
// hold some of what the source held.
//
// keepOldNameAsAlias: the rename-collision dialog's "旧名を別名として残す"
// checkbox (mergeTags is reached ONLY from that dialog's merge branch today --
// TagManagementPage.tsx has no standalone "merge these two tags" action). When
// true, source's CURRENT name (read below, before any write touches it -- a
// rename that collides never applies the new name to the source row, see
// renameTag) is registered as an alias of target. Best-effort: a collision
// against some unrelated third tag's name is possible but rare, and should
// not fail a merge the user already confirmed -- addTagAliasImpl's result is
// intentionally not checked.
export function mergeTags(sqlite: Sqlite, sourceTagId: number, targetTagId: number, keepOldNameAsAlias?: boolean): TagWriteResult {
  if (sourceTagId === targetTagId) return { ok: false, error: 'self' };
  const source = sqlite.prepare('SELECT name FROM tags WHERE id = ?').get(sourceTagId) as { name: string } | undefined;
  if (!source || !tagExists(sqlite, targetTagId)) return { ok: false, error: 'not-found' };
  const tx = sqlite.transaction(() => {
    // 1. post_tags: repoint source's rows to target, dropping any that would
    // duplicate a row the target already has (composite PK conflict -> ignore),
    // then delete whatever is left still pointing at source.
    sqlite.prepare('UPDATE OR IGNORE post_tags SET tagId = ? WHERE tagId = ?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM post_tags WHERE tagId = ?').run(sourceTagId);
    // 2. poster_tags, same shape.
    sqlite.prepare('UPDATE OR IGNORE poster_tags SET tagId = ? WHERE tagId = ?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM poster_tags WHERE tagId = ?').run(sourceTagId);
    // 3. parent edges: source-as-child rows move to target-as-child; source-as-parent
    // rows repoint their children to target. Self-loops and any newly-implied cycle
    // are dropped rather than created (falls out of the merge, not a user action to
    // confirm up front -- the 2026-07-19 comment's circular-detection-at-merge-time item).
    for (const row of sqlite.prepare('SELECT parentTagId, isDisplay FROM tag_parents WHERE tagId = ?').all(sourceTagId) as Array<{ parentTagId: number; isDisplay: number }>) {
      if (row.parentTagId === targetTagId) continue;
      upsertTagParent(sqlite, targetTagId, row.parentTagId, !!row.isDisplay);
    }
    for (const row of sqlite.prepare('SELECT tagId, isDisplay FROM tag_parents WHERE parentTagId = ?').all(sourceTagId) as Array<{ tagId: number; isDisplay: number }>) {
      if (row.tagId === targetTagId) continue;
      if (wouldCreateCycle(sqlite, row.tagId, targetTagId)) continue;
      upsertTagParent(sqlite, row.tagId, targetTagId, !!row.isDisplay);
    }
    sqlite.prepare('DELETE FROM tag_parents WHERE tagId = ? OR parentTagId = ?').run(sourceTagId, sourceTagId);
    // 4. query leaves: every saved-search/tab tag leaf pinned to source now
    // points at target (folders.tree + tabs.state -- lib-tag-tree-sweep.ts).
    sweepFoldersAndTabs(sqlite, (id) => (id === sourceTagId ? targetTagId : id));
    // 5. tag_aliases (#86): repoint first (see repointAliases -- must run
    // before the entity delete below, ON DELETE CASCADE would otherwise drop
    // them), then optionally register the pre-merge name itself as an alias.
    repointAliases(sqlite, sourceTagId, targetTagId);
    if (keepOldNameAsAlias) addTagAlias(sqlite, targetTagId, source.name, sourceTagId);
    // 6. the source entity itself. ON DELETE CASCADE mops up any straggler row
    // this function's explicit moves above already emptied.
    sqlite.prepare('DELETE FROM tags WHERE id = ?').run(sourceTagId);
  });
  tx();
  return { ok: true };
}

// #777: the tag-split review screen's data. One row per post carrying
// sourceTagId, with a thumbnail file (media's first row, poster-still for a
// video/ugoira entry, falling back to the post's own screenshot when there is
// no downloaded media at all) and whether that post ALSO carries the
// candidate display-parent tag -- the "共起する表示親タグを持つ投稿が初期選択
// される" acceptance line (2026-08-02 comment): the caller seeds its selection
// set from suggestedToNew, the user only has to flip the exceptions.
export interface TagSplitPost {
  postId: string;
  thumbFile: string | null;
  suggestedToNew: boolean;
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;

export function tagSplitPreview(sqlite: Sqlite, sourceTagId: number, candidateParentTagId: number): TagSplitPost[] {
  const postIds = (sqlite.prepare('SELECT postId FROM post_tags WHERE tagId = ? ORDER BY postId').all(sourceTagId) as Array<{ postId: string }>).map((r) => r.postId);
  if (!postIds.length) return [];
  const placeholders = postIds.map(() => '?').join(',');
  const mediaRows = sqlite.prepare(`SELECT postId, seq, file, posterFile FROM media WHERE postId IN (${placeholders}) ORDER BY postId, seq`).all(...postIds) as Array<{ postId: string; seq: number; file: string | null; posterFile: string | null }>;
  const firstMedia = new Map<string, { file: string | null; posterFile: string | null }>();
  for (const row of mediaRows) if (!firstMedia.has(row.postId)) firstMedia.set(row.postId, row);
  const postRows = sqlite.prepare(`SELECT captureId, image FROM posts WHERE captureId IN (${placeholders})`).all(...postIds) as Array<{ captureId: string; image: string | null }>;
  const imageByPost = new Map(postRows.map((r) => [r.captureId, r.image]));
  const coocRows = sqlite.prepare(`SELECT postId FROM post_tags WHERE tagId = ? AND postId IN (${placeholders})`).all(candidateParentTagId, ...postIds) as Array<{ postId: string }>;
  const coocSet = new Set(coocRows.map((r) => r.postId));
  return postIds.map((postId) => {
    const media = firstMedia.get(postId);
    // posterFile first (a video/gif/ugoira's still), then the media file itself
    // UNLESS it's a raw video (can't be an <img src>) -- mirrors records.ts's
    // artworkFile, reduced to what a review thumbnail needs (no gallery/lightbox
    // branch here).
    let thumbFile: string | null = (media && (media.posterFile || (media.file && !VIDEO_EXT.test(media.file) ? media.file : null))) || null;
    if (!thumbFile) {
      const img = imageByPost.get(postId);
      thumbFile = img && !VIDEO_EXT.test(img) ? img : null;
    }
    return { postId, thumbFile, suggestedToNew: coocSet.has(postId) };
  });
}

export type SplitTagResult = { ok: true; newTagId: number } | { ok: false; error: string };

// The inverse of mergeTags -- but only one face (post_tags), not the six-step
// list merge owns: a split only ever moves a hand-reviewed SUBSET of posts, and
// poster_tags is keyed by posterKey (an account), not by post, so there is
// nothing there for a per-post review to select (#777 scope note -- the
// acceptance criteria and the review screen are both post-only; poster_tags
// stays on the source entity untouched).
//
// Creates a new tag entity sharing sourceTagId's name (the "同名実体" the
// design calls for) and kind (same conceptual entity type; editable after via
// the reused kind-menu), points it at displayParentTagId as its display parent
// (a brand-new tag has no existing edges, so unlike addTagParent this never
// needs a cycle check), then repoints the chosen posts' post_tags rows from
// source to the new id.
export function splitTag(sqlite: Sqlite, sourceTagId: number, displayParentTagId: number, postIdsToNew: string[]): SplitTagResult {
  if (!tagExists(sqlite, sourceTagId) || !tagExists(sqlite, displayParentTagId)) return { ok: false, error: 'not-found' };
  const ids = [...new Set(postIdsToNew.filter((id): id is string => typeof id === 'string' && !!id))];
  if (!ids.length) return { ok: false, error: 'empty-selection' };
  const source = sqlite.prepare('SELECT name, kind FROM tags WHERE id = ?').get(sourceTagId) as { name: string; kind: string | null };
  let newTagId = 0;
  const tx = sqlite.transaction(() => {
    newTagId = Number(sqlite.prepare('INSERT INTO tags (name, kind) VALUES (?, ?)').run(source.name, source.kind).lastInsertRowid);
    upsertTagParent(sqlite, newTagId, displayParentTagId, true);
    const move = sqlite.prepare('UPDATE post_tags SET tagId = ? WHERE tagId = ? AND postId = ?');
    for (const postId of ids) move.run(newTagId, sourceTagId, postId);
  });
  tx();
  return { ok: true, newTagId };
}

export interface DeleteOrphansResult {
  ok: true;
  deletedIds: number[];
}
// Orphan cleanup: deletes the given tagIds that are STILL orphans by the time
// this runs (server-side re-check -- the caller's list is a UI snapshot that
// may be stale), sweeping any query leaf that referenced one of them first.
export function deleteOrphanTags(sqlite: Sqlite, tagIds: number[]): DeleteOrphansResult {
  const requested = new Set(tagIds.filter((id) => Number.isInteger(id)));
  if (!requested.size) return { ok: true, deletedIds: [] };
  const orphanIds = new Set(
    tagVocabOverview(sqlite)
      .filter((r) => r.isOrphan && requested.has(r.id))
      .map((r) => r.id),
  );
  const toDelete = [...orphanIds];
  if (!toDelete.length) return { ok: true, deletedIds: [] };
  const tx = sqlite.transaction(() => {
    sweepFoldersAndTabs(sqlite, (id) => (orphanIds.has(id) ? 'delete' : id));
    const del = sqlite.prepare('DELETE FROM tags WHERE id = ?');
    for (const id of toDelete) del.run(id);
  });
  tx();
  return { ok: true, deletedIds: toDelete };
}
