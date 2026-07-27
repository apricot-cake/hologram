// タグ用語帳（Phase 2 ①）tag-types.json のユニット＋取り込みテスト。
// mergeTagTypes（和集合・すでに分類済みのタグは現ライブラリが勝つ・labels も合流）と、
// importCompleteZip 経由で tag-types.json が実際に合流するところまで見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ORG_MERGE, importCompleteZip, mergeTagTypes } from '../app/src/main/lib-archive';

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

describe('importCompleteZip が tag-types.json を合流させる', () => {
  let root: string;
  let dest: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tagtypes-'));
    dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });

    // 既存ライブラリは アリス=character・ブルアカ=work を分類済み
    fs.writeFileSync(path.join(dest, 'tag-types.json'), JSON.stringify({ types: { アリス: 'character', ブルアカ: 'work' } }), 'utf8');

    // 取り込む ZIP: アロナ=character を足し、アリス→work へ倒そうとする（負けるべき）
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/tag-types.json', JSON.stringify({ types: { アロナ: 'character', アリス: 'work' } }));

    await importCompleteZip(JSZip, dest, await zip.generateAsync({ type: 'nodebuffer' }));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('ローカルの分類が保たれ、取り込み分が足される', () => {
    const merged = JSON.parse(fs.readFileSync(path.join(dest, 'tag-types.json'), 'utf8'));
    expect(merged.types).toEqual({ アリス: 'character', ブルアカ: 'work', アロナ: 'character' });
  });
});
