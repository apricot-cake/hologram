// Unit tests for the #300 (St7) additions to app/src/main/lib-db-query.ts (tagsFromDb/tagParentsFromDb/
// postCapturedVia). tag_parents is a dormant schema that no feature has ever written to,
// so we seed it directly via SQL without going through the importer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { postCapturedVia, tagParentsFromDb, tagsFromDb } from '../app/src/main/lib-db-query';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
let aliceId: number;
let aliceEastId: number;
let characterId: number;

beforeAll(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-db-query-tagparents-'), 'test.db'));
  const { sqlite } = handle;
  const insTag = sqlite.prepare('INSERT INTO tags (name, kind, reading) VALUES (?, ?, ?)');
  characterId = Number(insTag.run('character', 'category', null).lastInsertRowid);
  aliceId = Number(insTag.run('alice', 'character', 'ありす').lastInsertRowid);
  aliceEastId = Number(insTag.run('alice', 'character', null).lastInsertRowid); // a distinct entity with the same name (the Touhou-leaning one)
  sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 1)').run(aliceId, characterId);
  sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 0)').run(aliceEastId, characterId);

  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, capturedVia) VALUES (?, ?, ?, ?)').run('cap-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'bulk-bookmark');
  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, capturedVia) VALUES (?, ?, ?, ?)').run('cap-2', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', null);
});

afterAll(() => {
  handle.sqlite.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('tagsFromDb', () => {
  test('全タグを id 昇順で返す（同名別実体を含む）', () => {
    const rows = tagsFromDb(handle.sqlite);
    expect(rows.map((r) => r.id)).toEqual([characterId, aliceId, aliceEastId]);
    expect(rows.filter((r) => r.name === 'alice')).toHaveLength(2);
  });

  test('reading 列が往復する', () => {
    const rows = tagsFromDb(handle.sqlite);
    expect(rows.find((r) => r.id === aliceId)?.reading).toBe('ありす');
    expect(rows.find((r) => r.id === aliceEastId)?.reading).toBeNull();
  });
});

describe('tagParentsFromDb', () => {
  test('全エッジを isDisplay を boolean 化して返す', () => {
    const rows = tagParentsFromDb(handle.sqlite);
    expect(rows).toEqual([
      { tagId: aliceId, parentTagId: characterId, isDisplay: true },
      { tagId: aliceEastId, parentTagId: characterId, isDisplay: false },
    ]);
  });
});

describe('postCapturedVia', () => {
  test('指定した captureId の capturedVia を返す', () => {
    const out = postCapturedVia(handle.sqlite, ['cap-1', 'cap-2', 'missing']);
    expect(out.get('cap-1')).toBe('bulk-bookmark');
    expect(out.get('cap-2')).toBeNull();
    expect(out.has('missing')).toBe(false);
  });

  test('空配列には空 Map を返す（クエリを発行しない）', () => {
    expect(postCapturedVia(handle.sqlite, [])).toEqual(new Map());
  });
});
