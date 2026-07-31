// Unit test that runs the v1 DDL (#5 St2 / #295, app/src/main/lib-db-schema.ts)
// through the real migration runner in app/src/main/lib-db.ts. This uses the
// real thing rather than the fake db that db.test.ts uses to check order and
// transactions, because the question here is "does the SQL actually parse, and
// do the constraints actually take effect".
//
// St2 is schema only (nothing populates these tables yet — St3 is the sidecar
// intake), so the rows written here are throwaway, just to show the
// constraints fire, not a real data flow.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, test } from 'vitest';
import { MIGRATIONS, openDatabase, runMigrations } from '../app/src/main/lib-db';
import { POST_COLUMNS } from '../app/src/main/lib-db-record-writer';

const dirs: string[] = [];
function mkdb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-schema-'));
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

const EXPECTED_TABLES = [
  'posts',
  'media',
  'tags',
  'tag_parents',
  'tag_aliases',
  'post_tags',
  'folders',
  'folder_items',
  'poster_folders',
  'poster_folder_items',
  'poster_tags',
  'manual_groups',
  'manual_group_items',
  'ungrouped_keys',
  'tabs',
  'tab_windows',
  'store_state',
  'inbox_events',
  'inbox_segments',
  'raw_payloads',
];

describe('マイグレーションが通り、テーブルが揃う', () => {
  const { sqlite } = openDatabase(mkdb());
  const names = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name),
  );
  sqlite.close();

  test('user_version は 19（v1 DDL ＋ #178 add-post-cw-sensitive までの追加18本）', () => {
    const { sqlite } = openDatabase(mkdb());
    expect(sqlite.pragma('user_version', { simple: true })).toBe(19);
    sqlite.close();
  });

  test.each(EXPECTED_TABLES)('テーブル %s がある', (t) => {
    expect(names.has(t)).toBe(true);
  });

  // FTS5 registers itself along with its shadow tables (posts_fts_data / _idx / _docsize / _config)
  test('posts_fts の仮想テーブルがある', () => {
    expect(names.has('posts_fts')).toBe(true);
  });

  test('廃止されたテーブルは落ちている', () => {
    expect(names.has('clip_items')).toBe(false); // #135's migration
    expect(names.has('poster_workspace_items')).toBe(false); // drop-poster-workspace-items
  });
});

// Items finalized in #5 on 2026-07-17/18
describe('posts_fts のクエリ契約', () => {
  const { sqlite } = openDatabase(mkdb());
  const ins = sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run('cap-1', '吾輩は猫である名前はまだ無い', null, null, null, null, null, null, null, 'わがはいはねこであるなまえはまだない');
  ins.run('cap-2', '犬も歩けば棒に当たる', null, null, null, null, null, null, null, 'いぬもあるけばぼうにあたる');

  // trigram needs 3 or more characters to form a token = naively searching with
  // one character silently returns 0 hits. The same trap db.test.ts avoids by using a 4-character phrase.
  const hit = sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank').all('"猫である"');

  test('MATCH は索引列を検索する（トークン途中の部分文字列も＝trigram）', () => {
    expect(hit).toHaveLength(1);
  });

  test('postId は UNINDEXED 列として往復する', () => {
    expect(hit[0].postId).toBe('cap-1');
  });

  // #5's 2026-07-18 comment: rank is a call to bm25(), not a stored column
  test('bm25(posts_fts) が rank の契約', () => {
    expect(typeof hit[0].rank).toBe('number');
  });

  // #164's job is filling in reading. St2 only shows that the column and query shape exist.
  test('reading 列は単独で引ける（列スコープの MATCH）', () => {
    expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('reading:"ねこである"')).toHaveLength(1);
  });
});

