import type Database from 'better-sqlite3';
import { normalizeTagName } from '../../../native-host/tag-normalize.mts';
import type { ClassifiedTagInput, TagAssignment, PortableTagClassification } from '../shared/tag-classification.ts';

/** 自動付与の作品だけを再計算する。手動付与は残す。 */
export function syncWorkTags(db: Database.Database) {
  db.prepare('DELETE FROM post_tags WHERE implied = 1').run();
  db.prepare(`INSERT OR IGNORE INTO post_tags(postId,tagId,implied)
    SELECT pt.postId,t.workId,1 FROM post_tags pt JOIN tags t ON t.id=pt.tagId
    WHERE t.category='character' AND t.workId IS NOT NULL`).run();
}

export function saveClassifiedTag(db: Database.Database, input: ClassifiedTagInput, sync = true): number {
  return db.transaction(() => {
    const name = normalizeTagName(input.name);
    if (!name) throw new Error('empty-name');
    if (input.id && input.id === input.workId) throw new Error('invalid-work');
    if (input.workId !== null && (input.category !== 'character' || !db.prepare("SELECT 1 FROM tags WHERE id=? AND category='work'").get(input.workId))) throw new Error('invalid-work');
    const current = input.id ? db.prepare('SELECT id FROM tags WHERE id=?').get(input.id) : null;
    if (input.id && !current) throw new Error('tag-not-found');
    if (input.id && input.category !== 'work' && db.prepare('SELECT 1 FROM tags WHERE workId=?').get(input.id)) throw new Error('work-has-characters');
    const duplicate = db.prepare('SELECT id FROM tags WHERE name=? AND category=? AND workId IS ? AND id != ?').get(name, input.category, input.workId, input.id ?? -1) as { id: number } | undefined;
    if (duplicate) {
      if (input.id) throw new Error('duplicate-tag');
      return duplicate.id;
    }
    let id = input.id;
    if (id) db.prepare('UPDATE tags SET name=?,category=?,workId=? WHERE id=?').run(name, input.category, input.workId, id);
    else id = Number(db.prepare('INSERT INTO tags(name,category,workId) VALUES(?,?,?)').run(name, input.category, input.workId).lastInsertRowid);
    if (sync) syncWorkTags(db);
    db.prepare('UPDATE posts SET updatedAt=? WHERE captureId IN (SELECT postId FROM post_tags WHERE tagId=?)').run(new Date().toISOString(), id);
    return id;
  })();
}

export function getClassifiedAssignments(db: Database.Database, postIds: string[]): TagAssignment[] {
  const query = db.prepare("SELECT pt.tagId FROM post_tags pt JOIN tags t ON t.id=pt.tagId WHERE pt.postId=? AND pt.implied=0 AND t.category!='general'");
  return postIds.map((postId) => ({ postId, tagIds: (query.all(postId) as { tagId: number }[]).map((r) => r.tagId) }));
}

export function setClassifiedAssignments(db: Database.Database, assignments: TagAssignment[]): void {
  db.transaction(() => {
    for (const { postId, tagIds } of assignments) {
      if (!db.prepare('SELECT 1 FROM posts WHERE captureId=?').get(postId)) throw new Error('post-not-found');
      for (const id of tagIds) if (!db.prepare("SELECT 1 FROM tags WHERE id=? AND category!='general'").get(id)) throw new Error('invalid-tag');
      db.prepare("DELETE FROM post_tags WHERE postId=? AND tagId IN (SELECT id FROM tags WHERE category!='general')").run(postId);
      for (const id of tagIds) db.prepare('INSERT OR IGNORE INTO post_tags(postId,tagId) VALUES(?,?)').run(postId, id);
      db.prepare('UPDATE posts SET updatedAt=? WHERE captureId=?').run(new Date().toISOString(), postId);
    }
    syncWorkTags(db);
  })();
}

export function exportTagClassification(db: Database.Database, postId: string): PortableTagClassification | undefined {
  const tags = db.prepare("SELECT t.name,t.category,w.name AS workName FROM post_tags pt JOIN tags t ON t.id=pt.tagId LEFT JOIN tags w ON w.id=t.workId WHERE pt.postId=? AND pt.implied=0 AND t.category!='general'").all(postId) as PortableTagClassification['tags'];
  if (!tags.length) return undefined;
  const generalTags = (db.prepare("SELECT t.name FROM post_tags pt JOIN tags t ON t.id=pt.tagId WHERE pt.postId=? AND t.category='general'").all(postId) as { name: string }[]).map((row) => row.name);
  return { tags, generalTags };
}

export function importClassifiedTag(db: Database.Database, tag: PortableTagClassification['tags'][number], sync = true): number {
  const workId = tag.workName ? saveClassifiedTag(db, { name: tag.workName, category: 'work', workId: null }, sync) : null;
  return saveClassifiedTag(db, { name: tag.name, category: tag.category, workId }, sync);
}

export function importClassifiedTagVocabulary(db: Database.Database, tags: PortableTagClassification['tags']): void {
  for (const tag of tags) importClassifiedTag(db, tag, false);
  if (tags.length) syncWorkTags(db);
}

export function restoreTagClassification(db: Database.Database, postId: string, value: PortableTagClassification) {
  const ids = value.tags.map((tag) => importClassifiedTag(db, tag));
  db.prepare('DELETE FROM post_tags WHERE postId=?').run(postId);
  for (const name of value.generalTags) {
    const id = saveClassifiedTag(db, { name, category: 'general', workId: null });
    db.prepare('INSERT OR IGNORE INTO post_tags(postId,tagId) VALUES(?,?)').run(postId, id);
  }
  setClassifiedAssignments(db, [{ postId, tagIds: ids }]);
}
