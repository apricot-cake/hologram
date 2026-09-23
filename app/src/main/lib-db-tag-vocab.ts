import type { z } from 'zod';
import type { TagVocabRowSchema } from '../shared/data-schemas.ts';
import type Database from 'better-sqlite3';
import { normalizeTagName } from '../../../native-host/tag-normalize.mts';
import { sweepFoldersAndTabs } from './lib-tag-tree-sweep.ts';
import { syncWorkTags } from './lib-tag-classification.ts';

type Sqlite = Database.Database;

export type TagVocabRow = z.output<typeof TagVocabRowSchema>;

function countsByTag(sqlite: Sqlite, table: string): Map<number, number> {
  const sql = 'SELECT tagId, COUNT(*) AS c FROM ' + table + ' GROUP BY tagId';
  const rows = sqlite.prepare(sql).all() as Array<{ tagId: number; c: number }>;
  return new Map(rows.map((r) => [r.tagId, r.c]));
}

export function tagVocabOverview(sqlite: Sqlite): TagVocabRow[] {
  const posts = countsByTag(sqlite, 'post_tags'),
    posters = countsByTag(sqlite, 'poster_tags');
  const tags = sqlite.prepare('SELECT id, name, groupId, reading, category, workId FROM tags ORDER BY name').all() as Array<{ id: number; name: string; groupId: string | null; reading: string | null; category: 'general' | 'work' | 'character'; workId: number | null }>;
  return tags.map((tag) => ({ ...tag, displayName: tag.name, postCount: posts.get(tag.id) || 0, posterCount: posters.get(tag.id) || 0, isOrphan: !posts.has(tag.id) && !posters.has(tag.id) }));
}

function tagExists(sqlite: Sqlite, id: number): boolean {
  return !!sqlite.prepare('SELECT 1 FROM tags WHERE id = ?').get(id);
}

export type TagWriteResult = { ok: true } | { ok: false; error: string };
export function setTagGroup(sqlite: Sqlite, tagId: number, groupId: string | null): TagWriteResult {
  if (!tagExists(sqlite, tagId)) return { ok: false, error: 'not-found' };
  const state = sqlite.prepare("SELECT value FROM store_state WHERE key = 'tagGroupLabels'").get() as { value: string } | undefined;
  const labels = state ? JSON.parse(state.value) : {};
  if (groupId && !Object.hasOwn(labels || {}, groupId)) return { ok: false, error: 'group-not-found' };
  sqlite.prepare('UPDATE tags SET groupId = ? WHERE id = ?').run(groupId, tagId);
  return { ok: true };
}

function findCollision(sqlite: Sqlite, tagId: number, name: string): number | null {
  const row = sqlite.prepare('SELECT id FROM tags WHERE name = ? AND id != ? AND category = (SELECT category FROM tags WHERE id=?) AND workId IS (SELECT workId FROM tags WHERE id=?)').get(name, tagId, tagId, tagId) as { id: number } | undefined;
  return row ? row.id : null;
}

export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
export type RenameResult = { ok: true } | { ok: false; error: 'empty' } | { ok: false; collision: RenameCollision };
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
export function mergeTags(sqlite: Sqlite, sourceTagId: number, targetTagId: number): TagWriteResult {
  if (sourceTagId === targetTagId) return { ok: false, error: 'self' };
  const source = sqlite.prepare('SELECT name FROM tags WHERE id = ?').get(sourceTagId) as { name: string } | undefined;
  if (!source || !tagExists(sqlite, targetTagId)) return { ok: false, error: 'not-found' };
  const compatible = sqlite.prepare('SELECT 1 FROM tags a JOIN tags b ON a.category=b.category AND a.workId IS b.workId WHERE a.id=? AND b.id=?').get(sourceTagId, targetTagId);
  if (!compatible) return { ok: false, error: 'incompatible-classification' };
  const tx = sqlite.transaction(() => {
    sqlite.prepare('UPDATE post_tags SET implied=0 WHERE tagId=? AND postId IN (SELECT postId FROM post_tags WHERE tagId=? AND implied=0)').run(targetTagId, sourceTagId);
    sqlite.prepare('UPDATE OR IGNORE post_tags SET tagId = ? WHERE tagId = ?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM post_tags WHERE tagId = ?').run(sourceTagId);
    sqlite.prepare('UPDATE OR IGNORE poster_tags SET tagId = ? WHERE tagId = ?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM poster_tags WHERE tagId = ?').run(sourceTagId);
    sweepFoldersAndTabs(sqlite, (id) => (id === sourceTagId ? targetTagId : id));
    sqlite.prepare('UPDATE tags SET workId=? WHERE workId=?').run(targetTagId, sourceTagId);
    sqlite.prepare('DELETE FROM tags WHERE id = ?').run(sourceTagId);
    syncWorkTags(sqlite);
  });
  tx();
  return { ok: true };
}

export interface DeleteTagsResult {
  ok: true;
  deletedIds: number[];
}
export function deleteTags(sqlite: Sqlite, tagIds: number[]): DeleteTagsResult {
  const requested = new Set(tagIds.filter((id) => Number.isInteger(id)));
  if (!requested.size) return { ok: true, deletedIds: [] };
  const existingIds = new Set(
    tagVocabOverview(sqlite)
      .filter((r) => requested.has(r.id))
      .map((r) => r.id),
  );
  const toDelete = [...existingIds];
  if (!toDelete.length) return { ok: true, deletedIds: [] };
  const tx = sqlite.transaction(() => {
    sweepFoldersAndTabs(sqlite, (id) => (existingIds.has(id) ? 'delete' : id));
    const del = sqlite.prepare('DELETE FROM tags WHERE id = ?');
    for (const id of toDelete) del.run(id);
    syncWorkTags(sqlite);
  });
  tx();
  return { ok: true, deletedIds: toDelete };
}