// #444. FTS5's virtual table has no index other than MATCH and rowid = using
// an UNINDEXED column as a condition means a full index scan every time.
// EXPLAIN QUERY PLAN always prints "SCAN ... VIRTUAL TABLE INDEX
// <number>:<string>" for a virtual table, and the only distinguishing part is
// the trailing string (the path FTS5's xBestIndex chose) = an empty string is an unconstrained scan, "=" is a rowid match.
describe('posts_fts の行指定は rowid（#444）', () => {
  const { sqlite } = openDatabase(mkdb());
  const planOf = (sql: string, ...params: unknown[]) => (sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)[0].detail;

  test('postId を条件にすると無制約の走査と同じ経路になる', () => {
    expect(planOf('DELETE FROM posts_fts WHERE postId = ?', 'cap-1')).toBe(planOf('SELECT postId FROM posts_fts'));
  });

  test('rowid を条件にすると一致検索の経路になる', () => {
    expect(planOf('DELETE FROM posts_fts WHERE rowid = ?', 1)).toMatch(/:=$/);
    expect(planOf('UPDATE posts_fts SET tagsText = ? WHERE rowid = ?', 't', 1)).toMatch(/:=$/);
  });

  test('posts.ftsRowid が FTS 行の鍵で、重複しない', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('ftsRowid');
    const idx = (sqlite.prepare('PRAGMA index_list(posts)').all() as Array<{ name: string; unique: number }>).find((i) => i.name === 'idx_posts_ftsRowid');
    expect(idx?.unique).toBe(1);
  });

  test('ftsRowid は POST_COLUMNS に入らない（この DB だけの内部鍵＝書き出しに乗らない）', () => {
    expect(POST_COLUMNS as readonly string[]).not.toContain('ftsRowid');
  });

  afterAll(() => sqlite.close());
});

// That an existing library doesn't break. Builds a real DB advanced to just
// before #444, inserts rows the old way (specifying postId, with rowid
// unrelated to posts), then reopens it.
describe('fts-rowid-addressing の移行（#444）', () => {
  const file = mkdb();
  const before = new Database(file);
  runMigrations(
    before,
    MIGRATIONS.slice(
      0,
      MIGRATIONS.findIndex((m) => m.name === 'fts-rowid-addressing'),
    ),
  );
  before.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, text, hashtags) VALUES (?,?,?,?,?)').run('cap-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '吾輩は猫である', JSON.stringify(['写真', '記録']));
  before.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, text, hashtags) VALUES (?,?,?,?,?)').run('cap-2', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '犬も歩けば棒に当たる', '[]');
  const tagId = before.prepare('INSERT INTO tags (name) VALUES (?)').run('アリス').lastInsertRowid;
  before.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)').run('cap-1', tagId);
  const insFts = before.prepare('INSERT INTO posts_fts (postId, text, hashtags, tagsText) VALUES (?,?,?,?)');
  insFts.run('cap-1', '吾輩は猫である', '写真 記録', 'アリス');
  insFts.run('cap-2', '犬も歩けば棒に当たる', '', '');
  insFts.run('cap-gone', '持ち主のいない索引行', '', ''); // an orphan left behind after its post was deleted
  before.close();

  const { sqlite } = openDatabase(file); // this is where fts-rowid-addressing runs
  afterAll(() => sqlite.close());

  test('すべての投稿が鍵を持ち、FTS 行と対応する', () => {
    const rows = sqlite.prepare('SELECT captureId, ftsRowid FROM posts ORDER BY captureId').all() as Array<{ captureId: string; ftsRowid: number | null }>;
    expect(rows.map((r) => r.captureId)).toEqual(['cap-1', 'cap-2']);
    for (const r of rows) {
      expect(r.ftsRowid).toBeTypeOf('number');
      expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE rowid = ?').get(r.ftsRowid)).toEqual({ postId: r.captureId });
    }
  });

  test('孤児の索引行は再構築で落ちる', () => {
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM posts_fts').get() as { n: number }).n).toBe(2);
  });

  test('MATCH が退行しない', () => {
    expect(sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank').all('"猫である"')).toMatchObject([{ postId: 'cap-1' }]);
  });

  test('hashtags は posts の JSON から、tagsText は post_tags から作り直される', () => {
    const row = sqlite.prepare('SELECT hashtags, tagsText, reading FROM posts_fts WHERE postId = ?').get('cap-1');
    expect(row).toEqual({ hashtags: '写真 記録', tagsText: 'アリス', reading: null });
    expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('tagsText:"アリス"')).toHaveLength(1);
  });
});

