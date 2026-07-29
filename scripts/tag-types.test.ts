// タグ用語帳（Phase 2 ①）tag-types.json のユニット＋取り込みテスト。
// mergeTagTypes（和集合・すでに分類済みのタグは現ライブラリが勝つ・labels も合流）と、
// 完全ZIPの取り込み経由で tag-types.json が実際に合流するところまで見る（合流先はDB）。

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

  // 取り込みが、意図して付けたローカルの種別を黙って上書きしてはいけない
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

    // 既存ライブラリは アリス=character・ブルアカ=work を分類済み
    createDbWriter(handle.sqlite).setTagTypes({ アリス: 'character', ブルアカ: 'work' }, null);

    // 取り込む ZIP: アロナ=character を足し、アリス→work へ倒そうとする（負けるべき）
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/tag-types.json', JSON.stringify({ types: { アロナ: 'character', アリス: 'work' } }));

    // importCompleteZipToDb は PATH を取る（#485 — main が yauzl で開く）。
    const zipPath = path.join(root, 'fixture.zip');
    fs.writeFileSync(zipPath, Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })));
    await importCompleteZipToDb(handle.sqlite, zipPath, dest);
  });

  afterAll(() => {
    handle.sqlite.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('ローカルの分類が保たれ、取り込み分が足される', () => {
    expect(createDbWriter(handle.sqlite).getTagTypes().types).toEqual({ アリス: 'character', ブルアカ: 'work', アロナ: 'character' });
  });
});
