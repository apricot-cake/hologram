// app/src/main/lib-db-import.ts の #300 (St7) 追加分＝importTagParents のユニット
// テスト。get-or-create by name・isDisplay の「1タグ最大1つ」制約・冪等 re-run・
// 同名別実体タグの既知の衝突ケースを見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { importTagParents } from '../app/src/main/lib-db-import';
import { makeTagResolver } from '../app/src/main/lib-db-record-writer';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;

beforeEach(() => {
  handle = openDatabase(path.join(mkTempDir('hologram-tagparents-import-'), 'test.db'));
});

afterEach(() => {
  handle.sqlite.close();
});

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function edges(sqlite: any) {
  return sqlite.prepare('SELECT tagId, parentTagId, isDisplay FROM tag_parents ORDER BY tagId, parentTagId').all();
}
function tagsByName(sqlite: any, name: string) {
  return sqlite
    .prepare('SELECT id FROM tags WHERE name = ? ORDER BY id')
    .all(name)
    .map((r: any) => r.id);
}

describe('importTagParents: 空DBへ', () => {
  test('get-or-create でタグを作り、親エッジと表示用親を書く', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    importTagParents(sqlite, resolve, {
      tags: [
        { ref: 1, name: 'character' },
        { ref: 2, name: 'alice', kind: 'character', reading: 'ありす' },
      ],
      parents: [{ tagRef: 2, parentRef: 1, isDisplay: true }],
    });
    const aliceId = tagsByName(sqlite, 'alice')[0];
    const characterId = tagsByName(sqlite, 'character')[0];
    expect(edges(sqlite)).toEqual([{ tagId: aliceId, parentTagId: characterId, isDisplay: 1 }]);
  });

  test('既存タグ名は新規に作らず既存 id を再利用する', () => {
    const { sqlite } = handle;
    sqlite.prepare('INSERT INTO tags (name) VALUES (?)').run('alice');
    const preExistingId = tagsByName(sqlite, 'alice')[0];
    const resolve = makeTagResolver(sqlite);
    importTagParents(sqlite, resolve, {
      tags: [
        { ref: 1, name: 'character' },
        { ref: 2, name: 'alice' },
      ],
      parents: [{ tagRef: 2, parentRef: 1, isDisplay: false }],
    });
    expect(tagsByName(sqlite, 'alice')).toEqual([preExistingId]);
  });
});

describe('importTagParents: isDisplay は1タグ最大1つ（LOCAL優先）', () => {
  test('着地先に既に別の表示用親があれば、着信側はエッジは作るが isDisplay=0 に下げる', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    // ローカルの現在値: alice の表示用親は character
    const characterId = resolve('character');
    const seriesId = resolve('series');
    const aliceId = resolve('alice');
    sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 1)').run(aliceId, characterId);

    // 着信データ: alice の表示用親は series だと主張
    importTagParents(sqlite, resolve, {
      tags: [
        { ref: 10, name: 'series' },
        { ref: 20, name: 'alice' },
      ],
      parents: [{ tagRef: 20, parentRef: 10, isDisplay: true }],
    });

    const rows = edges(sqlite);
    expect(rows).toEqual(
      expect.arrayContaining([
        { tagId: aliceId, parentTagId: characterId, isDisplay: 1 }, // ローカルの表示用親は維持
        { tagId: aliceId, parentTagId: seriesId, isDisplay: 0 }, // 着信側の親子関係自体は失われない
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  test('同一バッチ内で同じタグに2つの isDisplay:true が来たら、後勝ちせず先着のみ表示用親にする', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    importTagParents(sqlite, resolve, {
      tags: [
        { ref: 1, name: 'character' },
        { ref: 2, name: 'series' },
        { ref: 3, name: 'alice' },
      ],
      parents: [
        { tagRef: 3, parentRef: 1, isDisplay: true },
        { tagRef: 3, parentRef: 2, isDisplay: true },
      ],
    });
    const rows = edges(sqlite);
    expect(rows.filter((r: any) => r.isDisplay === 1)).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });
});

describe('importTagParents: 冪等性', () => {
  test('同じデータを2回インポートしても重複行が増えない', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    const data = {
      tags: [
        { ref: 1, name: 'character' },
        { ref: 2, name: 'alice' },
      ],
      parents: [{ tagRef: 2, parentRef: 1, isDisplay: true }],
    };
    importTagParents(sqlite, resolve, data);
    importTagParents(sqlite, makeTagResolver(sqlite), data);
    expect(edges(sqlite)).toHaveLength(1);
  });
});

describe('importTagParents: 既知の制限（同名別実体タグの衝突）', () => {
  test('着地先に同名だが別実体のタグが既にあると、着信側は既存の方へ統合される', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    // ローカルに「alice（西方）」が既に character の子として存在
    const characterId = resolve('character');
    const localAliceId = resolve('alice');
    sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 1)').run(localAliceId, characterId);

    // 輸入元は「alice（東方）」という別実体を series の子として持っていたはずだが、
    // 名前だけで解決するため localAliceId に吸収される（既知の制限）。
    const seriesId = resolve('series');
    importTagParents(sqlite, resolve, {
      tags: [
        { ref: 1, name: 'series' },
        { ref: 2, name: 'alice' }, // 輸入元では別実体のつもりでも名前は同じ
      ],
      parents: [{ tagRef: 2, parentRef: 1, isDisplay: true }],
    });

    expect(tagsByName(sqlite, 'alice')).toEqual([localAliceId]); // 新規タグは作られない
    const rows = edges(sqlite);
    expect(rows.find((r: any) => r.parentTagId === seriesId)?.tagId).toBe(localAliceId);
  });
});

describe('importTagParents: 不正データ', () => {
  test('形が合わない場合は何もしない', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    importTagParents(sqlite, resolve, null);
    importTagParents(sqlite, resolve, undefined);
    importTagParents(sqlite, resolve, { tags: [], parents: 'not-an-array' } as any);
    expect(edges(sqlite)).toHaveLength(0);
  });

  test('未解決の ref や自己参照はスキップする', () => {
    const { sqlite } = handle;
    const resolve = makeTagResolver(sqlite);
    importTagParents(sqlite, resolve, {
      tags: [{ ref: 1, name: 'alice' }],
      parents: [
        { tagRef: 1, parentRef: 999, isDisplay: true }, // 未解決の parentRef
        { tagRef: 1, parentRef: 1, isDisplay: true }, // 自己参照
      ],
    });
    expect(edges(sqlite)).toHaveLength(0);
  });
});
