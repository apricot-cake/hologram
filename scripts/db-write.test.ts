// DB が持つ整理情報の書き込み（#298/St5）。置き換え操作が、sidecar も organization の
// JSON ファイルも触らずに往復することを見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';

let dir: string;
let sqlite: any;
let writer: ReturnType<typeof createDbWriter>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-'));
  ({ sqlite } = openDatabase(path.join(dir, 'test.db')));
  writer = createDbWriter(sqlite);

  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('post-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'), ('post-2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('タグ用語帳が往復する', () => {
  writer.setTagTypes({ alice: 'character' }, { character: 'Character' });

  expect(writer.getTagTypes()).toEqual({ types: { alice: 'character' }, labels: { character: 'Character' } });
});

describe('フォルダ', () => {
  beforeAll(() => {
    writer.setFolders({
      folders: [
        { id: 'folder-2', name: 'Child', kind: 'static', created: 2, parentId: 'folder-1', items: ['post-2'] },
        { id: 'folder-1', name: 'Favorites', kind: 'static', created: 1, items: ['post-1', 'missing'] },
      ],
      activeId: 'folder-1',
    });
  });

  test('parentId の既定を補い、存在しない投稿は落として往復する', () => {
    expect(writer.getFolders()).toEqual({
      folders: [
        { id: 'folder-2', name: 'Child', kind: 'static', created: 2, parentId: 'folder-1', items: ['post-2'] },
        { id: 'folder-1', name: 'Favorites', kind: 'static', created: 1, parentId: null, items: ['post-1'] },
      ],
      activeId: 'folder-1',
    });
  });
});

test('手動グループは、存在しない投稿を含む組を落として往復する', () => {
  writer.setManualGroups([
    ['post-1', 'missing'],
    ['post-1', 'post-2'],
  ]);

  expect(writer.getManualGroups()).toEqual({ groups: [['post-1', 'post-2']] });
});

test('タブが往復する', () => {
  const tabs = {
    activeTabId: 'tab-2',
    tabs: [
      { id: 'tab-1', pinned: false, title: null, state: {} },
      { id: 'tab-2', pinned: true, title: 'Saved', state: { tree: null } },
    ],
  };
  writer.setTabs(tabs);

  expect(writer.getTabs()).toEqual(tabs);
});

test('state の単純な key/value が往復する', () => {
  writer.stateSet('activeFolderId', 'f-1');

  expect(writer.stateGet('activeFolderId')).toBe('f-1');
});

// #444。投稿の書き込みとタグ編集と削除が、同じ1本の FTS 行（posts.ftsRowid）を
// 指し続けること。ここが崩れると索引が実データから静かにずれる。
describe('FTS 行の鍵の一生（#444）', () => {
  let ownDir: string;
  let db: any;
  let ownWriter: ReturnType<typeof createDbWriter>;
  const rec = (over: Record<string, unknown> = {}) => ({ captureId: 'cap-1', text: '吾輩は猫である', tags: ['アリス'], hashtags: ['写真'], capturedAt: '2026-01-01T00:00:00Z', ...over });
  const ftsRowidOf = (id: string) => db.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get(id)?.ftsRowid;
  const write = (record: Record<string, unknown>) => writePost(preparePostStmts(db), makeTagResolver(db), record as any);

  beforeAll(() => {
    ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-write-fts-'));
    ({ sqlite: db } = openDatabase(path.join(ownDir, 'test.db')));
    ownWriter = createDbWriter(db);
    write(rec());
    write(rec({ captureId: 'cap-2', text: '犬も歩けば棒に当たる', tags: [] }));
  });

  afterAll(() => {
    db.close();
    fs.rmSync(ownDir, { recursive: true, force: true });
  });

  test('初回の書き込みで鍵が振られ、FTS 行と一致する', () => {
    const key = ftsRowidOf('cap-1');
    expect(key).toBeTypeOf('number');
    expect(db.prepare('SELECT postId FROM posts_fts WHERE rowid = ?').get(key)).toEqual({ postId: 'cap-1' });
  });

  test('書き直しても鍵は変わらず、FTS 行は1本のまま', () => {
    const before = ftsRowidOf('cap-1');
    write(rec({ text: '名前はまだ無い' }));

    expect(ftsRowidOf('cap-1')).toBe(before);
    expect((db.prepare("SELECT COUNT(*) AS n FROM posts_fts WHERE postId = 'cap-1'").get() as { n: number }).n).toBe(1);
    expect(db.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('"名前はまだ"')).toMatchObject([{ postId: 'cap-1' }]);
  });

  test('タグ編集は自分の FTS 行だけを書き換える', () => {
    ownWriter.setPostTags('cap-1', ['ブルーアーカイブ'], null);

    expect(db.prepare('SELECT tagsText FROM posts_fts WHERE rowid = ?').get(ftsRowidOf('cap-1'))).toEqual({ tagsText: 'ブルーアーカイブ' });
    expect(db.prepare('SELECT tagsText FROM posts_fts WHERE rowid = ?').get(ftsRowidOf('cap-2'))).toEqual({ tagsText: '' });
  });

  test('削除は自分の FTS 行だけを落とす', () => {
    ownWriter.deletePost('cap-1');

    expect(db.prepare('SELECT postId FROM posts_fts').all()).toEqual([{ postId: 'cap-2' }]);
  });

  test('鍵の無い投稿行（別経路の直接 INSERT）でもタグ編集は落ちない', () => {
    db.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('bare-1', '2026-01-01', '2026-01-01')").run();

    expect(ownWriter.setPostTags('bare-1', ['アリス'], null)).toBe(true);
    expect(db.prepare('SELECT postId FROM posts_fts').all()).toEqual([{ postId: 'cap-2' }]);
  });
});
