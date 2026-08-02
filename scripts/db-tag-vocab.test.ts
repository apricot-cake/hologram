// Unit tests for #21's tag-vocabulary write layer (app/src/main/lib-db-tag-vocab.ts)
// and its query-leaf sweep (app/src/main/lib-tag-tree-sweep.ts). Seeds tables
// directly via SQL (tag_parents/folders/tabs are dormant-until-now schema — same
// approach as scripts/db-query-tagparents.test.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { addTagParent, deleteOrphanTags, keepSeparateRename, mergeTags, removeTagParent, renameTag, setTagKind, tagParentEdges, tagVocabOverview, wouldCreateCycle } from '../app/src/main/lib-db-tag-vocab';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
function insTag(name: string, kind: string | null = null, reading: string | null = null): number {
  return Number(handle.sqlite.prepare('INSERT INTO tags (name, kind, reading) VALUES (?, ?, ?)').run(name, kind, reading).lastInsertRowid);
}
function insPost(id: string) {
  handle.sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES (?, ?, ?)').run(id, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
}
function tagPost(postId: string, tagId: number) {
  handle.sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?, ?)').run(postId, tagId);
}
function tagPoster(posterKey: string, tagId: number) {
  handle.sqlite.prepare('INSERT INTO poster_tags (posterKey, tagId) VALUES (?, ?)').run(posterKey, tagId);
}
function addParentRow(tagId: number, parentTagId: number, isDisplay = false) {
  handle.sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)').run(tagId, parentTagId, isDisplay ? 1 : 0);
}

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-db-tag-vocab-'), 'test.db'));
});
afterEach(() => {
  handle.sqlite.close();
});
describe('tagVocabOverview', () => {
  test('post/poster counts, displayName, isReferencedAsParent, isOrphan', () => {
    const workId = insTag('touhou', 'work');
    const aliceId = insTag('alice', 'character');
    const orphanId = insTag('unused', 'character');
    addParentRow(aliceId, workId, true);
    insPost('p1');
    tagPost('p1', aliceId);
    tagPoster('poster-1', aliceId);

    const rows = tagVocabOverview(handle.sqlite);
    const alice = rows.find((r) => r.id === aliceId);
    if (!alice) throw new Error('expected the alice row to exist');
    expect(alice.postCount).toBe(1);
    expect(alice.posterCount).toBe(1);
    expect(alice.displayName).toBe('alice(touhou)');
    expect(alice.isOrphan).toBe(false);

    const work = rows.find((r) => r.id === workId);
    if (!work) throw new Error('expected the work row to exist');
    expect(work.postCount).toBe(0);
    expect(work.isReferencedAsParent).toBe(true);
    expect(work.isOrphan).toBe(false); // referenced as a parent -> not an orphan despite 0 direct usage

    const orphan = rows.find((r) => r.id === orphanId);
    if (!orphan) throw new Error('expected the orphan row to exist');
    expect(orphan.isOrphan).toBe(true);
  });
});

describe('wouldCreateCycle / addTagParent', () => {
  test('rejects a self-edge and a transitive cycle; accepts a valid edge', () => {
    const a = insTag('a');
    const b = insTag('b');
    const c = insTag('c');
    expect(wouldCreateCycle(handle.sqlite, a, a)).toBe(true);
    expect(addTagParent(handle.sqlite, a, a, false)).toEqual({ ok: false, error: 'cycle' });

    expect(addTagParent(handle.sqlite, a, b, false)).toEqual({ ok: true }); // a -> b
    expect(addTagParent(handle.sqlite, b, c, false)).toEqual({ ok: true }); // b -> c (a -> b -> c)
    // c -> a would close the loop a -> b -> c -> a.
    expect(wouldCreateCycle(handle.sqlite, c, a)).toBe(true);
    expect(addTagParent(handle.sqlite, c, a, false)).toEqual({ ok: false, error: 'cycle' });
  });

  test('isDisplay upsert clears any other display row for the same tag (partial unique index)', () => {
    const child = insTag('child');
    const p1 = insTag('p1');
    const p2 = insTag('p2');
    expect(addTagParent(handle.sqlite, child, p1, true)).toEqual({ ok: true });
    expect(addTagParent(handle.sqlite, child, p2, true)).toEqual({ ok: true }); // should not throw the unique-index violation
    const edges = tagParentEdges(handle.sqlite).filter((e) => e.tagId === child);
    expect(edges.filter((e) => e.isDisplay)).toHaveLength(1);
    expect(edges.find((e) => e.isDisplay)?.parentTagId).toBe(p2);
    expect(edges).toHaveLength(2); // p1 kept as a non-display parent
  });

  test('removeTagParent deletes exactly the given edge', () => {
    const child = insTag('child');
    const parent = insTag('parent');
    addTagParent(handle.sqlite, child, parent, false);
    expect(removeTagParent(handle.sqlite, child, parent)).toEqual({ ok: true });
    expect(tagParentEdges(handle.sqlite)).toHaveLength(0);
  });
});

