// #21 のタグ語彙の書き込み層 (app/src/main/lib-db-tag-vocab.ts) と、そのクエリの葉の
// 掃除 (app/src/main/lib-tag-tree-sweep.ts) の単体テスト。テーブルは SQL で直に仕込む
// （tag_parents/folders/tabs は今まで眠っていたスキーマ＝
// tests/integration/db-query-tagparents.test.ts と同じやり方）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { addTagAlias, addTagParent, deleteOrphanTags, keepSeparateRename, listTagAliases, mergeTags, removeTagAlias, removeTagParent, renameTag, setTagKind, splitTag, tagParentEdges, tagSplitPreview, tagVocabOverview, wouldCreateCycle } from '../../app/src/main/lib-db-tag-vocab';

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
  test('投稿数/投稿者数、displayName、isReferencedAsParent、isOrphan', () => {
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
    expect(work.isOrphan).toBe(false); // 親として参照されている → 直接の使用が0でも孤児ではない

    const orphan = rows.find((r) => r.id === orphanId);
    if (!orphan) throw new Error('expected the orphan row to exist');
    expect(orphan.isOrphan).toBe(true);
  });
});

describe('wouldCreateCycle / addTagParent', () => {
  test('自己エッジと推移的な循環を弾き、正しいエッジは受け入れる', () => {
    const a = insTag('a');
    const b = insTag('b');
    const c = insTag('c');
    expect(wouldCreateCycle(handle.sqlite, a, a)).toBe(true);
    expect(addTagParent(handle.sqlite, a, a, false)).toEqual({ ok: false, error: 'cycle' });

    expect(addTagParent(handle.sqlite, a, b, false)).toEqual({ ok: true }); // a → b
    expect(addTagParent(handle.sqlite, b, c, false)).toEqual({ ok: true }); // b → c (a → b → c)
    // c → a はループ a → b → c → a を閉じてしまう。
    expect(wouldCreateCycle(handle.sqlite, c, a)).toBe(true);
    expect(addTagParent(handle.sqlite, c, a, false)).toEqual({ ok: false, error: 'cycle' });
  });

  test('isDisplay の upsert は同じタグの他の表示行を消す（部分ユニーク索引）', () => {
    const child = insTag('child');
    const p1 = insTag('p1');
    const p2 = insTag('p2');
    expect(addTagParent(handle.sqlite, child, p1, true)).toEqual({ ok: true });
    expect(addTagParent(handle.sqlite, child, p2, true)).toEqual({ ok: true }); // ユニーク索引違反を投げてはいけない
    const edges = tagParentEdges(handle.sqlite).filter((e) => e.tagId === child);
    expect(edges.filter((e) => e.isDisplay)).toHaveLength(1);
    expect(edges.find((e) => e.isDisplay)?.parentTagId).toBe(p2);
    expect(edges).toHaveLength(2); // p1 は表示に使わない親として残る
  });

  test('removeTagParent は渡されたエッジだけを消す', () => {
    const child = insTag('child');
    const parent = insTag('parent');
    addTagParent(handle.sqlite, child, parent, false);
    expect(removeTagParent(handle.sqlite, child, parent)).toEqual({ ok: true });
    expect(tagParentEdges(handle.sqlite)).toHaveLength(0);
  });
});

describe('renameTag / keepSeparateRename', () => {
  test('衝突しない素の改名', () => {
    const id = insTag('old-name');
    expect(renameTag(handle.sqlite, id, 'new-name')).toEqual({ ok: true });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === id)?.name).toBe('new-name');
  });

  test('衝突したら適用せず、相手の実体を報告する', () => {
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
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === b)?.name).toBe('bob'); // 触られていない
  });

  test('keepSeparateRename は循環しない正しい表示用の親を必須にする', () => {
    const b = insTag('bob');
    expect(keepSeparateRename(handle.sqlite, b, 'alice', 0)).toEqual({ ok: false, error: 'parent-required' });
    const work = insTag('touhou');
    expect(keepSeparateRename(handle.sqlite, b, 'alice', work)).toEqual({ ok: true });
    const row = tagVocabOverview(handle.sqlite).find((r) => r.id === b);
    if (!row) throw new Error('expected the row to exist');
    expect(row.name).toBe('alice');
    expect(row.displayName).toBe('alice(touhou)');
  });

  test('#86: 他のタグの別名として既に登録されている名前への改名を弾く', () => {
    const cat = insTag('cat');
    const bob = insTag('bob');
    const work = insTag('touhou');
    expect(addTagAlias(handle.sqlite, cat, 'kitty')).toEqual({ ok: true, id: expect.any(Number) });
    expect(renameTag(handle.sqlite, bob, 'kitty')).toEqual({ ok: false, error: 'alias-collision' });
    expect(keepSeparateRename(handle.sqlite, bob, 'kitty', work)).toEqual({ ok: false, error: 'alias-collision' });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === bob)?.name).toBe('bob'); // 触られていない
  });
});