// #178: that an existing library doesn't break. Builds a real DB advanced to
// just before fts-rowid-addressing (with neither the cw column nor
// posts_fts's cw column existing yet), then reopens it all the way through
// add-post-cw-sensitive. Since FTS5 has no ALTER, posts_fts gets rebuilt
// wholesale (the same trick as #444) — this checks that MATCH on the existing
// text/hashtags/tagsText doesn't regress, that ftsRowid carries over, that the
// newly added cw column stays NULL on existing rows (declaring nothing), and
// that once a row with posts.cw is written next, it shows up in search.
describe('add-post-cw-sensitive の移行（#178）', () => {
  const file = mkdb();
  const before = new Database(file);
  runMigrations(
    before,
    MIGRATIONS.slice(
      0,
      MIGRATIONS.findIndex((m) => m.name === 'add-post-cw-sensitive'),
    ),
  );
  before.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, text, hashtags) VALUES (?,?,?,?,?)').run('cap-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '吾輩は猫である', '[]');
  before.exec("UPDATE posts SET ftsRowid = 1 WHERE captureId = 'cap-1'");
  before.prepare('INSERT INTO posts_fts (rowid, postId, text, hashtags, tagsText) VALUES (?,?,?,?,?)').run(1, 'cap-1', '吾輩は猫である', '', '');
  before.close();

  const { sqlite } = openDatabase(file); // this is where add-post-cw-sensitive runs
  afterAll(() => sqlite.close());

  test('posts.cw / posts.sensitive 列ができる', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('cw');
    expect(cols).toContain('sensitive');
  });

  test('移行前の行は cw が NULL のまま（何も捏造しない）', () => {
    expect(sqlite.prepare("SELECT cw FROM posts WHERE captureId = 'cap-1'").get()).toEqual({ cw: null });
  });

  test('ftsRowid は引き継がれ、既存の MATCH は退行しない', () => {
    expect(sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get('cap-1')).toEqual({ ftsRowid: 1 });
    expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('"猫である"')).toEqual([{ postId: 'cap-1' }]);
  });

  test('posts_fts に cw 列があり、新しく書いた行の CW 文言が検索に乗る', () => {
    sqlite.prepare("UPDATE posts SET cw = 'spider photo' WHERE captureId = 'cap-1'").run();
    sqlite.prepare("UPDATE posts_fts SET cw = 'spider photo' WHERE rowid = 1").run();
    expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('cw:"spider photo"')).toEqual([{ postId: 'cap-1' }]);
  });
});

describe('tags: id が実体・名前は一意でない・多親＋表示用の親は1つ', () => {
  const { sqlite } = openDatabase(mkdb());
  const insTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  const alice1 = insTag.run('アリス').lastInsertRowid;
  const alice2 = insTag.run('アリス').lastInsertRowid; // a distinct entity with the same name (this schema solves #21's problem)
  const touhou = insTag.run('東方').lastInsertRowid;
  const ba = insTag.run('ブルーアーカイブ').lastInsertRowid;
  const insParent = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?,?,?)');
  insParent.run(alice1, touhou, 1); // alice1's disambiguation parent
  insParent.run(alice1, ba, 0); // a second parent (not for display) = multiple parents are allowed

  test('同名のタグが並存できる（同一性は id であって名前ではない）', () => {
    expect(alice1).not.toBe(alice2);
  });

  // 2026-07-18 10:24 comment
  test('タグは親を2つ以上持てる', () => {
    expect(sqlite.prepare('SELECT parentTagId, isDisplay FROM tag_parents WHERE tagId = ? ORDER BY parentTagId').all(alice1)).toHaveLength(2);
  });

  test('表示用の親はタグごとに高々1つ', () => {
    expect(() => insParent.run(alice1, ba, 1)).toThrow(/UNIQUE constraint failed/);
  });

  // The partial index's "at most one" is per tagId, not global
  test('別のタグは自分の表示用の親を持てる', () => {
    expect(() => insParent.run(alice2, touhou, 1)).not.toThrow();
  });
});

