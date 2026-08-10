// #289 の投稿者プロフィールのスナップショットストアの単体テスト。対象は
// app/src/main/lib-poster-profile.ts の純粋なヘルパ、writePost が持つ実時間の書き込み経路
//（app/src/main/lib-db-record-writer.ts の writePosterProfile）、1回きりの backfill
//（app/src/main/lib-backfill-poster-profiles.ts）、そして ZIP の境界での合流
//（app/src/main/lib-archive.ts の mergePosterProfiles）。

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
      /* 片付けはできる範囲で */
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
    // PosterAppearance には followers/authorCreatedAt の欄がそもそも無い。このテストは
    // 実行時の分岐を動かすのではなく、その取り決めを書き留めるためのもの。
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
    expect(poster(sqlite, key).followers).toBe(999); // current のほうは更新される
    sqlite.close();
  });

  test('古い observedAt の再取込は current を巻き戻さない（履歴には入る）', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    const base = { platform: 'x', userId: 'u5', screenName: 'erin' };
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-5a', displayName: 'Erin (new)', capturedAt: '2026-02-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    // ZIP の再取り込みが、姿の違う古い観測（古い displayName）を流し直しても、
    // current を巻き戻してはいけない。
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { ...base, captureId: 'cap-5b', displayName: 'Erin (old)', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');

    const key = 'x:u5';
    expect(poster(sqlite, key).displayName).toBe('Erin (new)');
    expect(poster(sqlite, key).lastObservedAt).toBe('2026-02-01T00:00:00Z');
    expect(snapshots(sqlite, key)).toHaveLength(2); // 履歴としては記録される
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

  // #919: かつて "NOT NULL constraint failed: poster_profiles.platform" を投げ、取込キューの
  // 送り出しごと巻き添えにしていた形＝JSON-LD/OGP が著者を名指ししているページのブック
  // マーク。#195 はこれを platform: null と、userId に著者ページの URL を入れて保存する。
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
    expect(row.platform).toBeNull(); // '' でも 'web' という番兵でもない＝マイグレーションのコメントを参照
    expect(row.instance).toBeNull();
    expect(row.displayName).toBe('Y-Y-dev');
    expect(row.provenance).toBe('api:unknown');
    expect(snapshots(sqlite, key)).toHaveLength(1);
    sqlite.close();
  });

  // サイトの違う platform 無しの投稿者2人は、2行のまま保たれなければならない（#760 が
  // キーにホストを入れた理由）。行そのものが存在しうるようになって初めて効いてくる話。
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
    // 投稿を古いやり方で書く（#289 が無かった頃のつもり）。bio/links/banner は一切無し。
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-7a', platform: 'pixiv', userId: 'p1', screenName: 'p1', displayName: 'Old Name', avatar: 'https://i.pximg.net/a.jpg', followers: null, capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-7b', platform: 'pixiv', userId: 'p1', screenName: 'p1', displayName: 'New Name', avatar: 'https://i.pximg.net/b.jpg', followers: null, capturedAt: '2026-02-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    // 上で実時間の書き込み経路がすでに poster_profiles を種付けしている（writePost は
    // 無条件でそうする）。本当に #289 以前のライブラリを模すために、それを消す。
    sqlite.prepare('DELETE FROM poster_profile_snapshots').run();
    sqlite.prepare('DELETE FROM poster_profiles').run();

    backfillPosterProfiles(sqlite);

    const key = 'pixiv:p1';
    const row = poster(sqlite, key);
    expect(row).toBeTruthy();
    expect(row.displayName).toBe('New Name'); // いちばん新しく取得した投稿が勝つ
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
    // 2回の backfill のあいだに実時間の保存が挟まるのが普通だが、ここでは何も変わらない。
    // それでも store_state のゲートが、2回目の呼び出しを完全に何もしないものにしなければ
    // ならない。
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

  // #919: backfill は poster_profiles が存在する前に書かれた投稿を読む。ライブラリにある
  // 著者つきのブックマークもその中に入る。
  test('platform 無しでも著者がいる投稿は種付けする', () => {
    const { sqlite, stmts, resolveTagId } = mkHandle();
    sqlite.exec('BEGIN');
    writePost(stmts, resolveTagId, { captureId: 'cap-9b', platform: null, source: 'bookmark', url: 'https://qiita.com/a/items/1', userId: 'https://qiita.com/a', displayName: 'a', capturedAt: '2026-01-01T00:00:00Z' } as any);
    sqlite.exec('COMMIT');
    sqlite.prepare('DELETE FROM poster_profiles').run(); // この投稿が #289 より前のものだったつもりで
    backfillPosterProfiles(sqlite);
    const row = poster(sqlite, 'web:qiita.com:https://qiita.com/a');
    expect(row).toBeTruthy();
    expect(row.platform).toBeNull();
    expect(row.provenance).toBe('derived:posts');
    sqlite.close();
  });
});

describe('lib-archive の mergePosterProfiles', () => {
  // #919: platform 無しは ZIP の境界を null のまま越えなければならない。'' は NOT NULL の
  // ためのプレースホルダだったもので、今となっては「platform 無し」の2つ目の綴りになる。
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
            { observedAt: '2026-01-01T00:00:00Z', displayName: 'A', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h1', provenance: 'api:x' }, // cur 側と重複
            { observedAt: '2026-02-01T00:00:00Z', displayName: 'A2', screenName: null, bio: null, links: null, avatar: null, avatarFile: null, banner: null, bannerFile: null, followers: null, authorCreatedAt: null, contentHash: 'h2', provenance: 'api:x' }, // 新規
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
    expect(p1.history).toHaveLength(2); // 3ではない＝重複が畳まれた
    expect(p1.history.map((h: any) => h.contentHash)).toEqual(['h1', 'h2']); // observedAt 順
  });

  test('片方が空でも安全', () => {
    expect(mergePosterProfiles(null, null)).toEqual({ profiles: [] });
    expect(mergePosterProfiles({ profiles: [] }, { profiles: [] })).toEqual({ profiles: [] });
  });
});
