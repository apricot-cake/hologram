// DB が持つ整理情報の書き込み（#298/St5）。置き換え操作が、sidecar も organization の
// JSON ファイルも触らずに往復することを見る。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';

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
  writer.stateSet('truthSource', 'db');

  expect(writer.stateGet('truthSource')).toBe('db');
});
