// Unit + import tests for the tag glossary (Phase 2 ①) tag-types.json.
// Covers mergeTagTypes (union of sets — for a tag already classified, the current library
// wins; labels are merged too), and follows through to where tag-types.json actually gets
// merged via a full-ZIP import (the merge destination is the DB).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ORG_MERGE, importCompleteZipToDb, mergeTagTypes } from '../app/src/main/lib-archive';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

describe('mergeTagTypes（純関数）', () => {
  test('互いに素なマップは和集合', () => {
    expect(mergeTagTypes({ types: { ブルアカ: 'work' } }, { types: { アロナ: 'character' } }).types).toEqual({ ブルアカ: 'work', アロナ: 'character' });
  });

  // An import must not silently overwrite a kind that was intentionally set locally
  test('衝突したら現ライブラリ側が勝つ', () => {
    expect(mergeTagTypes({ types: { アリス: 'character' } }, { types: { アリス: 'work' } }).types.アリス).toBe('character');
  });

  test('空・欠損でも throw しない', () => {
    expect(mergeTagTypes({}, {}).types).toEqual({});
    expect(mergeTagTypes(null, null).types).toEqual({});
  });

  test('labels も合流し、衝突は現ライブラリが勝つ', () => {
    const l = mergeTagTypes({ types: {}, labels: { work: '作品' } }, { types: {}, labels: { work: 'シリーズ', character: '話数' } });
    expect(l.labels).toEqual({ work: '作品', character: '話数' });
  });

  test('どちらにも labels が無ければ labels キー自体を出さない', () => {
    expect(mergeTagTypes({ types: { a: 'work' } }, { types: {} })).not.toHaveProperty('labels');
  });
});

test('tag-types.json は取り込みマージ対象に登録されている', () => {
  expect(ORG_MERGE).toContain('tag-types.json');
});

describe('完全ZIPの取り込みが tag-types.json を合流させる', () => {
  let root: string;
  let handle: any;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tagtypes-'));
    const dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    handle = openDatabase(path.join(root, 'test.db'));

    // The existing library has already classified アリス=character, ブルアカ=work
    createDbWriter(handle.sqlite).fillTagKindsByName({ アリス: 'character', ブルアカ: 'work' }, null);

    // The ZIP being imported: adds アロナ=character, and tries to flip アリス→work (which should lose)
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/tag-types.json', JSON.stringify({ types: { アロナ: 'character', アリス: 'work' } }));

    // importCompleteZipToDb takes a PATH (#485 — main opens it with yauzl).
    const zipPath = path.join(root, 'fixture.zip');
    fs.writeFileSync(zipPath, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
    await importCompleteZipToDb(handle.sqlite, zipPath, dest);
  });

  afterAll(() => {
    handle.sqlite.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('ローカルの分類が保たれ、取り込み分が足される', () => {
    expect(createDbWriter(handle.sqlite).getTagTypeNames().types).toEqual({ アリス: 'character', ブルアカ: 'work', アロナ: 'character' });
  });

  // #810: the import fills kinds in, it no longer replaces the whole map — so an
  // entity the name-keyed format cannot even mention (the second tag sharing a
  // name) keeps whatever kind it had.
  test('同名2実体の Kind が取り込みで消えない', () => {
    const dbw = createDbWriter(handle.sqlite);
    handle.sqlite.prepare("INSERT INTO tags (name, kind) VALUES ('アリス', 'work')").run();
    dbw.fillTagKindsByName({ アリス: 'character' }, null);

    const rows = handle.sqlite.prepare("SELECT kind FROM tags WHERE name = 'アリス' ORDER BY id").all();
    expect(rows.map((r: any) => r.kind)).toEqual(['character', 'work']);
  });
});