describe('FK カスケード: 投稿を消すと media/post_tags/folder_items/raw_payloads も消える', () => {
  const { sqlite } = openDatabase(mkdb());
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-1', '2026-01-01', '2026-01-01')").run();
  sqlite.prepare("INSERT INTO media (postId, seq, file) VALUES ('cap-1', 0, 'cap-1-media-0.jpg')").run();
  const tagId = sqlite.prepare('INSERT INTO tags (name) VALUES (?)').run('タグ').lastInsertRowid;
  sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)').run('cap-1', tagId);
  sqlite.prepare("INSERT INTO folders (id, name) VALUES ('f1', 'フォルダ')").run();
  sqlite.prepare("INSERT INTO folder_items (folderId, postId) VALUES ('f1', 'cap-1')").run();
  sqlite.prepare("INSERT INTO raw_payloads (postId, sourceKind, acquiredAt, encoding, sha256, byteLength) VALUES ('cap-1', 'api:x/tweet-result', '2026-01-01', 'gzip', 'abc', 3)").run();
  sqlite.prepare("DELETE FROM posts WHERE captureId = 'cap-1'").run();

  const count = (table: string) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  test.each(['media', 'post_tags', 'folder_items', 'raw_payloads'])('%s がカスケードで消える', (table) => {
    expect(count(table)).toBe(0);
  });

  // The tag itself is untouched = only the junction rows referencing the deleted post are removed
  test('タグ自体は残る（所属だけが投稿にひもづく）', () => {
    expect(count('tags')).toBe(1);
  });
});

describe('folders: kind は閉じた2値・入れ子は parentId（#41）', () => {
  const { sqlite } = openDatabase(mkdb());

  test('kind は static/dynamic に限る（入れ子は別の kind ではない）', () => {
    expect(() => sqlite.prepare("INSERT INTO folders (id, name, kind) VALUES ('f1', 'x', 'nested')").run()).toThrow(/CHECK constraint failed/);
  });

  test('parentId が平坦な木の辺を保持し、親の削除は部分木へカスケードする', () => {
    sqlite.prepare("INSERT INTO folders (id, name) VALUES ('parent', 'Parent')").run();
    sqlite.prepare("INSERT INTO folders (id, name, parentId) VALUES ('child', 'Child', 'parent')").run();
    expect(sqlite.prepare("SELECT parentId FROM folders WHERE id = 'child'").get().parentId).toBe('parent');

    sqlite.prepare("DELETE FROM folders WHERE id = 'parent'").run();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM folders WHERE id = 'child'").get().n).toBe(0);
  });
});

