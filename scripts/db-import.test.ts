// app/src/main/lib-db-import.ts のユニットテスト（#5 St3 / #296＝sidecar → DB 同期の
// 取り込み器）。小さな合成の保存フォルダ（sidecar ＋ 整理層の JSON 全種 ＋ tabs.json）を作り、
// app/src/main/lib-db.ts 経由で本物の SQLite へ取り込んで、受け入れ条件を直接見る:
//   - 全取り込み → 再実行が冪等（同じ行・同じタグ/投稿 id・重複なし）で、3回目は編集・追加・
//     削除を拾う
//   - 増分同期（importChanged）は監視由来のファイル名バッチをちょうど適用し、
//     空振りの再発火に対しても冪等
//   - レポートが sidecar 数と DB 行数を突き合わせ、解釈できなかったもの（壊れた JSON・
//     投稿レコードでない正しい JSON）を並べる
//
// 1つのフォルダと DB を順に育てるので、宣言順に意味がある。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createDbImporter } from '../app/src/main/lib-db-import';
import { openDatabase } from '../app/src/main/lib-db';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let folder: string;
let handle: { db: any; sqlite: any };
let importer: ReturnType<typeof createDbImporter>;

const writeJson = (name: string, data: unknown) => fs.writeFileSync(path.join(folder, name), JSON.stringify(data));
const one = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).get(...args);
const all = (sql: string, ...args: any[]) => handle.sqlite.prepare(sql).all(...args);
const count = (table: string) => one(`SELECT COUNT(*) AS n FROM ${table}`).n;

beforeAll(() => {
  folder = mkTempDir('hologram-db-import-lib-');

  // フィクスチャ: 投稿3件・整理層のファイル一式・投稿でない JSON 1件・壊れた JSON 1件
  writeJson('cap-1.json', {
    captureId: 'cap-1',
    image: 'cap-1.jpg',
    media: [{ url: 'https://x.example/1.mp4', alt: 'alt1', width: 100, height: 200, file: 'cap-1-media-0.mp4', type: 'video', posterFile: 'cap-1-poster.jpg' }],
    text: 'a beautiful sunset today',
    hashtags: ['nature', 'photo'],
    tags: ['character:alice', 'style:sketch'],
    capturedAt: '2026-01-01T00:00:00Z',
  });
  writeJson('cap-2.json', { captureId: 'cap-2', image: 'cap-2.jpg', media: [], text: 'a rainy morning', tags: ['character:alice'], capturedAt: '2026-01-02T00:00:00Z' });
  writeJson('cap-3.json', { captureId: 'cap-3', image: 'cap-3.jpg', text: 'to be deleted', capturedAt: '2026-01-03T00:00:00Z' });
  writeJson('notapost.json', { foo: 1 }); // image/video/media 無し → 投稿レコードでない
  fs.writeFileSync(path.join(folder, 'corrupt.json'), '{ not valid json');

  writeJson('tag-types.json', { types: { 'character:alice': 'character', 'style:sketch': 'work' } });
  writeJson('folders.json', {
    folders: [
      { id: 'f-root', name: 'Root', kind: 'static', created: 122, items: [] },
      { id: 'f1', name: 'F1', kind: 'static', created: 123, parentId: 'f-root', items: ['cap-1', 'cap-2', 'cap-3'] },
    ],
  });
  writeJson('manual-groups.json', { groups: [['cap-1', 'cap-2']] });
  writeJson('poster-folders.json', { folders: [{ id: 'pf1', name: 'PF1', items: ['poster-key-1'] }] });
  writeJson('poster-tags.json', { tags: { 'poster-key-1': ['character:alice'] } });
  writeJson('ungrouped.json', { keys: ['url-key-1'] });
  writeJson('tabs.json', {
    activeTabId: 't1',
    tabs: [
      { id: 't1', pinned: false, title: 'Tab 1', state: { tree: null } },
      { id: 't2', pinned: true, title: null, state: {} },
    ],
  });

  handle = openDatabase(path.join(mkTempDir('hologram-db-import-db-'), 'test.db'));
  importer = createDbImporter();
});