describe('addTagAlias / removeTagAlias / listTagAliases', () => {
  test('正規のタグへ解決される別名を登録する', () => {
    const cat = insTag('cat');
    const result = addTagAlias(handle.sqlite, cat, 'kitty');
    expect(result).toEqual({ ok: true, id: expect.any(Number) });
    const rows = listTagAliases(handle.sqlite);
    expect(rows).toEqual([{ id: (result as { ok: true; id: number }).id, alias: 'kitty', tagId: cat, canonicalName: 'cat' }]);
  });

  test('別名の文字列は保存前に正規化する（NFKC + 前後の空白除去）', () => {
    const cat = insTag('cat');
    // 全角の `ｋｉｔｔｙ` に余計な空白が付いたもの → NFKC で畳んで `kitty` になる。
    addTagAlias(handle.sqlite, cat, '  ｋｉｔｔｙ  ');
    expect(listTagAliases(handle.sqlite)[0].alias).toBe('kitty');
  });

  test('空文字と未知のタグを弾く', () => {
    const cat = insTag('cat');
    expect(addTagAlias(handle.sqlite, cat, '   ')).toEqual({ ok: false, error: 'empty' });
    expect(addTagAlias(handle.sqlite, 999, 'kitty')).toEqual({ ok: false, error: 'not-found' });
  });

  test('そのタグ自身の今の名前と同じ別名を弾く', () => {
    const cat = insTag('cat');
    expect(addTagAlias(handle.sqlite, cat, 'cat')).toEqual({ ok: false, error: 'self' });
  });

  test('別の実在するタグを名指しする別名を弾く（名前空間を共有するという不変条件）', () => {
    const cat = insTag('cat');
    insTag('kitty'); // 実在する別のタグ実体が、既にこの名前を持っている
    expect(addTagAlias(handle.sqlite, cat, 'kitty')).toEqual({ ok: false, error: 'name-collision' });
  });

  test('同じ (別名, タグ) の組を2回登録しても結果は変わらない。別のタグからは衝突として弾く', () => {
    const cat = insTag('cat');
    const dog = insTag('dog');
    const first = addTagAlias(handle.sqlite, cat, 'kitty');
    expect(addTagAlias(handle.sqlite, cat, 'kitty')).toEqual(first); // 同じタグなら同じ id が返る
    expect(addTagAlias(handle.sqlite, dog, 'kitty')).toEqual({ ok: false, error: 'conflict' }); // 別のタグが同じ別名を取ることはできない
    expect(listTagAliases(handle.sqlite)).toHaveLength(1);
  });

  test('removeTagAlias は渡された行だけを消す', () => {
    const cat = insTag('cat');
    const a = addTagAlias(handle.sqlite, cat, 'kitty');
    const b = addTagAlias(handle.sqlite, cat, 'neko');
    if (!a.ok || !b.ok) throw new Error('expected both aliases to register');
    expect(removeTagAlias(handle.sqlite, a.id)).toEqual({ ok: true });
    expect(listTagAliases(handle.sqlite).map((r) => r.id)).toEqual([b.id]);
  });
});

describe('mergeTags の別名の扱い (#86)', () => {
  test('統合元の既存の別名は、実体の削除で失わせず統合先へ張り替える', () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    const a = addTagAlias(handle.sqlite, source, 'ally');
    if (!a.ok) throw new Error('expected the alias to register');

    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });

    const rows = listTagAliases(handle.sqlite);
    expect(rows).toEqual([{ id: a.id, alias: 'ally', tagId: target, canonicalName: 'alice' }]);
  });

  test('同じ文字列で既に統合先を指している取り残しの別名は落とす', () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    addTagAlias(handle.sqlite, source, 'ally');
    addTagAlias(handle.sqlite, target, 'ally2'); // 無関係。「統合先が元から持っていたもの」と「統合元から移ってきたもの」を区別するため
    // 統合元と統合先が、別々の2つの登録を経てまったく同じ別名の文字列を主張する状態にする。
    handle.sqlite.prepare('INSERT INTO tag_aliases (alias, tagId) VALUES (?, ?)').run('shared', target);
    handle.sqlite.prepare('INSERT INTO tag_aliases (alias, tagId) VALUES (?, ?)').run('shared', source);

    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });

    const rows = listTagAliases(handle.sqlite);
    expect(rows.filter((r) => r.alias === 'shared')).toHaveLength(1); // 取り残しは重複せず落ちた
    expect(rows.find((r) => r.alias === 'ally')?.tagId).toBe(target); // 統合元自身の別名はちゃんと移ってきた
  });

  test('keepOldNameAsAlias は統合前の名前を、残った側の別名として登録する', () => {
    const source = insTag('nekko'); // 衝突の元になった名前（renameTag は新しい名前を適用していない＝renameTag 自身のコメントを参照）
    const target = insTag('neko');

    expect(mergeTags(handle.sqlite, source, target, true)).toEqual({ ok: true });

    const rows = listTagAliases(handle.sqlite);
    expect(rows).toEqual([{ id: expect.any(Number), alias: 'nekko', tagId: target, canonicalName: 'neko' }]);
  });

  test('keepOldNameAsAlias はできる範囲で: 古い名前が無関係のタグと衝突しても統合は失敗させない', () => {
    const source = insTag('nekko');
    const target = insTag('neko');
    insTag('nekko'); // 3つ目の無関係な実体が、古い名前とまったく同じ名前を既に持っている＝addTagAlias の名前衝突の防ぎが働く

    expect(mergeTags(handle.sqlite, source, target, true)).toEqual({ ok: true }); // 統合そのものは成功する
    expect(listTagAliases(handle.sqlite)).toEqual([]); // ただし別名が黙って作られることはない
  });
});

