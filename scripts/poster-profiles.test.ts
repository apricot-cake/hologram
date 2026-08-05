// Unit tests for #289's poster-profile snapshot store: the pure helpers in
// app/src/main/lib-poster-profile.ts, the live write path writePost gains
// (app/src/main/lib-db-record-writer.ts's writePosterProfile), the one-time
// backfill (app/src/main/lib-backfill-poster-profiles.ts), and the ZIP-boundary
// merge (app/src/main/lib-archive.ts's mergePosterProfiles).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { backfillPosterProfiles } from '../app/src/main/lib-backfill-poster-profiles';
import { mergePosterProfiles } from '../app/src/main/lib-archive';
import { hasPosterIdentity, posterAppearanceHash, posterInstanceOf, posterKeyOf } from '../app/src/main/lib-poster-profile';

const dirs: string[] = [];
function mkdb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-poster-profiles-'));
  dirs.push(dir);
  return path.join(dir, 'test.db');
}
afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('lib-poster-profile', () => {
  test('posterKeyOf: X/Bluesky/pixiv は platform:userId', () => {
    expect(posterKeyOf({ platform: 'x', userId: '123', screenName: 'alice', url: null })).toBe('x:123');
  });

  test('posterKeyOf: Misskey/Mastodon はホストを挟む（#791）', () => {
    expect(posterKeyOf({ platform: 'misskey', userId: '9', screenName: null, url: 'https://misskey.io/notes/abc' })).toBe('misskey:misskey.io:9');
  });

  test('posterKeyOf: host が取れない instance platform はホストレスへ落ちる', () => {
    expect(posterKeyOf({ platform: 'mastodon', userId: '9', screenName: null, url: null })).toBe('mastodon:9');
  });

  test('posterKeyOf: userId が無ければ @screenName フォールバック', () => {
    expect(posterKeyOf({ platform: 'x', userId: null, screenName: 'alice', url: null })).toBe('x:@alice');
  });

  test('posterInstanceOf: instance-scoped platform 以外は null', () => {
    expect(posterInstanceOf({ platform: 'bluesky', userId: '1', screenName: null, url: 'https://bsky.app/x' })).toBeNull();
    expect(posterInstanceOf({ platform: 'misskey', userId: '1', screenName: null, url: 'https://misskey.io/notes/1' })).toBe('misskey.io');
  });

  test('hasPosterIdentity: userId/screenName が無ければ false（ブックマーク等）', () => {
    expect(hasPosterIdentity({ platform: null, userId: null, screenName: null, url: null })).toBe(false);
    expect(hasPosterIdentity({ platform: 'x', userId: '1', screenName: null, url: null })).toBe(true);
    expect(hasPosterIdentity({ platform: 'x', userId: null, screenName: 'alice', url: null })).toBe(true);
  });

  test('posterAppearanceHash: 同じ値は同じハッシュ、1フィールドでも変われば別ハッシュ', () => {
    const base = { displayName: 'A', screenName: 'a', bio: 'hi', links: null, avatar: 'https://x/a.jpg', avatarFile: 'avatars/1.jpg', banner: null, bannerFile: null };
    expect(posterAppearanceHash(base)).toBe(posterAppearanceHash({ ...base }));
    expect(posterAppearanceHash(base)).not.toBe(posterAppearanceHash({ ...base, bio: 'changed' }));
  });

  test('posterAppearanceHash: followers/authorCreatedAt は入力に取らない（別の型なので混入不可）', () => {
    // PosterAppearance has no followers/authorCreatedAt fields at all -- this
    // test documents that contract rather than exercising a runtime branch.
    const a = { displayName: null, screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null };
    expect(posterAppearanceHash(a)).toBe(posterAppearanceHash(a));
  });
});

function mkHandle() {
  const { sqlite } = openDatabase(mkdb());
  const stmts = preparePostStmts(sqlite);
  const resolveTagId = makeTagResolver(sqlite);
  return { sqlite, stmts, resolveTagId };
}

function poster(sqlite: any, posterKey: string) {
  return sqlite.prepare('SELECT * FROM poster_profiles WHERE posterKey = ?').get(posterKey);
}
function snapshots(sqlite: any, posterKey: string) {
  return sqlite.prepare('SELECT * FROM poster_profile_snapshots WHERE posterKey = ? ORDER BY observedAt, id').all(posterKey);
}

