import { expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer.ts';
import { reconcilePosterIdentity } from '../../app/src/main/lib-poster-identity.ts';

test.each(['x', 'bluesky', 'pixiv', 'other-service'] as const)('%s: ID取得後に既存投稿と投稿者のタグ・フォルダを統合する', (platform) => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const stmts = preparePostStmts(sqlite);
    const tags = makeTagResolver(sqlite);
    const write = (captureId: string, userId: string | null) => writePost(stmts, tags, { captureId, platform, screenName: 'nprmtp', userId, displayName: 'にこにこオムライス', url: `https://x.com/nprmtp/status/${captureId}` });
    write('1', null);
    const tagId = tags('好き');
    sqlite.prepare('INSERT INTO poster_tags VALUES (?, ?)').run(`${platform}:@nprmtp`, tagId);
    sqlite.exec("INSERT INTO poster_folders VALUES ('f', '作品')");
    sqlite.prepare("INSERT INTO poster_folder_items VALUES ('f', ?)").run(`${platform}:@nprmtp`);
    write('2', '944779175402942464');
    expect(sqlite.prepare('SELECT DISTINCT userId FROM posts').all()).toEqual([{ userId: '944779175402942464' }]);
    expect(sqlite.prepare('SELECT posterKey FROM poster_profiles').all()).toEqual([{ posterKey: `${platform}:944779175402942464` }]);
    expect(sqlite.prepare('SELECT posterKey FROM poster_tags').all()).toEqual([{ posterKey: `${platform}:944779175402942464` }]);
    expect(sqlite.prepare('SELECT posterKey FROM poster_folder_items').all()).toEqual([{ posterKey: `${platform}:944779175402942464` }]);
    expect(write('3', null).userId).toBe('944779175402942464');
    expect(sqlite.prepare('SELECT count(*) AS n FROM posts').get()).toEqual({ n: 3 });
  } finally {
    sqlite.close();
  }
});

test('既存データを補完し、同じハンドルに複数のIDがある場合や別サービスは統合しない', () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const insert = sqlite.prepare("INSERT INTO posts (captureId, platform, screenName, userId, capturedAt, updatedAt) VALUES (?, ?, ?, ?, '2026-09-13', '2026-09-13')");
    for (const row of [
      ['1', 'x', 'Alice', '11'],
      ['2', 'x', 'alice', null],
      ['3', 'x', 'reused', '12'],
      ['4', 'x', 'reused', '13'],
      ['5', 'x', 'reused', null],
      ['6', 'bluesky', 'alice', null],
    ])
      insert.run(...row);
    reconcilePosterIdentity(sqlite);
    expect(sqlite.prepare('SELECT captureId, userId FROM posts ORDER BY captureId').all()).toEqual([
      { captureId: '1', userId: '11' },
      { captureId: '2', userId: '11' },
      { captureId: '3', userId: '12' },
      { captureId: '4', userId: '13' },
      { captureId: '5', userId: null },
      { captureId: '6', userId: null },
    ]);
  } finally {
    sqlite.close();
  }
});

test('未知のサービスは完全一致で照合し、サービス未指定の投稿は統合しない', () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const insert = sqlite.prepare("INSERT INTO posts (captureId, platform, screenName, userId, capturedAt, updatedAt) VALUES (?, ?, ?, ?, '2026-09-13', '2026-09-13')");
    for (const row of [
      ['1', 'custom', 'Alice', '11'],
      ['2', 'custom', 'alice', null],
      ['3', 'custom', 'Alice', null],
      ['4', null, 'Alice', '22'],
      ['5', null, 'Alice', null],
    ])
      insert.run(...row);
    reconcilePosterIdentity(sqlite);
    expect(sqlite.prepare('SELECT userId FROM posts ORDER BY captureId').all()).toEqual([{ userId: '11' }, { userId: null }, { userId: '11' }, { userId: '22' }, { userId: null }]);
  } finally {
    sqlite.close();
  }
});
