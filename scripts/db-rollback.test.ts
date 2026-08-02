// Rolling the organization back to a DB generation (app/src/main/lib-db-rollback.ts).
//
// The sweep is the part worth pinning: #233 promises that a rollback moves the
// ORGANIZATION back without dropping anything from the library, so the posts a
// generation predates have to survive it — with their tags, and with whichever
// memberships still have a container to belong to.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { GENERATIONS_DIRNAME, generationName, generationsDir } from '../app/src/main/lib-db-generations';
import { listWithDestination, reregisterNewerPosts, resolveGeneration } from '../app/src/main/lib-db-rollback';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

const made: string[] = [];
function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}
function withGenerations(names: string[]): string {
  const dir = tempDir('hologram-rb-lib-');
  fs.mkdirSync(path.join(dir, GENERATIONS_DIRNAME), { recursive: true });
  for (const n of names) fs.writeFileSync(path.join(dir, GENERATIONS_DIRNAME, n), 'x');
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const nameFor = (y: number, m: number, d: number) => generationName(new Date(y, m - 1, d, 12, 0, 0));

const record = (captureId: string, tags: string[]) => ({
  captureId,
  image: `${captureId}.jpg`,
  url: `https://x.com/u/status/${captureId}`,
  platform: 'x',
  text: `本文 ${captureId}`,
  capturedAt: '2026-08-02T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
  tags,
});

/** A database file with the given posts, closed and ready to be read back. */
function seedDb(file: string, records: ReturnType<typeof record>[], seed?: (sqlite: any, writer: ReturnType<typeof createDbWriter>) => void): void {
  const { sqlite } = openDatabase(file);
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  for (const rec of records) writePost(stmts, resolveTagId, rec as any);
  if (seed) seed(sqlite, createDbWriter(sqlite));
  sqlite.close();
}

describe('世代一覧（この PC のみ／バックアップ先にもあり）', () => {
  test('宛先にある世代だけ atDestination が立つ', () => {
    const lib = withGenerations([nameFor(2026, 8, 1), nameFor(2026, 8, 2)]);
    const dest = withGenerations([nameFor(2026, 8, 1)]);
    expect(listWithDestination(lib, dest).map((g) => [g.name, g.atDestination])).toEqual([
      [nameFor(2026, 8, 2), false],
      [nameFor(2026, 8, 1), true],
    ]);
  });

  test('宛先が未設定なら全部この PC のみ', () => {
    const lib = withGenerations([nameFor(2026, 8, 2)]);
    expect(listWithDestination(lib, null).map((g) => g.atDestination)).toEqual([false]);
  });

  test('保存先が無ければ空', () => {
    expect(listWithDestination(null, null)).toEqual([]);
  });
});

describe('世代名の解決（呼び出し側の文字列を路にする唯一の場所）', () => {
  test('置き場に実在する自分の名前だけ通す', () => {
    const lib = withGenerations([nameFor(2026, 8, 2)]);
    expect(resolveGeneration(lib, nameFor(2026, 8, 2))).toBe(path.join(generationsDir(lib), nameFor(2026, 8, 2)));
    expect(resolveGeneration(lib, nameFor(2026, 8, 1))).toBeNull(); // 名前は正しいが実在しない
  });

  test('世代名でないものは path にしない', () => {
    const lib = withGenerations([nameFor(2026, 8, 2)]);
    fs.writeFileSync(path.join(lib, 'secret.db'), 'x');
    expect(resolveGeneration(lib, 'hologram.db')).toBeNull();
    expect(resolveGeneration(lib, '../secret.db')).toBeNull();
    expect(resolveGeneration(lib, 42)).toBeNull();
  });
});

describe('再登録スイープ（世代より後に増えた投稿を残す）', () => {
  test('世代に無い投稿だけをタグごと移植し、既にある投稿は触らない', async () => {
    const dir = tempDir('hologram-rb-');
    const stashFile = path.join(dir, 'stash.db');
    seedDb(stashFile, [record('post-old', ['猫']), record('post-new', ['犬', '散歩'])]);

    // The restored generation: it only ever knew about the older post.
    const liveFile = path.join(dir, 'live.db');
    seedDb(liveFile, [record('post-old', ['猫'])]);
    const { sqlite } = openDatabase(liveFile);
    try {
      expect(await reregisterNewerPosts(sqlite, stashFile)).toBe(1);
      const ids = (sqlite.prepare('SELECT captureId FROM posts ORDER BY captureId').all() as Array<{ captureId: string }>).map((r) => r.captureId);
      expect(ids).toEqual(['post-new', 'post-old']);
      const tags = (sqlite.prepare("SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = 'post-new' ORDER BY pt.rowid").all() as Array<{ name: string }>).map((r) => r.name);
      expect(tags).toEqual(['犬', '散歩']);
      // Idempotent: a second pass finds nothing left to carry over.
      expect(await reregisterNewerPosts(sqlite, stashFile)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  test('残っているフォルダへの所属は付いてくる／巻き戻しで消えたフォルダの所属だけ外れる', async () => {
    const dir = tempDir('hologram-rb-fold-');
    const stashFile = path.join(dir, 'stash.db');
    seedDb(stashFile, [record('post-new', [])], (_sqlite, writer) => {
      writer.setFolders({
        folders: [
          { id: 'keep', name: '残る', items: ['post-new'] },
          { id: 'gone', name: '消える', items: ['post-new'] },
        ],
      });
    });

    const liveFile = path.join(dir, 'live.db');
    // The generation being restored has only one of the two folders, which is
    // exactly #233's tolerated remainder: the post survives, the membership in
    // the vanished container does not.
    seedDb(liveFile, [], (_sqlite, writer) => {
      writer.setFolders({ folders: [{ id: 'keep', name: '残る', items: [] }] });
    });
    const { sqlite } = openDatabase(liveFile);
    try {
      expect(await reregisterNewerPosts(sqlite, stashFile)).toBe(1);
      const folders = (sqlite.prepare("SELECT folderId FROM folder_items WHERE postId = 'post-new'").all() as Array<{ folderId: string }>).map((r) => r.folderId);
      expect(folders).toEqual(['keep']);
    } finally {
      sqlite.close();
    }
  });

  test('世代の方が新しければ何も移植しない', async () => {
    const dir = tempDir('hologram-rb-none-');
    const stashFile = path.join(dir, 'stash.db');
    seedDb(stashFile, [record('post-old', [])]);
    const liveFile = path.join(dir, 'live.db');
    seedDb(liveFile, [record('post-old', []), record('post-newer', [])]);
    const { sqlite } = openDatabase(liveFile);
    try {
      expect(await reregisterNewerPosts(sqlite, stashFile)).toBe(0);
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 2 });
    } finally {
      sqlite.close();
    }
  });
});
