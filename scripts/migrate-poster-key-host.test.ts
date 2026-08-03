// #791: one-time rewrite of stored posterKeys for misskey/mastodon into the
// host-qualified form query.ts's userKey() now produces. See
// app/src/main/lib-migrate-poster-key-host.ts's header for the design.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { migratePosterKeyHost } from '../app/src/main/lib-migrate-poster-key-host';

let dir: string;
let sqlite: any;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-migrate-poster-key-'));
  ({ sqlite } = openDatabase(path.join(dir, 'test.db')));

  sqlite
    .prepare(
      `INSERT INTO posts (captureId, capturedAt, updatedAt, platform, userId, screenName, url) VALUES
        ('c1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'misskey', 'u3', 'carol', 'https://misskey.io/notes/n1'),
        ('c2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'mastodon', NULL, 'alice', 'https://instance-a.example/@alice'),
        ('c3', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'x', 'u1', 'bob', 'https://x.com/bob'),
        ('c4', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'misskey', 'u9', 'noHost', NULL)`,
    )
    .run();

  sqlite.prepare("INSERT INTO tags (name) VALUES ('t1')").run();
  const tagId = (sqlite.prepare("SELECT id FROM tags WHERE name = 't1'").get() as { id: number }).id;
  sqlite.prepare('INSERT INTO poster_tags (posterKey, tagId) VALUES (?, ?), (?, ?), (?, ?), (?, ?)').run('misskey:u3', tagId, 'mastodon:@alice', tagId, 'x:u1', tagId, 'misskey:u9', tagId);

  sqlite.prepare("INSERT INTO poster_folders (id, name) VALUES ('pf1', '推し')").run();
  sqlite.prepare('INSERT INTO poster_folder_items (folderId, posterKey) VALUES (?, ?), (?, ?)').run('pf1', 'misskey:u3', 'pf1', 'mastodon:@alice');

  sqlite.prepare("INSERT INTO poster_alias_groups (id, primaryKey) VALUES ('al1', 'misskey:u3')").run();
  sqlite.prepare('INSERT INTO poster_alias_group_members (groupId, posterKey) VALUES (?, ?), (?, ?)').run('al1', 'misskey:u3', 'al1', 'x:u1');
});

afterAll(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('posterKey ホスト移行（#791）', () => {
  test('misskey/mastodon の posterKey にホストを挟み、他プラットフォームとホスト無しの旧形は変えない', () => {
    migratePosterKeyHost(sqlite);

    const keys = (sqlite.prepare('SELECT posterKey FROM poster_tags ORDER BY posterKey').all() as Array<{ posterKey: string }>).map((r) => r.posterKey);
    expect(keys).toEqual(['mastodon:instance-a.example:@alice', 'misskey:misskey.io:u3', 'misskey:u9', 'x:u1']);

    const folderKeys = (sqlite.prepare('SELECT posterKey FROM poster_folder_items ORDER BY posterKey').all() as Array<{ posterKey: string }>).map((r) => r.posterKey);
    expect(folderKeys).toEqual(['mastodon:instance-a.example:@alice', 'misskey:misskey.io:u3']);

    // primaryKey は常にそのグループの member の1つ（aliases.ts's merge()）— member と
    // 揃って張り替わっていないと "primary is a member" 不変条件が壊れる。
    const group = sqlite.prepare("SELECT primaryKey FROM poster_alias_groups WHERE id = 'al1'").get() as { primaryKey: string };
    expect(group.primaryKey).toBe('misskey:misskey.io:u3');

    const memberKeys = (sqlite.prepare("SELECT posterKey FROM poster_alias_group_members WHERE groupId = 'al1' ORDER BY posterKey").all() as Array<{ posterKey: string }>).map((r) => r.posterKey);
    expect(memberKeys).toEqual(['misskey:misskey.io:u3', 'x:u1']);
  });

  test('2回目の呼び出しは何もしない（store_state ゲートでべき等）', () => {
    expect(() => migratePosterKeyHost(sqlite)).not.toThrow();
    const keys = (sqlite.prepare('SELECT posterKey FROM poster_tags ORDER BY posterKey').all() as Array<{ posterKey: string }>).map((r) => r.posterKey);
    expect(keys).toEqual(['mastodon:instance-a.example:@alice', 'misskey:misskey.io:u3', 'misskey:u9', 'x:u1']);
  });
});
