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
// post junction -> poster junction -> parent edges -> query leaves -> (alias,
// #86, not yet implemented) -> entity delete.

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

export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
export type RenameResult = { ok: true } | { ok: false; error: 'empty' } | { ok: false; collision: RenameCollision };

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
  const tx = sqlite.transaction(() => {
    sqlite.prepare('UPDATE tags SET name = ? WHERE id = ?').run(name, tagId);
    upsertTagParent(sqlite, tagId, displayParentTagId, true);
  });
  tx();
  return { ok: true };
}

// Merge sourceTagId into targetTagId -- confirmed write order (2026-07-19,
// updated 2026-07-23 to drop the group-membership face #315 retired):
// post junction -> poster junction -> parent edges -> query leaves ->
// (alias, #86, not implemented) -> entity delete. Every step is dedupe-safe
// (UPDATE OR IGNORE / ON CONFLICT) since the target may already hold some of
// what the source held.
export function mergeTags(sqlite: Sqlite, sourceTagId: number, targetTagId: number): TagWriteResult {
  if (sourceTagId === targetTagId) return { ok: false, error: 'self' };
  if (!tagExists(sqlite, sourceTagId) || !tagExists(sqlite, targetTagId)) return { ok: false, error: 'not-found' };
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
    // 5. alias face (#86) intentionally not touched -- not yet implemented.
    // 6. the source entity itself. ON DELETE CASCADE mops up any straggler row
    // this function's explicit moves above already emptied.
    sqlite.prepare('DELETE FROM tags WHERE id = ?').run(sourceTagId);
  });
  tx();
  return { ok: true };
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
