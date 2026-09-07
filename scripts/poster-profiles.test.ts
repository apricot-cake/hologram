import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { mergePosterProfiles } from '../app/src/main/lib-archive';
import { hasPosterIdentity, posterAppearanceHash, posterKeyOf } from '../app/src/main/lib-poster-profile';

const dirs: string[] = [];
function mkHandle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-poster-profiles-'));
  dirs.push(dir);
  const { sqlite } = openDatabase(path.join(dir, 'test.db'));
  return { sqlite, stmts: preparePostStmts(sqlite), resolveTagId: makeTagResolver(sqlite) };
}
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('lib-poster-profile', () => {
  test('投稿者キーと識別情報の有無を判定する', () => {
    expect(posterKeyOf({ platform: 'x', userId: '123', screenName: 'alice', url: null })).toBe('x:123');
    expect(posterKeyOf({ platform: 'x', userId: null, screenName: 'alice', url: null })).toBe('x:@alice');
    expect(hasPosterIdentity({ platform: null, userId: null, screenName: null, url: null })).toBe(false);
  });

  test('公開プロフィールの変化をハッシュで判別する', () => {
    const base = { displayName: 'A', screenName: 'a', bio: 'hi', links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: 10 };
    expect(posterAppearanceHash(base)).not.toBe(posterAppearanceHash({ ...base, followers: 11 }));
  });
});

describe('poster_profiles の現在値', () => {
  test('新しい観測へ更新し、履歴テーブルは持たない', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    writePost(stmts, resolveTagId, { captureId: 'a', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'Old', followers: 10, capturedAt: '2026-01-01T00:00:00Z' } as never);
    writePost(stmts, resolveTagId, { captureId: 'b', platform: 'x', userId: 'u1', screenName: 'alice', displayName: 'New', followers: 20, capturedAt: '2026-01-02T00:00:00Z' } as never);
    expect(sqlite.prepare("SELECT displayName, followers, firstObservedAt, lastObservedAt FROM poster_profiles WHERE posterKey = 'x:u1'").get()).toEqual({ displayName: 'New', followers: 20, firstObservedAt: '2026-01-01T00:00:00Z', lastObservedAt: '2026-01-02T00:00:00Z' });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='poster_profile_snapshots'").get()).toBeUndefined();
    sqlite.close();
  });

  test('古い観測は現在値を巻き戻さない', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    writePost(stmts, resolveTagId, { captureId: 'a', platform: 'x', userId: 'u2', displayName: 'New', capturedAt: '2026-02-01T00:00:00Z' } as never);
    writePost(stmts, resolveTagId, { captureId: 'b', platform: 'x', userId: 'u2', displayName: 'Old', capturedAt: '2026-01-01T00:00:00Z' } as never);
    expect(sqlite.prepare("SELECT displayName FROM poster_profiles WHERE posterKey = 'x:u2'").get()).toEqual({ displayName: 'New' });
    sqlite.close();
  });
});

test('プロフィールの統合は同じキーで現在のライブラリ側を優先する', () => {
  const current = { profiles: [{ posterKey: 'x:u1', displayName: 'Current' }] };
  const incoming = {
    profiles: [
      { posterKey: 'x:u1', displayName: 'Incoming' },
      { posterKey: 'x:u2', displayName: 'Second' },
    ],
  };
  expect(mergePosterProfiles(current, incoming)).toEqual({
    profiles: [
      { posterKey: 'x:u1', displayName: 'Current' },
      { posterKey: 'x:u2', displayName: 'Second' },
    ],
  });
});
