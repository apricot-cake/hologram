// Unit tests for #21's tag-vocabulary write layer (app/src/main/lib-db-tag-vocab.ts)
// and its query-leaf sweep (app/src/main/lib-tag-tree-sweep.ts). Seeds tables
// directly via SQL (tag_parents/folders/tabs are dormant-until-now schema — same
// approach as scripts/db-query-tagparents.test.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { addTagAlias, addTagParent, deleteOrphanTags, keepSeparateRename, listTagAliases, mergeTags, removeTagAlias, removeTagParent, renameTag, setTagKind, splitTag, tagParentEdges, tagSplitPreview, tagVocabOverview, wouldCreateCycle } from '../app/src/main/lib-db-tag-vocab';

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
function insMedia(postId: string, file: string, seq = 0) {
  handle.sqlite.prepare('INSERT INTO media (postId, seq, file) VALUES (?, ?, ?)').run(postId, seq, file);
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

  test("#86: rejects renaming into a name already registered as someone else's alias", () => {
    const cat = insTag('cat');
    const bob = insTag('bob');
    const work = insTag('touhou');
    expect(addTagAlias(handle.sqlite, cat, 'kitty')).toEqual({ ok: true, id: expect.any(Number) });
    expect(renameTag(handle.sqlite, bob, 'kitty')).toEqual({ ok: false, error: 'alias-collision' });
    expect(keepSeparateRename(handle.sqlite, bob, 'kitty', work)).toEqual({ ok: false, error: 'alias-collision' });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === bob)?.name).toBe('bob'); // untouched
  });
});

describe('addTagAlias / removeTagAlias / listTagAliases', () => {
  test('registers an alias resolving to the canonical tag', () => {
    const cat = insTag('cat');
    const result = addTagAlias(handle.sqlite, cat, 'kitty');
    expect(result).toEqual({ ok: true, id: expect.any(Number) });
    const rows = listTagAliases(handle.sqlite);
    expect(rows).toEqual([{ id: (result as { ok: true; id: number }).id, alias: 'kitty', tagId: cat, canonicalName: 'cat' }]);
  });

  test('normalizes (NFKC + trim) the alias text before storing it', () => {
    const cat = insTag('cat');
    // full-width "ｋｉｔｔｙ" + stray whitespace -> NFKC-folded "kitty".
    addTagAlias(handle.sqlite, cat, '  ｋｉｔｔｙ  ');
    expect(listTagAliases(handle.sqlite)[0].alias).toBe('kitty');
  });

  test('rejects empty text and an unknown tag', () => {
    const cat = insTag('cat');
    expect(addTagAlias(handle.sqlite, cat, '   ')).toEqual({ ok: false, error: 'empty' });
    expect(addTagAlias(handle.sqlite, 999, 'kitty')).toEqual({ ok: false, error: 'not-found' });
  });

  test("rejects an alias equal to the tag's own current name", () => {
    const cat = insTag('cat');
    expect(addTagAlias(handle.sqlite, cat, 'cat')).toEqual({ ok: false, error: 'self' });
  });

  test('rejects an alias that names a distinct real tag (shared-namespace invariant)', () => {
    const cat = insTag('cat');
    insTag('kitty'); // a real, distinct tag entity already has this name
    expect(addTagAlias(handle.sqlite, cat, 'kitty')).toEqual({ ok: false, error: 'name-collision' });
  });

  test('is idempotent when the same (alias, tag) pair is registered twice, but conflicts across tags', () => {
    const cat = insTag('cat');
    const dog = insTag('dog');
    const first = addTagAlias(handle.sqlite, cat, 'kitty');
    expect(addTagAlias(handle.sqlite, cat, 'kitty')).toEqual(first); // same tag, same id back
    expect(addTagAlias(handle.sqlite, dog, 'kitty')).toEqual({ ok: false, error: 'conflict' }); // a different tag can't claim it too
    expect(listTagAliases(handle.sqlite)).toHaveLength(1);
  });

  test('removeTagAlias deletes exactly the given row', () => {
    const cat = insTag('cat');
    const a = addTagAlias(handle.sqlite, cat, 'kitty');
    const b = addTagAlias(handle.sqlite, cat, 'neko');
    if (!a.ok || !b.ok) throw new Error('expected both aliases to register');
    expect(removeTagAlias(handle.sqlite, a.id)).toEqual({ ok: true });
    expect(listTagAliases(handle.sqlite).map((r) => r.id)).toEqual([b.id]);
  });
});