describe('renameTag / keepSeparateRename', () => {
  test('plain rename with no collision', () => {
    const id = insTag('old-name');
    expect(renameTag(handle.sqlite, id, 'new-name')).toEqual({ ok: true });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === id)?.name).toBe('new-name');
  });

  test('collision reports the other entity instead of applying', () => {
    const a = insTag('alice');
    const b = insTag('bob');
    insPost('p1');
    tagPost('p1', a);
    const result = renameTag(handle.sqlite, b, 'alice');
    expect(result.ok).toBe(false);
    if (!result.ok && 'collision' in result) {
      expect(result.collision.tagId).toBe(a);
      expect(result.collision.postCount).toBe(1);
    } else {
      throw new Error('expected a collision result');
    }
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === b)?.name).toBe('bob'); // untouched
  });

  test('keepSeparateRename requires a valid, non-cyclic display parent', () => {
    const b = insTag('bob');
    expect(keepSeparateRename(handle.sqlite, b, 'alice', 0)).toEqual({ ok: false, error: 'parent-required' });
    const work = insTag('touhou');
    expect(keepSeparateRename(handle.sqlite, b, 'alice', work)).toEqual({ ok: true });
    const row = tagVocabOverview(handle.sqlite).find((r) => r.id === b);
    if (!row) throw new Error('expected the row to exist');
    expect(row.name).toBe('alice');
    expect(row.displayName).toBe('alice(touhou)');
  });
});

describe('mergeTags', () => {
  test('moves post/poster tags, parent edges, and query leaves; drops the source entity', () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    const work = insTag('touhou');
    const other = insTag('other-work');
    addParentRow(source, work, true); // source's display parent moves to target
    addParentRow(other, source, false); // other's parent (source) repoints to target
    insPost('p1');
    insPost('p2');
    tagPost('p1', source);
    tagPost('p2', target); // target already has p2 -> the source->target move for p2 would collide if source also tagged p2 (not the case here)
    tagPoster('poster-1', source);

    // Query leaves referencing `source`: a dynamic folder and a saved tab.
    const tree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'tag', tagId: source, value: 'alice-dup' }] };
    handle.sqlite.prepare("INSERT INTO folders (id, name, kind, tree) VALUES ('f1', 'Dynamic', 'dynamic', ?)").run(JSON.stringify(tree));
    const tabState = { view: { tree: JSON.parse(JSON.stringify(tree)) }, nav: { hist: [{ kind: 'posts', state: { tree: JSON.parse(JSON.stringify(tree)) } }], idx: 0 } };
    handle.sqlite.prepare("INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES ('t1', 'main', 0, 0, NULL, ?)").run(JSON.stringify(tabState));

    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });

    const rows = tagVocabOverview(handle.sqlite);
    expect(rows.find((r) => r.id === source)).toBeUndefined(); // source entity gone

    const targetRow = rows.find((r) => r.id === target);
    if (!targetRow) throw new Error('expected the target row to exist');
    expect(targetRow.postCount).toBe(2); // p1 (moved) + p2 (already there)
    expect(targetRow.posterCount).toBe(1);
    expect(targetRow.parents.find((p) => p.id === work)?.isDisplay).toBe(true); // source's display parent inherited

    const otherRow = rows.find((r) => r.id === other);
    if (!otherRow) throw new Error('expected the other row to exist');
    expect(otherRow.parents.map((p) => p.id)).toEqual([target]); // other's parent repointed from source to target

    const folderTree = JSON.parse((handle.sqlite.prepare("SELECT tree FROM folders WHERE id = 'f1'").get() as { tree: string }).tree);
    expect(folderTree.children[0].tagId).toBe(target);

    const tabRow = JSON.parse((handle.sqlite.prepare("SELECT state FROM tabs WHERE id = 't1'").get() as { state: string }).state);
    expect(tabRow.view.tree.children[0].tagId).toBe(target);
    expect(tabRow.nav.hist[0].state.tree.children[0].tagId).toBe(target);
  });

  test('drops a self-loop / would-be cycle rather than creating one', () => {
    const source = insTag('src');
    const target = insTag('tgt');
    const grandparent = insTag('gp');
    addParentRow(target, grandparent, false); // target -> gp
    addParentRow(grandparent, source, false); // gp -> source (so source is an ancestor of target already)
    // Remapping gp's parent (source) to target would close target -> gp -> target.
    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });
    const edges = tagParentEdges(handle.sqlite);
    expect(edges.some((e) => e.tagId === grandparent && e.parentTagId === target)).toBe(false); // dropped, not created
  });
});

describe('setTagKind', () => {
  test('updates exactly the given entity, leaving a same-name sibling untouched', () => {
    const a = insTag('alice', 'character');
    const b = insTag('alice', 'character'); // a distinct entity, same name
    expect(setTagKind(handle.sqlite, a, 'work')).toEqual({ ok: true });
    const rows = tagVocabOverview(handle.sqlite);
    expect(rows.find((r) => r.id === a)?.kind).toBe('work');
    expect(rows.find((r) => r.id === b)?.kind).toBe('character');
  });
});

describe('deleteOrphanTags', () => {
  test('deletes only true orphans and sweeps referencing query leaves', () => {
    const orphan = insTag('stray');
    const used = insTag('used');
    insPost('p1');
    tagPost('p1', used);
    const tree = {
      kind: 'group',
      op: 'and',
      neg: false,
      children: [
        { kind: 'cond', type: 'tag', tagId: orphan, value: 'stray' },
        { kind: 'cond', type: 'tag', tagId: used, value: 'used' },
      ],
    };
    handle.sqlite.prepare("INSERT INTO folders (id, name, kind, tree) VALUES ('f1', 'Dynamic', 'dynamic', ?)").run(JSON.stringify(tree));

    const result = deleteOrphanTags(handle.sqlite, [orphan, used]); // `used` is not an orphan -> ignored
    expect(result.deletedIds).toEqual([orphan]);
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === orphan)).toBeUndefined();
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === used)).toBeDefined();

    const folderTree = JSON.parse((handle.sqlite.prepare("SELECT tree FROM folders WHERE id = 'f1'").get() as { tree: string }).tree);
    expect(folderTree.children).toHaveLength(1);
    expect(folderTree.children[0].tagId).toBe(used);
  });
});
