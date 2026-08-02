// Unit tests for #774's query-time application of tag parent relationships:
// lib-db-query.ts derives an effective tag set (raw tags plus every ancestor the
// tag_parents edges imply) onto every assembled post record, and stores it in no
// table. The fixture below is written with the real writer (writePost) and then
// gets its parent edges seeded directly, the same way db-query-tagparents.test.ts
// does — no feature writes tag_parents through this path.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { postsByIds, postsFromDb } from '../app/src/main/lib-db-query';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

const dirs: string[] = [];
function mkTempDir(prefix: string) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

let handle: any;
const tagId: Record<string, number> = {};
const tid = (name: string) => tagId[name];

// The shape under test — a two-level chain plus an unrelated tag:
//   東方 (grandparent)
//     └ 紅魔郷 (parent)
//         └ レミリア (child, carried by cap-child)
//   風景 (no edges, carried by cap-plain)
// cap-both carries レミリア AND 東方 explicitly, so the dedup path is exercised.
function idOf(sqlite: any, name: string): number {
  return (sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }).id;
}

beforeAll(async () => {
  handle = openDatabase(path.join(mkTempDir('hologram-db-query-effective-'), 'test.db'));
  const { sqlite } = handle;
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  const base = { capturedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-child', image: 'cap-child.jpg', tags: ['レミリア'] });
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-both', image: 'cap-both.jpg', tags: ['レミリア', '東方'] });
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-plain', image: 'cap-plain.jpg', tags: ['風景'] });
  writePost(stmts, resolveTagId, { ...base, captureId: 'cap-none', image: 'cap-none.jpg', tags: [] });
  // The two ancestors exist only as vocabulary until an edge points at them.
  const insTag = sqlite.prepare('INSERT INTO tags (name, kind, reading) VALUES (?, ?, ?)');
  insTag.run('紅魔郷', null, null);
  for (const n of ['レミリア', '東方', '風景', '紅魔郷']) tagId[n] = idOf(sqlite, n);
  const insEdge = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
  insEdge.run(tid('レミリア'), tid('紅魔郷'), 1);
  insEdge.run(tid('紅魔郷'), tid('東方'), 0);
});

afterAll(() => {
  handle.sqlite.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const byId = async (captureId: string) => (await postsByIds(handle.sqlite, [captureId]))[0] as any;

describe('effectiveTagIds: 親方向の推移閉包', () => {
  test('子タグだけの投稿が、親と祖父の実効タグを持つ', async () => {
    const rec = await byId('cap-child');
    expect(rec.tagIds).toEqual([tid('レミリア')]);
    expect(new Set(rec.effectiveTagIds)).toEqual(new Set([tid('レミリア'), tid('紅魔郷'), tid('東方')]));
  });

  test('生の tags/tagIds は書き換えられない（保存するのはユーザーが付けた事実だけ）', async () => {
    const rec = await byId('cap-child');
    expect(rec.tags).toEqual(['レミリア']);
  });

  test('明示的に付いた祖先は重複しない', async () => {
    const rec = await byId('cap-both');
    expect(rec.effectiveTagIds).toHaveLength(3);
    expect(rec.effectiveTagIds.filter((id: number) => id === tid('東方'))).toHaveLength(1);
  });

  test('エッジを持たないタグの実効集合は生の集合と同じ', async () => {
    const rec = await byId('cap-plain');
    expect(rec.effectiveTagIds).toEqual([tid('風景')]);
    expect(rec.effectiveTags).toEqual(['風景']);
  });

  test('タグの無い投稿は空のまま', async () => {
    const rec = await byId('cap-none');
    expect(rec.effectiveTagIds).toEqual([]);
    expect(rec.effectiveTags).toEqual([]);
  });
});

describe('effectiveTags / effectiveTagLabels: 3本の並行配列', () => {
  test('同じ添字が同じタグを指す', async () => {
    const rec = await byId('cap-child');
    expect(rec.effectiveTags).toHaveLength(rec.effectiveTagIds.length);
    expect(rec.effectiveTagLabels).toHaveLength(rec.effectiveTagIds.length);
    const at = rec.effectiveTagIds.indexOf(tid('紅魔郷'));
    expect(rec.effectiveTags[at]).toBe('紅魔郷');
  });

  test('表示に使う親を持つタグのラベルが合成名になる', async () => {
    const rec = await byId('cap-child');
    const at = rec.effectiveTagIds.indexOf(tid('レミリア'));
    // isDisplay の辺だけがラベルを作る（紅魔郷→東方 は isDisplay=0 なので素のまま）
    expect(rec.effectiveTagLabels[at]).toBe('レミリア(紅魔郷)');
    expect(rec.effectiveTagLabels[rec.effectiveTagIds.indexOf(tid('紅魔郷'))]).toBe('紅魔郷');
  });
});

describe('可逆性', () => {
  test('エッジを削除すると次の読み込みで実効集合から消える', async () => {
    handle.sqlite.prepare('DELETE FROM tag_parents WHERE tagId = ?').run(tid('紅魔郷'));
    const rec = await byId('cap-child');
    expect(new Set(rec.effectiveTagIds)).toEqual(new Set([tid('レミリア'), tid('紅魔郷')]));
    // 全エッジが消えれば実効集合は生の集合そのものへ戻る
    handle.sqlite.prepare('DELETE FROM tag_parents').run();
    const after = await byId('cap-child');
    expect(after.effectiveTagIds).toEqual([tid('レミリア')]);
    expect(after.effectiveTagLabels).toEqual(['レミリア']);
  });

  test('postsFromDb も同じ導出を通る', async () => {
    const insEdge = handle.sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
    insEdge.run(tid('レミリア'), tid('東方'), 0);
    const all = (await postsFromDb(handle.sqlite)) as any[];
    const rec = all.find((p) => p.captureId === 'cap-child');
    expect(new Set(rec.effectiveTagIds)).toEqual(new Set([tid('レミリア'), tid('東方')]));
    handle.sqlite.prepare('DELETE FROM tag_parents').run();
  });
});

describe('壊れた DB の循環エッジ', () => {
  // addTagParent/mergeTags は循環を拒むが、外部由来や破損した DB は持ちうる。
  // 全投稿を走る導出なので、ハングせず部分的な答えで終わることが要件。
  test('循環していても停止し、閉包に自分自身を含む', async () => {
    const insEdge = handle.sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
    insEdge.run(tid('レミリア'), tid('東方'), 0);
    insEdge.run(tid('東方'), tid('レミリア'), 0);
    const rec = await byId('cap-child');
    expect(new Set(rec.effectiveTagIds)).toEqual(new Set([tid('レミリア'), tid('東方')]));
    handle.sqlite.prepare('DELETE FROM tag_parents').run();
  });
});