describe('writePost の poster_profiles 書き込み', () => {
  test('初回保存: current 1行 + snapshot 1行、bio/links/banner も入る', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, {
      captureId: 'cap-1',
      platform: 'misskey',
      url: 'https://misskey.io/notes/1',
      userId: 'u1',
      screenName: 'alice',
      displayName: 'Alice',
      avatar: 'https://misskey.io/a.jpg',
      avatarFile: 'avatars/aaa.jpg',
      bio: 'イラストを描いています',
      profileLinks: [{ name: 'website', value: 'https://alice.example', verifiedAt: null }],
      banner: 'https://misskey.io/banner.jpg',
      bannerFile: 'avatars/bbb.jpg',
      followers: 100,
      authorCreatedAt: '2020-01-01T00:00:00Z',
      capturedAt: '2026-01-01T00:00:00Z',
    } as any);
    sqlite.exec('COMMIT');

    const key = 'misskey:misskey.io:u1';
    const row = poster(sqlite, key);
    expect(row).toBeTruthy();
    expect(row.displayName).toBe('Alice');
    expect(row.bio).toBe('イラストを描いています');
    expect(JSON.parse(row.links)).toEqual([{ name: 'website', value: 'https://alice.example', verifiedAt: null }]);
    expect(row.banner).toBe('https://misskey.io/banner.jpg');
    expect(row.bannerFile).toBe('avatars/bbb.jpg');
    expect(row.followers).toBe(100);
    expect(row.instance).toBe('misskey.io');
    expect(row.firstObservedAt).toBe('2026-01-01T00:00:00Z');
    expect(row.lastObservedAt).toBe('2026-01-01T00:00:00Z');
    expect(snapshots(sqlite, key)).toHaveLength(1);
    sqlite.close();
  });

  test('同じ投稿者の別投稿を再度保存: 姿が同じなら履歴は増えず lastObservedAt だけ進む', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    const rec = (captureId: string, capturedAt: string) => ({
      captureId,
      platform: 'x',
      userId: 'u2',
      screenName: 'bob',
      displayName: 'Bob',
      avatar: 'https://x/bob.jpg',
      avatarFile: 'avatars/bob.jpg',
      followers: 10,
      capturedAt,
    });
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, rec('cap-2a', '2026-01-01T00:00:00Z') as any);
    sqlite.exec('COMMIT');
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, rec('cap-2b', '2026-01-02T00:00:00Z') as any);
    sqlite.exec('COMMIT');

    const key = 'x:u2';
    expect(snapshots(sqlite, key)).toHaveLength(1);
    expect(poster(sqlite, key).lastObservedAt).toBe('2026-01-02T00:00:00Z');
    sqlite.close();
  });

  test('bio が変わった投稿を保存: 履歴が1本増え、current が新しい値になる', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    const base = { captureId: 'cap-3a', platform: 'mastodon', url: 'https://example.social/@carol/1', userId: 'u3', screenName: 'carol', displayName: 'Carol', capturedAt: '2026-01-01T00:00:00Z' };
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, bio: 'old bio' } as any);
    sqlite.exec('COMMIT');
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-3b', bio: 'new bio', capturedAt: '2026-01-02T00:00:00Z' } as any);
    sqlite.exec('COMMIT');

    const key = 'mastodon:example.social:u3';
    expect(snapshots(sqlite, key)).toHaveLength(2);
    expect(poster(sqlite, key).bio).toBe('new bio');
    sqlite.close();
  });

  test('followers だけ変わっても履歴は増えない（#289 設計の意図的な非対称）', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    const base = { platform: 'bluesky', userId: 'did:plc:dave', screenName: 'dave', displayName: 'Dave' };
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-4a', followers: 5, capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-4b', followers: 999, capturedAt: '2026-01-02T00:00:00Z' } as any);
    sqlite.exec('COMMIT');

    const key = 'bluesky:did:plc:dave';
    expect(snapshots(sqlite, key)).toHaveLength(1);
    expect(poster(sqlite, key).followers).toBe(999); // current is still updated
    sqlite.close();
  });

  test('古い observedAt の再取込は current を巻き戻さない（履歴には入る）', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    const base = { platform: 'x', userId: 'u5', screenName: 'erin' };
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-5a', displayName: 'Erin (new)', capturedAt: '2026-02-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    // A ZIP re-import replaying an OLDER observation with a DIFFERENT
    // appearance (an old displayName) must not rewind current.
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-5b', displayName: 'Erin (old)', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');

    const key = 'x:u5';
    expect(poster(sqlite, key).displayName).toBe('Erin (new)');
    expect(poster(sqlite, key).lastObservedAt).toBe('2026-02-01T00:00:00Z');
    expect(snapshots(sqlite, key)).toHaveLength(2); // still recorded as history
    sqlite.close();
  });

  test('投稿者の識別情報（userId/screenName）が無い記録は poster_profiles を作らない', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-6', platform: null, source: 'bookmark', url: 'https://example.com/article', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM poster_profiles').get() as { n: number }).n).toBe(0);
    sqlite.close();
  });

  // #919: the shape that used to throw "NOT NULL constraint failed:
  // poster_profiles.platform" and took the whole inbox drain down with it — a
  // bookmark of a page whose JSON-LD/OGP names an author, which #195 saves with
  // platform: null and the author page URL as userId.
  test('platform 無しでも著者がいるブックマークは web: キーで行を作る', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, {
      captureId: 'cap-6b',
      platform: null,
      source: 'bookmark',
      url: 'https://qiita.com/Y-Y-dev/items/abc',
      userId: 'https://qiita.com/Y-Y-dev',
      displayName: 'Y-Y-dev',
      capturedAt: '2026-08-05T00:00:00Z',
    } as any);
    sqlite.exec('COMMIT');

    const key = 'web:qiita.com:https://qiita.com/Y-Y-dev';
    const row = poster(sqlite, key);
    expect(row).toBeTruthy();
    expect(row.platform).toBeNull(); // not '', not a 'web' sentinel — see the migration's comment
    expect(row.instance).toBeNull();
    expect(row.displayName).toBe('Y-Y-dev');
    expect(row.provenance).toBe('api:unknown');
    expect(snapshots(sqlite, key)).toHaveLength(1);
    sqlite.close();
  });

  // Two platform-less posters from different sites must stay two rows (#760's
  // reason for putting the host in the key), which only matters now that the
  // rows can exist at all.
  test('platform 無し同士でもホストが違えば別の行', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-6c', platform: null, url: 'https://qiita.com/a/items/1', userId: 'https://qiita.com/a', capturedAt: '2026-08-05T00:00:00Z' } as any);
    writePost(stmts, resolveTagId, { captureId: 'cap-6d', platform: null, url: 'https://www.youtube.com/watch?v=1', userId: 'http://www.youtube.com/@RickAstleyYT', capturedAt: '2026-08-05T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    expect(
      sqlite
        .prepare('SELECT posterKey FROM poster_profiles ORDER BY posterKey')
        .all()
        .map((r: any) => r.posterKey),
    ).toEqual(['web:qiita.com:https://qiita.com/a', 'web:www.youtube.com:http://www.youtube.com/@RickAstleyYT']);
    sqlite.close();
  });
});