describe('mergeTags', () => {
  test('投稿タグ・投稿者タグ・親のエッジ・クエリの葉を移し、統合元の実体を消す', () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    const work = insTag('touhou');
    const other = insTag('other-work');
    addParentRow(source, work, true); // source の表示用の親は target へ移る
    addParentRow(other, source, false); // other の親（source）は target へ張り替わる
    insPost('p1');
    insPost('p2');
    tagPost('p1', source);
    tagPost('p2', target); // target には既に p2 がある → source も p2 にタグを付けていれば、p2 の source→target の移動は衝突する（ここではそうなっていない）
    tagPoster('poster-1', source);

    // `source` を参照するクエリの葉＝動的フォルダと、保存されたタブ。
    const tree = { kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'tag', tagId: source, value: 'alice-dup' }] };
    handle.sqlite.prepare("INSERT INTO folders (id, name, kind, tree) VALUES ('f1', 'Dynamic', 'dynamic', ?)").run(JSON.stringify(tree));
    const tabState = { view: { tree: JSON.parse(JSON.stringify(tree)) }, nav: { hist: [{ kind: 'posts', state: { tree: JSON.parse(JSON.stringify(tree)) } }], idx: 0 } };
    handle.sqlite.prepare("INSERT INTO tabs (id, windowId, position, pinned, title, state) VALUES ('t1', 'main', 0, 0, NULL, ?)").run(JSON.stringify(tabState));

    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });

    const rows = tagVocabOverview(handle.sqlite);
    expect(rows.find((r) => r.id === source)).toBeUndefined(); // source の実体は消えた

    const targetRow = rows.find((r) => r.id === target);
    if (!targetRow) throw new Error('expected the target row to exist');
    expect(targetRow.postCount).toBe(2); // p1（移ってきた）＋ p2（元からある）
    expect(targetRow.posterCount).toBe(1);
    expect(targetRow.parents.find((p) => p.id === work)?.isDisplay).toBe(true); // source の表示用の親を引き継いだ

    const otherRow = rows.find((r) => r.id === other);
    if (!otherRow) throw new Error('expected the other row to exist');
    expect(otherRow.parents.map((p) => p.id)).toEqual([target]); // other の親が source から target へ張り替わった

    const folderTree = JSON.parse((handle.sqlite.prepare("SELECT tree FROM folders WHERE id = 'f1'").get() as { tree: string }).tree);
    expect(folderTree.children[0].tagId).toBe(target);

    const tabRow = JSON.parse((handle.sqlite.prepare("SELECT state FROM tabs WHERE id = 't1'").get() as { state: string }).state);
    expect(tabRow.view.tree.children[0].tagId).toBe(target);
    expect(tabRow.nav.hist[0].state.tree.children[0].tagId).toBe(target);
  });

  test('自己ループや循環になるエッジは、作らずに落とす', () => {
    const source = insTag('src');
    const target = insTag('tgt');
    const grandparent = insTag('gp');
    addParentRow(target, grandparent, false); // target → gp
    addParentRow(grandparent, source, false); // gp → source（つまり source は既に target の祖先）
    // gp の親（source）を target へ張り替えると target → gp → target が閉じてしまう。
    expect(mergeTags(handle.sqlite, source, target)).toEqual({ ok: true });
    const edges = tagParentEdges(handle.sqlite);
    expect(edges.some((e) => e.tagId === grandparent && e.parentTagId === target)).toBe(false); // 作られずに落ちた
  });
});

describe('setTagKind', () => {
  test('渡された実体だけを更新し、同名の兄弟には触らない', () => {
    const a = insTag('alice', 'character');
    const b = insTag('alice', 'character'); // 名前は同じだが別の実体
    expect(setTagKind(handle.sqlite, a, 'work')).toEqual({ ok: true });
    const rows = tagVocabOverview(handle.sqlite);
    expect(rows.find((r) => r.id === a)?.kind).toBe('work');
    expect(rows.find((r) => r.id === b)?.kind).toBe('character');
  });
});

