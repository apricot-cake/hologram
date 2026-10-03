import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { deleteTags, mergeTags, renameTag, setTagGroup, tagVocabOverview } from '../../app/src/main/lib-db-tag-vocab';
import { MAX_TAG_NAME_COMBINING_MARK_RUN, normalizeTagName } from '../../native-host/tag-normalize.mts';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
function insTag(name: string, groupId: string | null = null, reading: string | null = null): number {
  return Number(handle.sqlite.prepare('INSERT INTO tags (name, groupId, reading) VALUES (?, ?, ?)').run(name, groupId, reading).lastInsertRowid);
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

function _insMedia(postId: string, file: string, seq = 0) {
  handle.sqlite.prepare('INSERT INTO media (postId, seq, file) VALUES (?, ?, ?)').run(postId, seq, file);
}

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-db-tag-vocab-'), 'test.db'));
});
afterEach(() => {
  handle.sqlite.close();
});
describe('tagVocabOverview', () => {
  test('投稿数と投稿者数に応じて未使用タグを判定する', () => {
    const workId = insTag('touhou', 'work');
    const aliceId = insTag('alice', 'character');
    const orphanId = insTag('unused', 'character');
    insPost('p1');
    tagPost('p1', aliceId);
    tagPoster('poster-1', aliceId);

    const rows = tagVocabOverview(handle.sqlite);
    const alice = rows.find((r) => r.id === aliceId);
    if (!alice) throw new Error('expected the alice row to exist');
    expect(alice.postCount).toBe(1);
    expect(alice.posterCount).toBe(1);
    expect(alice.displayName).toBe('alice');
    expect(alice.isOrphan).toBe(false);

    const work = rows.find((r) => r.id === workId);
    if (!work) throw new Error('expected the work row to exist');
    expect(work.postCount).toBe(0);
    expect(work.isOrphan).toBe(true);

    const orphan = rows.find((r) => r.id === orphanId);
    if (!orphan) throw new Error('expected the orphan row to exist');
    expect(orphan.isOrphan).toBe(true);
  });
});

describe('renameTag', () => {
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

  test('結合文字の仕事量上限を越える名前は回復可能な失敗になり、元の名前を保つ', () => {
    const id = insTag('変更前');
    expect(renameTag(handle.sqlite, id, 'a' + '\u0300\u0316'.repeat(MAX_TAG_NAME_COMBINING_MARK_RUN))).toEqual({ ok: false, error: 'too-long' });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === id)?.name).toBe('変更前');
  });

  test('NFKC で4096文字を越えた改名結果も保存し、再編集できる', () => {
    const id = insTag('変更前');
    const expanded = normalizeTagName('\ufdfa'.repeat(300));
    expect(expanded.length).toBeGreaterThan(4096);

    expect(renameTag(handle.sqlite, id, '\ufdfa'.repeat(300))).toEqual({ ok: true });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === id)?.name).toBe(expanded);
    expect(renameTag(handle.sqlite, id, expanded)).toEqual({ ok: true });
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === id)?.name).toBe(expanded);
  });
});

describe('mergeTags', () => {
  test('投稿タグ・投稿者タグ・クエリの葉を移し、統合元の実体を消す', () => {
    const source = insTag('alice-dup');
    const target = insTag('alice');
    const _work = insTag('touhou');
    const other = insTag('other-work');
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

    const otherRow = rows.find((r) => r.id === other);
    if (!otherRow) throw new Error('expected the other row to exist');

    const folderTree = JSON.parse((handle.sqlite.prepare("SELECT tree FROM folders WHERE id = 'f1'").get() as { tree: string }).tree);
    expect(folderTree.children[0].tagId).toBe(target);

    const tabRow = JSON.parse((handle.sqlite.prepare("SELECT state FROM tabs WHERE id = 't1'").get() as { state: string }).state);
    expect(tabRow.view.tree.children[0].tagId).toBe(target);
    expect(tabRow.nav.hist[0].state.tree.children[0].tagId).toBe(target);
  });
});

describe('setTagGroup', () => {
  beforeEach(() => handle.sqlite.prepare("INSERT INTO store_state (key, value) VALUES ('tagGroupLabels', ?)").run(JSON.stringify({ work: '作品', character: 'キャラ' })));
  test('渡された実体だけを更新し、同名の兄弟には触らない', () => {
    const a = insTag('alice', 'character');
    const b = insTag('alice', 'character'); // 名前は同じだが別の実体
    expect(setTagGroup(handle.sqlite, a, 'work')).toEqual({ ok: true });
    const rows = tagVocabOverview(handle.sqlite);
    expect(rows.find((r) => r.id === a)?.groupId).toBe('work');
    expect(rows.find((r) => r.id === b)?.groupId).toBe('character');
  });
});

describe('deleteTags', () => {
  test('使用数に関係なく指定タグと紐付けを削除し、投稿は残す', () => {
    const orphan = insTag('stray');
    const used = insTag('used');
    insPost('p1');
    tagPost('p1', used);
    tagPoster('poster-1', used);
    const preserved = insTag('preserved');
    tagPost('p1', preserved);
    const tree = {
      kind: 'group',
      op: 'and',
      neg: false,
      children: [
        { kind: 'cond', type: 'tag', tagId: orphan, value: 'stray' },
        { kind: 'cond', type: 'tag', tagId: used, value: 'used' },
        { kind: 'cond', type: 'tag', tagId: preserved, value: 'preserved' },
      ],
    };
    handle.sqlite.prepare("INSERT INTO folders (id, name, kind, tree) VALUES ('f1', 'Dynamic', 'dynamic', ?)").run(JSON.stringify(tree));

    const result = deleteTags(handle.sqlite, [orphan, used]);
    expect(result.deletedIds).toEqual([orphan, used]);
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === orphan)).toBeUndefined();
    expect(tagVocabOverview(handle.sqlite).find((r) => r.id === used)).toBeUndefined();
    expect(handle.sqlite.prepare('SELECT captureId FROM posts').all()).toEqual([{ captureId: 'p1' }]);
    expect(handle.sqlite.prepare('SELECT tagId FROM post_tags').all()).toEqual([{ tagId: preserved }]);
    expect(handle.sqlite.prepare('SELECT * FROM poster_tags').all()).toEqual([]);

    const folderTree = JSON.parse((handle.sqlite.prepare("SELECT tree FROM folders WHERE id = 'f1'").get() as { tree: string }).tree);
    expect(folderTree.children).toHaveLength(1);
    expect(folderTree.children[0].tagId).toBe(preserved);
  });
});
