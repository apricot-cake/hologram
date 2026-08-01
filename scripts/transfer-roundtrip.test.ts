// An integration test that directly proves #300 (St7)'s acceptance criteria: zip up DB A
// (posts + tag hierarchy + display parents + static/dynamic (saved search) folders +
// trashed posts) with writeCompleteZip, import it into an empty DB B with
// importCompleteZipToDb, and check that each of DB B's tables matches DB A.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { importCompleteZipToDb, writeCompleteZip } from '../app/src/main/lib-archive';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let dbA: any;
let dbB: any;
let srcA: string;
let trashA: string;
let destB: string;
let zipPath: string;

beforeAll(async () => {
  dbA = openDatabase(path.join(mkTempDir('hologram-roundtrip-a-db-'), 'test.db'));
  srcA = mkTempDir('hologram-roundtrip-a-lib-');
  trashA = mkTempDir('hologram-roundtrip-a-trash-');
  dbB = openDatabase(path.join(mkTempDir('hologram-roundtrip-b-db-'), 'test.db'));
  destB = mkTempDir('hologram-roundtrip-b-lib-');
  zipPath = path.join(mkTempDir('hologram-roundtrip-out-'), 'export.zip');

  // --- Seed DB A -----------------------------------------------------------
  const { sqlite: sqliteA } = dbA;
  const stmts = preparePostStmts(sqliteA);
  const resolveTagId = makeTagResolver(sqliteA);

  writePost(stmts, resolveTagId, { captureId: 'cap-1', text: 'a beautiful sunset', capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', tags: ['character:alice', 'style:sketch'], media: [], hashtags: ['nature'] } as any, null);
  writePost(stmts, resolveTagId, { captureId: 'cap-2', text: 'a rainy morning', capturedAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', tags: ['character:alice'], media: [], hashtags: [] } as any, null);
  fs.writeFileSync(path.join(srcA, 'cap-1.jpg'), 'JPEG1');
  fs.writeFileSync(path.join(srcA, 'cap-2.jpg'), 'JPEG2');

  // Tag hierarchy: character:alice's display parent is "character".
  const characterId = resolveTagId('character');
  const aliceId = resolveTagId('character:alice');
  sqliteA.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 1)').run(aliceId, characterId);

  // Folders: one static, one dynamic (saved search) with an opaque query tree.
  const dbwA = createDbWriter(sqliteA);
  dbwA.setFolders({
    folders: [
      { id: 'f-static', name: 'Favorites', kind: 'static', items: ['cap-1'] },
      { id: 'f-saved', name: 'Alice posts', kind: 'dynamic', tree: { op: 'tag', value: 'character:alice' } },
    ],
  });

  // A trashed post: filesystem-only (module comment — trash isn't in the DB at all).
  fs.writeFileSync(path.join(trashA, 'cap-9.json'), JSON.stringify({ captureId: 'cap-9', trashedAt: '2026-01-03T00:00:00Z' }));
  fs.writeFileSync(path.join(trashA, 'cap-9.jpg'), 'JPEG9');

  // --- Export DB A -> ZIP, import ZIP -> DB B -------------------------------
  await writeCompleteZip(sqliteA, srcA, trashA, zipPath, { includeTrash: true });
  await importCompleteZipToDb(dbB.sqlite, zipPath, destB);
});

afterAll(() => {
  dbA.sqlite.close();
  dbB.sqlite.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('往復: 投稿', () => {
  test('両方の投稿がテキスト込みで再現される', () => {
    const rows = dbB.sqlite.prepare('SELECT captureId, text FROM posts ORDER BY captureId').all();
    expect(rows).toEqual([
      { captureId: 'cap-1', text: 'a beautiful sunset' },
      { captureId: 'cap-2', text: 'a rainy morning' },
    ]);
  });

  test('タグの割り当てが再現される', () => {
    const tagsOf = (captureId: string) =>
      dbB.sqlite
        .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid')
        .all(captureId)
        .map((r: any) => r.name);
    expect(tagsOf('cap-1')).toEqual(['character:alice', 'style:sketch']);
    expect(tagsOf('cap-2')).toEqual(['character:alice']);
  });
});

describe('往復: タグの親子・表示用親', () => {
  test('character:alice の表示用親が character として再現される', () => {
    const { sqlite } = dbB;
    const aliceId = sqlite.prepare('SELECT id FROM tags WHERE name = ?').get('character:alice').id;
    const characterId = sqlite.prepare('SELECT id FROM tags WHERE name = ?').get('character').id;
    const edge = sqlite.prepare('SELECT * FROM tag_parents WHERE tagId = ?').get(aliceId);
    expect(edge.parentTagId).toBe(characterId);
    expect(edge.isDisplay).toBe(1);
  });
});

describe('往復: フォルダ（静的・動的/保存検索）', () => {
  test('静的フォルダとその中身が再現される', () => {
    const folders = createDbWriter(dbB.sqlite).getFolders().folders;
    const staticFolder = folders.find((f: any) => f.id === 'f-static');
    expect(staticFolder.name).toBe('Favorites');
    expect(staticFolder.items).toEqual(['cap-1']);
  });

  test('動的フォルダ（保存検索）とそのクエリツリーが再現される', () => {
    const folders = createDbWriter(dbB.sqlite).getFolders().folders;
    const savedSearch = folders.find((f: any) => f.id === 'f-saved');
    expect(savedSearch.kind).toBe('dynamic');
    expect(savedSearch.tree).toEqual({ op: 'tag', value: 'character:alice' });
  });
});

describe('往復: ゴミ箱', () => {
  test('ゴミ箱の投稿はファイルシステムへ復元され、DBのpostsには入らない', () => {
    const restored = JSON.parse(fs.readFileSync(path.join(destB, '.trash', 'cap-9.json'), 'utf8'));
    expect(restored.captureId).toBe('cap-9');
    expect(fs.existsSync(path.join(destB, '.trash', 'cap-9.jpg'))).toBe(true);
    expect(dbB.sqlite.prepare('SELECT 1 FROM posts WHERE captureId = ?').get('cap-9')).toBeUndefined();
  });
});
