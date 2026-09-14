// タグ用語集（Phase 2 ①）の tag-groups.json の単体テストと取り込みテスト。
// mergeTagGroups（集合の和＝既に分類済みのタグは現ライブラリ側が勝つ。labels も合流する）を
// 見て、さらに tag-groups.json が実際に合流する場所＝完全 ZIP の取り込みまで追う（合流先は DB）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ORG_MERGE, importCompleteZipToDb, mergeTagGroups } from '../../app/src/main/lib-archive';
import { openDatabase } from '../../app/src/main/lib-db';
import { createDbWriter } from '../../app/src/main/lib-db-write';

describe('mergeTagGroups（純関数）', () => {
  test('互いに素なマップは和集合', () => {
    expect(mergeTagGroups({ memberships: { ブルアカ: 'work' } }, { memberships: { アロナ: 'character' } }).memberships).toEqual({ ブルアカ: 'work', アロナ: 'character' });
  });

  // 取り込みが、ローカルで意図して設定した種別を黙って上書きしてはいけない
  test('衝突したら現ライブラリ側が勝つ', () => {
    expect(mergeTagGroups({ memberships: { アリス: 'character' } }, { memberships: { アリス: 'work' } }).memberships.アリス).toBe('character');
  });

  test('空マップは受け付け、構造の欠損は拒否する', () => {
    expect(mergeTagGroups({ memberships: {} }, { memberships: {} }).memberships).toEqual({});
    expect(() => mergeTagGroups({}, {})).toThrow();
    expect(() => mergeTagGroups(null, null)).toThrow();
  });

  test('labels も合流し、衝突は現ライブラリが勝つ', () => {
    const l = mergeTagGroups({ memberships: {}, labels: { work: '作品' } }, { memberships: {}, labels: { work: 'シリーズ', character: '話数' } });
    expect(l.labels).toEqual({ work: '作品', character: '話数' });
  });

  test('どちらにも labels が無ければ labels キー自体を出さない', () => {
    expect(mergeTagGroups({ memberships: { a: 'work' } }, { memberships: {} })).not.toHaveProperty('labels');
  });
});

test('tag-groups.json は取り込みマージ対象に登録されている', () => {
  expect(ORG_MERGE).toContain('tag-groups.json');
});

describe('完全ZIPの取り込みが tag-groups.json を合流させる', () => {
  let root: string;
  let handle: any;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-taggroups-'));
    const dest = path.join(root, 'lib');
    fs.mkdirSync(dest, { recursive: true });
    handle = openDatabase(path.join(root, 'test.db'));

    // 既存のライブラリでは アリス=character、ブルアカ=work と分類済み
    createDbWriter(handle.sqlite).fillTagGroupsByName({ アリス: 'character', ブルアカ: 'work' }, null);

    // 取り込む側の ZIP: アロナ=character を足し、アリス→work へ倒そうとする（これは負けるはず）
    const zip = new JSZip();
    zip.file('library/cap1.jpg', Buffer.from('JPEGDATA1'));
    zip.file('library/tag-groups.json', JSON.stringify({ memberships: { アロナ: 'character', アリス: 'work' } }));

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
    expect(createDbWriter(handle.sqlite).getTagGroupNames().memberships).toEqual({ アリス: 'character', ブルアカ: 'work', アロナ: 'character' });
  });

  // #810: 取り込みは種別を埋めるだけで、マップ全体を置き換えることはもう無い＝名前をキーに
  // する形式では言及すらできない実体（名前を共有する2つ目のタグ）も、持っていた種別を保つ。
  test('同名2実体の Kind が取り込みで消えない', () => {
    const dbw = createDbWriter(handle.sqlite);
    handle.sqlite.prepare("INSERT INTO tags (name, groupId) VALUES ('アリス', 'work')").run();
    dbw.fillTagGroupsByName({ アリス: 'character' }, null);

    const rows = handle.sqlite.prepare("SELECT groupId FROM tags WHERE name = 'アリス' ORDER BY id").all();
    expect(rows.map((r: any) => r.groupId)).toEqual(['character', 'work']);
  });
});

test('未定義の所属先と重複する所属は既存データを変えない', () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const writer = createDbWriter(sqlite);
    writer.setPosterTags({ tags: { one: ['正面'] } });
    const id = writer.getPosterTags().tags.one.tagIds[0];
    writer.setTagGroups([{ id, groupId: 'angle' }], { angle: '角度', empty: '空' });
    const before = writer.getTagGroups();
    expect(() => writer.setTagGroups([{ id, groupId: 'missing' }], { angle: '角度' })).toThrow();
    expect(() =>
      writer.setTagGroups(
        [
          { id, groupId: 'angle' },
          { id, groupId: 'empty' },
        ],
        { angle: '角度', empty: '空' },
      ),
    ).toThrow();
    expect(writer.setTagGroup(id, 'missing').ok).toBe(false);
    expect(writer.getTagGroups()).toEqual(before);
    writer.setTagGroups([], { empty: '空' });
    expect(writer.getTagGroups()).toEqual({ memberships: [], labels: { empty: '空' } });
    expect(writer.getPosterTags().tags.one.tags).toEqual(['正面']);
  } finally {
    sqlite.close();
  }
});