afterAll(() => {
  handle.sqlite.close();
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('1回目の全取り込み', () => {
  let r1: any;
  let aliceTag: any;
  let sketchTag: any;

  beforeAll(async () => {
    r1 = await importer.importAll(folder, handle);
    aliceTag = one('SELECT id, name, kind FROM tags WHERE name = ?', 'character:alice');
    sketchTag = one('SELECT id, name, kind FROM tags WHERE name = ?', 'style:sketch');
  });

  test('レポートが sidecar 数と DB 行数を突き合わせる', () => {
    expect(r1).toMatchObject({ sidecarCount: 3, postsWritten: 3, postsRemoved: 0, dbPostCount: 3 });
  });

  test('解釈できなかった2件を並べる（壊れた JSON はエラー文つき）', () => {
    expect(r1.parseFailures).toHaveLength(2);
    expect(r1.parseFailures.find((f: any) => f.file === 'corrupt.json').error).toBeTruthy();
    expect(r1.parseFailures.map((f: any) => f.file)).toContain('notapost.json');
  });

  test('投稿行が sidecar の text と hashtags を運ぶ', () => {
    const post1 = one('SELECT * FROM posts WHERE captureId = ?', 'cap-1');
    expect(post1.text).toBe('a beautiful sunset today');
    expect(JSON.parse(post1.hashtags)).toEqual(['nature', 'photo']);
  });

  test('media 行が file・type・posterFile を運ぶ（#119 St1）', () => {
    const media1 = all('SELECT * FROM media WHERE postId = ?', 'cap-1');
    expect(media1).toHaveLength(1);
    expect(media1[0]).toMatchObject({ file: 'cap-1-media-0.mp4', type: 'video', posterFile: 'cap-1-poster.jpg' });
  });

  test('タグは2件に解決され、種別は tag-types.json 由来', () => {
    expect(count('tags')).toBe(2);
    expect(aliceTag.kind).toBe('character');
    expect(sketchTag.kind).toBe('work');
  });

  test('同じタグ名は同じ id を共有する（名前で重複排除）', () => {
    expect(
      all('SELECT tagId FROM post_tags WHERE postId = ?', 'cap-1')
        .map((r: any) => r.tagId)
        .sort(),
    ).toEqual([aliceTag.id, sketchTag.id].sort());
    expect(all('SELECT tagId FROM post_tags WHERE postId = ?', 'cap-2').map((r: any) => r.tagId)).toEqual([aliceTag.id]);
  });

  test('posts_fts が埋まって検索できる', () => {
    const hit = all('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?', '"sunset"');
    expect(hit.map((h: any) => h.postId)).toEqual(['cap-1']);
  });

  test('folders.json の中身と parentId が入る', () => {
    expect(all('SELECT postId FROM folder_items WHERE folderId = ? ORDER BY postId', 'f1').map((r: any) => r.postId)).toEqual(['cap-1', 'cap-2', 'cap-3']);
    expect(one('SELECT parentId FROM folders WHERE id = ?', 'f1').parentId).toBe('f-root');
  });

  test('manual-groups.json の1グループが2行になり、順序（seq）も保たれる', () => {
    const rows = all('SELECT g.id AS groupId, gi.postId, gi.seq FROM manual_groups g JOIN manual_group_items gi ON gi.groupId = g.id ORDER BY gi.seq');
    expect(rows.map((r: any) => r.postId)).toEqual(['cap-1', 'cap-2']);
  });

  test('投稿者側のフォルダ・タグ・未整理キーが往復する', () => {
    expect(one('SELECT 1 FROM poster_folder_items WHERE folderId = ? AND posterKey = ?', 'pf1', 'poster-key-1')).toBeTruthy();
    expect(all('SELECT tagId FROM poster_tags WHERE posterKey = ?', 'poster-key-1').map((r: any) => r.tagId)).toEqual([aliceTag.id]);
    expect(one('SELECT 1 FROM ungrouped_keys WHERE postKey = ?', 'url-key-1')).toBeTruthy();
  });

  test('タブが tabs.json の順に入り、pinned は 1/0・activeTabId も入る', () => {
    const tabRows = all('SELECT id, position, pinned FROM tabs ORDER BY position');
    expect(tabRows.map((r: any) => r.id)).toEqual(['t1', 't2']);
    expect(tabRows[1].pinned).toBe(1);
    expect(one('SELECT activeTabId FROM tab_windows WHERE windowId = ?', 'main').activeTabId).toBe('t1');
  });
});

describe('2回目の全取り込み（フォルダは無変化）＝冪等', () => {
  let aliceIdBefore: number;
  let r2: any;

  beforeAll(async () => {
    aliceIdBefore = one('SELECT id FROM tags WHERE name = ?', 'character:alice').id;
    r2 = await importer.importAll(folder, handle);
  });

  test('書き込みは upsert であって追記ではない', () => {
    expect(r2).toMatchObject({ postsWritten: 3, postsRemoved: 0, dbPostCount: 3 });
  });

  test('タグ・media・手動グループが重複しない', () => {
    expect(count('tags')).toBe(2);
    expect(count('media')).toBe(1); // 投稿ごとに delete+reinsert であって append ではない
    expect(count('manual_group_items')).toBe(2);
  });

  test('タグ行の id が変わらない（タグは delete+reinsert しない）', () => {
    expect(one('SELECT id FROM tags WHERE name = ?', 'character:alice').id).toBe(aliceIdBefore);
  });
});

describe('3回目の全取り込み: cap-1 を編集・cap-3 を削除・cap-4 を追加', () => {
  let r3: any;

  beforeAll(async () => {
    writeJson('cap-1.json', {
      captureId: 'cap-1',
      image: 'cap-1.jpg',
      media: [{ url: 'https://x.example/1.jpg', alt: 'alt1', width: 100, height: 200, file: 'cap-1-media-0.jpg' }],
      text: 'an edited sunrise instead',
      hashtags: ['nature'],
      tags: ['character:alice'],
      capturedAt: '2026-01-01T00:00:00Z',
    });
    fs.rmSync(path.join(folder, 'cap-3.json'));
    writeJson('cap-4.json', { captureId: 'cap-4', image: 'cap-4.jpg', capturedAt: '2026-01-04T00:00:00Z' });

    r3 = await importer.importAll(folder, handle);
  });

  test('レポートが 3件書き込み・1件削除', () => {
    expect(r3).toMatchObject({ postsWritten: 3, postsRemoved: 1, dbPostCount: 3 });
  });

  test('編集が反映され、消えた投稿の行も消える', () => {
    expect(one('SELECT text FROM posts WHERE captureId = ?', 'cap-1').text).toBe('an edited sunrise instead');
    expect(one('SELECT 1 FROM posts WHERE captureId = ?', 'cap-3')).toBeUndefined();
    expect(one('SELECT 1 FROM posts WHERE captureId = ?', 'cap-4')).toBeTruthy();
  });

  test('folders.json は cap-3 を挙げたままだが、投稿として無効なので落ちる', () => {
    expect(all('SELECT postId FROM folder_items WHERE folderId = ? ORDER BY postId', 'f1').map((r: any) => r.postId)).toEqual(['cap-1', 'cap-2']);
  });

  test('posts_fts が編集後の本文を映す（古い行が残らない）', () => {
    expect(all('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?', '"sunrise"')).toHaveLength(1);
  });
});

describe('増分同期（importChanged）', () => {
  let rc1: any;

  beforeAll(async () => {
    writeJson('cap-5.json', { captureId: 'cap-5', image: 'cap-5.jpg', capturedAt: '2026-01-05T00:00:00Z' });
    writeJson('cap-1.json', { captureId: 'cap-1', image: 'cap-1.jpg', media: [], text: 'a third revision', capturedAt: '2026-01-01T00:00:00Z' });
    fs.rmSync(path.join(folder, 'cap-2.json'));

    rc1 = await importer.importChanged(folder, handle, ['cap-5.json', 'cap-1.json', 'cap-2.json']);
  });

  test('名指しされたバッチちょうどを適用する', () => {
    expect(rc1).toMatchObject({ postsWritten: 2, postsRemoved: 1 });
    expect(one('SELECT 1 FROM posts WHERE captureId = ?', 'cap-5')).toBeTruthy();
    expect(one('SELECT text FROM posts WHERE captureId = ?', 'cap-1').text).toBe('a third revision');
    expect(one('SELECT 1 FROM posts WHERE captureId = ?', 'cap-2')).toBeUndefined();
  });

  test('バッチに含まれない投稿は触らない', () => {
    expect(one('SELECT 1 FROM posts WHERE captureId = ?', 'cap-4')).toBeTruthy();
  });

  test('同じ名前での空振りの再発火は何も書かない（削除の再報告もしない）', async () => {
    const rc2 = await importer.importChanged(folder, handle, ['cap-5.json', 'cap-1.json', 'cap-2.json']);
    expect(rc2).toMatchObject({ postsWritten: 0, postsRemoved: 0 });
  });
});