describe('mergeTags alias handling (#86)', () => {
  test("repoints the source's existing aliases to the target instead of losing them to the entity delete", () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    const a = addTagAlias(handle.sqlite, source, 'ally');
    if (!a.ok) throw new Error('expected the alias to register');

    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });

    const rows = listTagAliases(handle.sqlite);
    expect(rows).toEqual([{ id: a.id, alias: 'ally', tagId: target, canonicalName: 'alice' }]);
  });

  test('drops a straggler alias that already points at the target under the same text', () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    addTagAlias(handle.sqlite, source, 'ally');
    addTagAlias(handle.sqlite, target, 'ally2'); // unrelated, distinguishes "target's own" from "moved from source"
    // Both source and target end up claiming the SAME alias text via two separate registrations.
    handle.sqlite.prepare('INSERT INTO tag_aliases (alias, tagId) VALUES (?, ?)').run('shared', target);
    handle.sqlite.prepare('INSERT INTO tag_aliases (alias, tagId) VALUES (?, ?)').run('shared', source);

    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });

    const rows = listTagAliases(handle.sqlite);
    expect(rows.filter((r) => r.alias === 'shared')).toHaveLength(1); // the straggler was dropped, not duplicated
    expect(rows.find((r) => r.alias === 'ally')?.tagId).toBe(target); // the source's own alias still moved over
  });

  test('keepOldNameAsAlias registers the pre-merge name as an alias of the survivor', () => {
    const source = insTag('nekko'); // the collided-from name (renameTag never applied the new name -- see its own comment)
    const target = insTag('neko');

    expect(mergeTags(handle.sqlite, source, target, true)).toEqual({ ok: true });

    const rows = listTagAliases(handle.sqlite);
    expect(rows).toEqual([{ id: expect.any(Number), alias: 'nekko', tagId: target, canonicalName: 'neko' }]);
  });

  test('keepOldNameAsAlias is best-effort: does not fail the merge if the old name collides with an unrelated tag', () => {
    const source = insTag('nekko');
    const target = insTag('neko');
    insTag('nekko'); // a THIRD, unrelated entity already has the exact old name -- addTagAlias's name-collision guard fires

    expect(mergeTags(handle.sqlite, source, target, true)).toEqual({ ok: true }); // merge itself still succeeds
    expect(listTagAliases(handle.sqlite)).toEqual([]); // but no alias was silently created
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

describe('tagSplitPreview / splitTag', () => {
  test('preview reports each thumbnail and pre-selects posts co-occurring with the candidate parent', () => {
    const alice = insTag('alice', 'character');
    const touhou = insTag('touhou', 'work');
    const other = insTag('other-work');
    insPost('p1');
    insPost('p2');
    insPost('p3'); // no media -> falls back to posts.image
    handle.sqlite.prepare("UPDATE posts SET image = 'shot.jpg' WHERE captureId = 'p3'").run();
    insMedia('p1', 'p1.jpg');
    insMedia('p2', 'p2.mp4'); // a raw video file -- not usable as an <img src>
    tagPost('p1', alice);
    tagPost('p1', touhou); // co-occurs with the candidate parent
    tagPost('p2', alice);
    tagPost('p2', other); // does NOT co-occur with touhou
    tagPost('p3', alice);

    const preview = tagSplitPreview(handle.sqlite, alice, touhou);
    expect(preview).toHaveLength(3);
    const byId = new Map(preview.map((p) => [p.postId, p]));
    expect(byId.get('p1')).toEqual({ postId: 'p1', thumbFile: 'p1.jpg', suggestedToNew: true });
    expect(byId.get('p2')).toEqual({ postId: 'p2', thumbFile: null, suggestedToNew: false }); // video file, no poster -> no thumb
    expect(byId.get('p3')).toEqual({ postId: 'p3', thumbFile: 'shot.jpg', suggestedToNew: false });
  });

  test('preview is empty for a tag with no posts', () => {
    const alice = insTag('alice');
    const touhou = insTag('touhou');
    expect(tagSplitPreview(handle.sqlite, alice, touhou)).toEqual([]);
  });

  test('splitTag creates a same-name entity with the display parent, moves only the chosen posts, and copies the kind', () => {
    const alice = insTag('alice', 'character');
    const touhouA = insTag('touhou');
    const touhouB = insTag('another-work');
    insPost('p1');
    insPost('p2');
    tagPost('p1', alice);
    tagPost('p2', alice);
    tagPoster('poster-1', alice); // poster_tags is untouched by a split (#777 scope note)

    const result = splitTag(handle.sqlite, alice, touhouB, ['p1']);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const newTagId = result.newTagId;

    const rows = tagVocabOverview(handle.sqlite);
    const sourceRow = rows.find((r) => r.id === alice);
    const newRow = rows.find((r) => r.id === newTagId);
    if (!sourceRow || !newRow) throw new Error('expected both entities to exist');
    expect(sourceRow.postCount).toBe(1); // p2 stayed
    expect(sourceRow.posterCount).toBe(1); // poster_tags untouched
    expect(newRow.postCount).toBe(1); // p1 moved
    expect(newRow.posterCount).toBe(0);
    expect(newRow.name).toBe('alice'); // same name -- the same-name entity the design calls for
    expect(newRow.kind).toBe('character'); // copied from source
    expect(newRow.displayName).toBe('alice(another-work)');
    expect(newRow.parents.find((p) => p.isDisplay)?.id).toBe(touhouB);

    // touhouA is untouched -- sanity that only the intended edge was written.
    expect(tagParentEdges(handle.sqlite).some((e) => e.parentTagId === touhouA)).toBe(false);
  });

  test('rejects an unknown tag and an empty selection', () => {
    const alice = insTag('alice');
    const work = insTag('work');
    expect(splitTag(handle.sqlite, 999, work, ['p1'])).toEqual({ ok: false, error: 'not-found' });
    expect(splitTag(handle.sqlite, alice, 999, ['p1'])).toEqual({ ok: false, error: 'not-found' });
    expect(splitTag(handle.sqlite, alice, work, [])).toEqual({ ok: false, error: 'empty-selection' });
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
