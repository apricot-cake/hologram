// タグ用語集（Phase 2 ①）の tag-types.json の単体テストと取り込みテスト。
// mergeTagTypes（集合の和＝既に分類済みのタグは現ライブラリ側が勝つ。labels も合流する）を
// 見て、さらに tag-types.json が実際に合流する場所＝完全 ZIP の取り込みまで追う（合流先は DB）。

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

  // 取り込みが、ローカルで意図して設定した種別を黙って上書きしてはいけない
  test('衝突したら現ライブラリ側が勝つ', () => {
    expect(mergeTagTypes({ types: { アリス: 'character' } }, { types: { アリス: 'work' } }).types.アリス).toBe('character');
  });

  test('空マップは受け付け、構造の欠損は拒否する', () => {
    expect(mergeTagTypes({ types: {} }, { types: {} }).types).toEqual({});
    expect(() => mergeTagTypes({}, {})).toThrow();
    expect(() => mergeTagTypes(null, null)).toThrow();
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

    // 既存のライブラリでは アリス=character、ブルアカ=work と分類済み
    createDbWriter(handle.sqlite).fillTagKindsByName({ アリス: 'character', ブルアカ: 'work' }, null);

    // 取り込む側の ZIP: アロナ=character を足し、アリス→work へ倒そうとする（これは負けるはず）
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/tag-types.json', JSON.stringify({ types: { アロナ: 'character', アリス: 'work' } }));

    // importCompleteZipToDb が受け取るのはパス（#485＝ main が yauzl で開く）。
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

  // #810: 取り込みは種別を埋めるだけで、マップ全体を置き換えることはもう無い＝名前をキーに
  // する形式では言及すらできない実体（名前を共有する2つ目のタグ）も、持っていた種別を保つ。
  test('同名2実体の Kind が取り込みで消えない', () => {
    const dbw = createDbWriter(handle.sqlite);
    handle.sqlite.prepare("INSERT INTO tags (name, kind) VALUES ('アリス', 'work')").run();
    dbw.fillTagKindsByName({ アリス: 'character' }, null);

    const rows = handle.sqlite.prepare("SELECT kind FROM tags WHERE name = 'アリス' ORDER BY id").all();
    expect(rows.map((r: any) => r.kind)).toEqual(['character', 'work']);
  });
});