describe('lib-backfill-poster-profiles', () => {
  test('既存投稿から poster_profiles を種付けし、bio は null・provenance は derived:posts', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    // Write posts the OLD way (as if from before #289 existed): no bio/links/banner at all.
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-7a', platform: 'pixiv', userId: 'p1', screenName: 'p1', displayName: 'Old Name', avatar: 'https://i.pximg.net/a.jpg', followers: null, capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-7b', platform: 'pixiv', userId: 'p1', screenName: 'p1', displayName: 'New Name', avatar: 'https://i.pximg.net/b.jpg', followers: null, capturedAt: '2026-02-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    // The live write path already seeded poster_profiles above (writePost does
    // that unconditionally) — clear it to simulate a genuinely pre-#289 library.
    sqlite.prepare('DELETE FROM poster_profile_snapshots').run();
    sqlite.prepare('DELETE FROM poster_profiles').run();

    backfillPosterProfiles(sqlite);

    const key = 'pixiv:p1';
    const row = poster(sqlite, key);
    expect(row).toBeTruthy();
    expect(row.displayName).toBe('New Name'); // most-recently-captured post wins
    expect(row.bio).toBeNull();
    expect(row.provenance).toBe('derived:posts');
    expect(snapshots(sqlite, key)).toHaveLength(1);
    sqlite.close();
  });

  test('冪等: 2回呼んでも二重にならない', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-8', platform: 'x', userId: 'u8', screenName: 'frank', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    sqlite.prepare('DELETE FROM poster_profile_snapshots').run();
    sqlite.prepare('DELETE FROM poster_profiles').run();

    backfillPosterProfiles(sqlite);
    const afterFirst = (sqlite.prepare('SELECT COUNT(*) AS n FROM poster_profiles').get() as { n: number }).n;
    // A live save between the two backfill calls would ordinarily be the norm,
    // but here nothing changes — the store_state gate must make the second
    // call a pure no-op regardless.
    backfillPosterProfiles(sqlite);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM poster_profiles').get() as { n: number }).n).toBe(afterFirst);
    sqlite.close();
  });

  test('投稿者の識別情報が無い記録（ブックマーク等）は種付けしない', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-9', platform: null, source: 'bookmark', url: 'https://example.com/x', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    backfillPosterProfiles(sqlite);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM poster_profiles').get() as { n: number }).n).toBe(0);
    sqlite.close();
  });

  // #919: the backfill reads posts written before poster_profiles existed, and
  // a library's bookmarks with authors are among them.
  test('platform 無しでも著者がいる投稿は種付けする', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-9b', platform: null, source: 'bookmark', url: 'https://qiita.com/a/items/1', userId: 'https://qiita.com/a', displayName: 'a', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    sqlite.prepare('DELETE FROM poster_profiles').run(); // as if the post predates #289
    backfillPosterProfiles(sqlite);
    const row = poster(sqlite, 'web:qiita.com:https://qiita.com/a');
    expect(row).toBeTruthy();
    expect(row.platform).toBeNull();
    expect(row.provenance).toBe('derived:posts');
    sqlite.close();
  });
});

