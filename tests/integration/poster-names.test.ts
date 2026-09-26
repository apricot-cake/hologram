import { expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { preparePostStmts, makeTagResolver, writePost } from '../../app/src/main/lib-db-record-writer.ts';
import { posterNamesByKey } from '../../app/src/main/lib-poster-names.ts';
import { POSTER_NAMES_MIGRATION } from '../../app/src/main/lib-db-schema.ts';
import { createDbWriter } from '../../app/src/main/lib-db-write.ts';
import { mergePosterProfiles } from '../../app/src/main/lib-archive.ts';

test('同じ固定IDの両方の名前を記録し、古い観測や再使用を扱う', () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    const stmts = preparePostStmts(sqlite),
      tags = makeTagResolver(sqlite);
    const write = (captureId: string, displayName: string, screenName: string, day: string, userId: string | null = '1') => writePost(stmts, tags, { captureId, platform: 'x', userId, displayName, screenName, capturedAt: `2026-09-${day}T00:00:00Z` });
    write('a', '旧名', 'old', '01');
    write('b', '現在名', 'current', '20');
    write('c', '昔の名前', 'older', '02');
    write('d', '旧名', 'old', '25');
    write('e', 'ID不明', 'unknown', '25', null);
    write('f', '別人', 'old', '25', '2');
    const names = posterNamesByKey(sqlite);
    expect(names.get('x:1')).toHaveLength(6);
    expect(names.get('x:1')?.find((n) => n.value === '旧名')).toMatchObject({ firstObservedAt: '2026-09-01T00:00:00Z', lastObservedAt: '2026-09-25T00:00:00Z' });
    expect(names.has('x:@unknown')).toBe(false);
    expect(names.get('x:1')?.some((n) => n.value === '別人')).toBe(false);
    expect(sqlite.prepare("SELECT displayName FROM poster_profiles WHERE posterKey='x:1'").get()).toEqual({ displayName: '旧名' });
    const writer = createDbWriter(sqlite);
    const saved = writer.getPosterProfiles();
    writer.setPosterProfiles(saved);
    expect(posterNamesByKey(sqlite)).toEqual(names);
  } finally {
    sqlite.close();
  }
});

test('既存投稿の名前を移行し、IDのない投稿は履歴にしない', () => {
  const { sqlite } = openDatabase(':memory:');
  try {
    sqlite.exec("DROP TABLE poster_names; INSERT INTO posts(captureId,platform,userId,screenName,displayName,capturedAt,updatedAt) VALUES('a','x','1','old','旧名','2026-01-01','2026-01-01'),('b','x','1','new','新名','2026-02-01','2026-02-01'),('c','x',NULL,'unknown','不明','2026-02-01','2026-02-01');");
    sqlite.exec(POSTER_NAMES_MIGRATION);
    expect(posterNamesByKey(sqlite).get('x:1')).toHaveLength(4);
    expect(posterNamesByKey(sqlite).size).toBe(1);
  } finally {
    sqlite.close();
  }
});

test('アーカイブ統合で現在値を優先しつつ履歴は両方残す', () => {
  const profile = (value: string) => ({ posterKey: 'x:1', platform: 'x', userId: '1', displayName: value, contentHash: 'x', provenance: 'api:x', firstObservedAt: '2026-01-01', lastObservedAt: '2026-02-01', names: [{ field: 'displayName', value, firstObservedAt: '2026-01-01', lastObservedAt: '2026-02-01' }] });
  const merged = mergePosterProfiles({ profiles: [profile('現在')] }, { profiles: [profile('以前')] });
  expect(merged.profiles[0].displayName).toBe('現在');
  expect(merged.profiles[0].names.map((n) => n.value)).toEqual(['現在', '以前']);
});