// #292: originals are one row per fetch = it's normal for one post to have
// multiple rows (the post's own endpoint plus the poster profile's endpoint).
// The unique constraint only guarantees that writing the same fetch twice
// doesn't add a row (= re-applying is idempotent); a different fetch is stacked on, not overwritten.
describe('raw_payloads: 1取得1行・同一取得は積み直しても増えない', () => {
  const { sqlite } = openDatabase(mkdb());
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-1', '2026-01-01', '2026-01-01')").run();
  const ins = sqlite.prepare('INSERT OR IGNORE INTO raw_payloads (postId, sourceKind, acquiredAt, contentType, encoding, sha256, byteLength, payload) VALUES (?,?,?,?,?,?,?,?)');
  ins.run('cap-1', 'api:bluesky/getPostThread', '2026-01-01', 'application/json', 'gzip', 'hash-a', 100, Buffer.from([1, 2, 3]));
  ins.run('cap-1', 'api:bluesky/getProfile', '2026-01-01', 'application/json', 'gzip', 'hash-b', 50, Buffer.from([4, 5]));

  const count = () => sqlite.prepare("SELECT COUNT(*) AS n FROM raw_payloads WHERE postId = 'cap-1'").get().n;

  test('同じ投稿に取得ごとの行が並ぶ', () => {
    expect(count()).toBe(2);
  });

  test('同じ (postId, sourceKind, sha256) の再挿入は増えない', () => {
    ins.run('cap-1', 'api:bluesky/getPostThread', '2026-02-02', 'application/json', 'gzip', 'hash-a', 100, Buffer.from([1, 2, 3]));
    expect(count()).toBe(2);
  });

  test('同じ endpoint でも中身が違えば別の取得として積まれる', () => {
    ins.run('cap-1', 'api:bluesky/getPostThread', '2026-02-02', 'application/json', 'gzip', 'hash-c', 120, Buffer.from([9]));
    expect(count()).toBe(3);
  });

  test('payload は BLOB として往復する', () => {
    const row = sqlite.prepare("SELECT payload FROM raw_payloads WHERE sha256 = 'hash-b'").get();
    expect([...row.payload]).toEqual([4, 5]);
  });

  // Exceeding the cap doesn't fail the save; it just keeps the fact that a fetch happened and its identity (#292)
  test('本文を持たない行（omitted:oversize）も書ける', () => {
    ins.run('cap-1', 'api:x/tweet-result', '2026-01-01', 'application/json', 'omitted:oversize', 'hash-big', 9_000_000, null);
    expect(sqlite.prepare("SELECT payload, byteLength FROM raw_payloads WHERE sha256 = 'hash-big'").get()).toEqual({ payload: null, byteLength: 9_000_000 });
  });
});

// #5 2026-07-19: deliberately left unconstrained for extensibility
describe('posts.assetClass は意図的に無制約', () => {
  const { sqlite } = openDatabase(mkdb());

  test('現行の media|file の外の値も受け入れる（後で剥がす CHECK enum を作らない）', () => {
    sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt, assetClass) VALUES ('cap-1', '2026-01-01', '2026-01-01', 'link')").run();
    expect(sqlite.prepare("SELECT assetClass FROM posts WHERE captureId = 'cap-1'").get().assetClass).toBe('link');
  });

  test("省略時の既定は 'media'", () => {
    sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-2', '2026-01-01', '2026-01-01')").run();
    expect(sqlite.prepare("SELECT assetClass FROM posts WHERE captureId = 'cap-2'").get().assetClass).toBe('media');
  });
});

describe('既存 v1 データベースの開き直しは no-op', () => {
  const file = mkdb();
  const first = openDatabase(file);
  first.sqlite.prepare("INSERT INTO tags (name) VALUES ('x')").run();
  first.sqlite.close();
  const second = openDatabase(file);

  test('マイグレーションを再実行しない', () => {
    expect(second.sqlite.pragma('user_version', { simple: true })).toBe(19);
  });

  test('前回のデータが残る', () => {
    expect(second.sqlite.prepare("SELECT name FROM tags WHERE name = 'x'").get()).toBeTruthy();
  });
});

// A typo in a table or column name fails here at typecheck, not at runtime
test('Kysely の型付き Schema が実 DDL と噛み合う', async () => {
  const { db } = openDatabase(mkdb());
  await db.insertInto('tags').values({ name: 'タイプチェック用' }).execute();

  const row = await db.selectFrom('tags').select(['id', 'name', 'kind', 'reading']).executeTakeFirst();
  expect(row?.name).toBe('タイプチェック用');
});