describe('tagSplitPreview / splitTag', () => {
  test('プレビューは投稿ごとのサムネイルを返し、候補の親と共起する投稿をあらかじめ選んでおく', () => {
    const alice = insTag('alice', 'character');
    const touhou = insTag('touhou', 'work');
    const other = insTag('other-work');
    insPost('p1');
    insPost('p2');
    insPost('p3'); // media が無い → posts.image に退避する
    handle.sqlite.prepare("UPDATE posts SET image = 'shot.jpg' WHERE captureId = 'p3'").run();
    insMedia('p1', 'p1.jpg');
    insMedia('p2', 'p2.mp4'); // 生の動画ファイル＝<img src> には使えない
    tagPost('p1', alice);
    tagPost('p1', touhou); // 候補の親と共起する
    tagPost('p2', alice);
    tagPost('p2', other); // touhou とは共起しない
    tagPost('p3', alice);

    const preview = tagSplitPreview(handle.sqlite, alice, touhou);
    expect(preview).toHaveLength(3);
    const byId = new Map(preview.map((p) => [p.postId, p]));
    expect(byId.get('p1')).toEqual({ postId: 'p1', thumbFile: 'p1.jpg', suggestedToNew: true });
    expect(byId.get('p2')).toEqual({ postId: 'p2', thumbFile: null, suggestedToNew: false }); // 動画ファイルでポスター画像も無い → サムネイルは付かない
    expect(byId.get('p3')).toEqual({ postId: 'p3', thumbFile: 'shot.jpg', suggestedToNew: false });
  });

  test('投稿が1件も無いタグではプレビューが空になる', () => {
    const alice = insTag('alice');
    const touhou = insTag('touhou');
    expect(tagSplitPreview(handle.sqlite, alice, touhou)).toEqual([]);
  });

  test('splitTag は表示用の親を持つ同名の実体を作り、選んだ投稿だけを移し、種別を引き継ぐ', () => {
    const alice = insTag('alice', 'character');
    const touhouA = insTag('touhou');
    const touhouB = insTag('another-work');
    insPost('p1');
    insPost('p2');
    tagPost('p1', alice);
    tagPost('p2', alice);
    tagPoster('poster-1', alice); // 分割は poster_tags に触らない (#777 の範囲メモ)

    const result = splitTag(handle.sqlite, alice, touhouB, ['p1']);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const newTagId = result.newTagId;

    const rows = tagVocabOverview(handle.sqlite);
    const sourceRow = rows.find((r) => r.id === alice);
    const newRow = rows.find((r) => r.id === newTagId);
    if (!sourceRow || !newRow) throw new Error('expected both entities to exist');
    expect(sourceRow.postCount).toBe(1); // p2 は残った
    expect(sourceRow.posterCount).toBe(1); // poster_tags は触られていない
    expect(newRow.postCount).toBe(1); // p1 は移った
    expect(newRow.posterCount).toBe(0);
    expect(newRow.name).toBe('alice'); // 名前は同じ＝設計が求めている同名の実体
    expect(newRow.kind).toBe('character'); // 分割元から引き継いだ
    expect(newRow.displayName).toBe('alice(another-work)');
    expect(newRow.parents.find((p) => p.isDisplay)?.id).toBe(touhouB);

    // touhouA には触れていない＝意図したエッジだけが書かれたことの確認。
    expect(tagParentEdges(handle.sqlite).some((e) => e.parentTagId === touhouA)).toBe(false);
  });

  test('未知のタグと空の選択を弾く', () => {
    const alice = insTag('alice');
    const work = insTag('work');
    expect(splitTag(handle.sqlite, 999, work, ['p1'])).toEqual({ ok: false, error: 'not-found' });
    expect(splitTag(handle.sqlite, alice, 999, ['p1'])).toEqual({ ok: false, error: 'not-found' });
    expect(splitTag(handle.sqlite, alice, work, [])).toEqual({ ok: false, error: 'empty-selection' });
  });
});

describe('deleteOrphanTags', () => {
  test('本当の孤児だけを消し、それを参照するクエリの葉を掃く', () => {
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

    const result = deleteOrphanTags(handle.sqlite, [orphan, used]); // `used` は孤児ではない → 無視される
    expect(result.deletedIds).toEqual([orphan]);
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === orphan)).toBeUndefined();
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === used)).toBeDefined();

    const folderTree = JSON.parse((handle.sqlite.prepare("SELECT tree FROM folders WHERE id = 'f1'").get() as { tree: string }).tree);
    expect(folderTree.children).toHaveLength(1);
    expect(folderTree.children[0].tagId).toBe(used);
  });
});