describe('lib-archive の mergePosterProfiles', () => {
  // #919: platform-less has to survive the ZIP boundary as null. '' was the
  // NOT NULL placeholder and would now be a second way to spell "no platform".
  test('platform 無しは null のまま往復する', () => {
    const entry = (platform: string | null) => ({
      profiles: [
        {
          posterKey: 'web:qiita.com:https://qiita.com/a',
          platform,
          userId: 'https://qiita.com/a',
          instance: null,
          history: [{ observedAt: '2026-08-05T00:00:00Z', displayName: 'a', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h1', provenance: 'api:unknown' }],
        },
      ],
    });
    expect(mergePosterProfiles(entry(null), entry(null)).profiles[0].platform).toBeNull();
  });

  test('片方に platform があればそちらを採る', () => {
    const mk = (platform: string | null) => ({
      profiles: [
        {
          posterKey: 'x:1',
          platform,
          userId: '1',
          instance: null,
          history: [{ observedAt: '2026-01-01T00:00:00Z', displayName: 'A', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h1', provenance: 'api:x' }],
        },
      ],
    });
    expect(mergePosterProfiles(mk(null), mk('x')).profiles[0].platform).toBe('x');
  });

  test('posterKey で union、履歴は (observedAt, contentHash) でデデュープ', () => {
    const cur = {
      profiles: [
        {
          posterKey: 'x:1',
          platform: 'x',
          userId: '1',
          instance: null,
          history: [{ observedAt: '2026-01-01T00:00:00Z', displayName: 'A', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h1', provenance: 'api:x' }],
        },
      ],
    };
    const inc = {
      profiles: [
        {
          posterKey: 'x:1',
          platform: 'x',
          userId: '1',
          instance: null,
          history: [
            { observedAt: '2026-01-01T00:00:00Z', displayName: 'A', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h1', provenance: 'api:x' }, // duplicate of cur's
            { observedAt: '2026-02-01T00:00:00Z', displayName: 'A2', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h2', provenance: 'api:x' }, // new
          ],
        },
        {
          posterKey: 'x:2',
          platform: 'x',
          userId: '2',
          instance: null,
          history: [{ observedAt: '2026-01-01T00:00:00Z', displayName: 'B', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h3', provenance: 'api:x' }],
        },
      ],
    };
    const merged = mergePosterProfiles(cur, inc);
    expect(merged.profiles).toHaveLength(2);
    const p1 = merged.profiles.find((p: any) => p.posterKey === 'x:1') as any;
    expect(p1).toBeTruthy();
    expect(p1.history).toHaveLength(2); // not 3 -- the duplicate collapsed
    expect(p1.history.map((h: any) => h.contentHash)).toEqual(['h1', 'h2']); // sorted by observedAt
  });

  test('片方が空でも安全', () => {
    expect(mergePosterProfiles(null, null)).toEqual({ profiles: [] });
    expect(mergePosterProfiles({ profiles: [] }, { profiles: [] })).toEqual({ profiles: [] });
  });
});
