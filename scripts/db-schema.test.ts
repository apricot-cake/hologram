// v1 DDL（#5 St2 / #295, app/src/main/lib-db-schema.ts）を、app/src/main/lib-db.ts の
// 本物のマイグレーション実行器に通して検査するユニットテスト。db.test.ts が順序と
// トランザクションの検査に使う偽 db ではなく、ここで問うのは「SQL が実際に解釈でき、
// 制約が実際に効くか」だから。
//
// St2 はスキーマだけ（まだ何もこれらのテーブルを埋めない＝St3 が sidecar 取り込み器）なので、
// ここで書く行は制約が発火することを示すための使い捨てで、本物のデータフローではない。

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

  test('user_version は 15（v1 DDL ＋ #34 add-post-replaces までの追加14本）', () => {
    const { sqlite } = openDatabase(mkdb());
    expect(sqlite.pragma('user_version', { simple: true })).toBe(15);
    sqlite.close();
  });

  test.each(EXPECTED_TABLES)('テーブル %s がある', (t) => {
    expect(names.has(t)).toBe(true);
  });

  // FTS5 は自分自身と影テーブル（posts_fts_data / _idx / _docsize / _config）を登録する
  test('posts_fts の仮想テーブルがある', () => {
    expect(names.has('posts_fts')).toBe(true);
  });

  test('廃止されたテーブルは落ちている', () => {
    expect(names.has('clip_items')).toBe(false); // #135 のマイグレーション
    expect(names.has('poster_workspace_items')).toBe(false); // drop-poster-workspace-items
  });
});

// #5 2026-07-17/18 で確定した項目
describe('posts_fts のクエリ契約', () => {
  const { sqlite } = openDatabase(mkdb());
  const ins = sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, description, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?,?)');
  ins.run('cap-1', '吾輩は猫である名前はまだ無い', null, null, null, null, null, null, null, 'わがはいはねこであるなまえはまだない');
  ins.run('cap-2', '犬も歩けば棒に当たる', null, null, null, null, null, null, null, 'いぬもあるけばぼうにあたる');

  // trigram はトークンを作るのに3文字以上が要る＝素朴に1文字で引くと黙って0件になる。
  // db.test.ts が4文字の語句で避けているのと同じ罠。
  const hit = sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank').all('"猫である"');

  test('MATCH は索引列を検索する（トークン途中の部分文字列も＝trigram）', () => {
    expect(hit).toHaveLength(1);
  });

  test('postId は UNINDEXED 列として往復する', () => {
    expect(hit[0].postId).toBe('cap-1');
  });

  // #5 2026-07-18 コメント: rank は保存列ではなく bm25() の呼び出し
  test('bm25(posts_fts) が rank の契約', () => {
    expect(typeof hit[0].rank).toBe('number');
  });

  // #164 の仕事は reading を埋めること。St2 は列とクエリの形があることだけを示す。
  test('reading 列は単独で引ける（列スコープの MATCH）', () => {
    expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('reading:"ねこである"')).toHaveLength(1);
  });
});

// #444。FTS5 の仮想テーブルには MATCH と rowid 以外の索引が無い＝UNINDEXED 列を
// 条件にすると毎回索引の全走査になる。EXPLAIN QUERY PLAN は仮想テーブルでは常に
// "SCAN … VIRTUAL TABLE INDEX <番号>:<文字列>" と出て、区別が付くのは末尾の文字列
// （FTS5 の xBestIndex が選んだ経路）だけ＝空文字は無制約の走査・"=" は rowid 一致。
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

// 既存ライブラリを壊さないこと。#444 の1つ手前まで進めた本物の DB を作り、
// 旧来の書き方（postId 指定・rowid は posts と無関係）で行を入れてから開き直す。
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
  insFts.run('cap-gone', '持ち主のいない索引行', '', ''); // 投稿が消えた後に残った孤児
  before.close();

  const { sqlite } = openDatabase(file); // ここで fts-rowid-addressing が走る
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

describe('tags: id が実体・名前は一意でない・多親＋表示用の親は1つ', () => {
  const { sqlite } = openDatabase(mkdb());
  const insTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  const alice1 = insTag.run('アリス').lastInsertRowid;
  const alice2 = insTag.run('アリス').lastInsertRowid; // 同名の別実体（#21 の問題をこのスキーマが解く）
  const touhou = insTag.run('東方').lastInsertRowid;
  const ba = insTag.run('ブルーアーカイブ').lastInsertRowid;
  const insParent = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?,?,?)');
  insParent.run(alice1, touhou, 1); // alice1 の曖昧さ回避の親
  insParent.run(alice1, ba, 0); // 2つ目の親（表示用ではない）＝多親は許される

  test('同名のタグが並存できる（同一性は id であって名前ではない）', () => {
    expect(alice1).not.toBe(alice2);
  });

  // 2026-07-18 10:24 コメント
  test('タグは親を2つ以上持てる', () => {
    expect(sqlite.prepare('SELECT parentTagId, isDisplay FROM tag_parents WHERE tagId = ? ORDER BY parentTagId').all(alice1)).toHaveLength(2);
  });

  test('表示用の親はタグごとに高々1つ', () => {
    expect(() => insParent.run(alice1, ba, 1)).toThrow(/UNIQUE constraint failed/);
  });

  // 部分インデックスの「高々1つ」は tagId ごとであって全体ではない
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

  // タグ自体は無傷＝消えるのは削除された投稿を参照する中間行だけ
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

// #292: 原本は1取得1行＝1投稿に複数行が普通（投稿の endpoint ＋ 投稿者プロフィールの
// endpoint）。同じ取得を二度書いても増えない（＝再適用が冪等）ことだけを一意制約が保証し、
// 別の取得は消さずに積む。
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

  // 上限超過は保存失敗にせず、取得があった事実と同一性だけを残す（#292）
  test('本文を持たない行（omitted:oversize）も書ける', () => {
    ins.run('cap-1', 'api:x/tweet-result', '2026-01-01', 'application/json', 'omitted:oversize', 'hash-big', 9_000_000, null);
    expect(sqlite.prepare("SELECT payload, byteLength FROM raw_payloads WHERE sha256 = 'hash-big'").get()).toEqual({ payload: null, byteLength: 9_000_000 });
  });
});

// #5 2026-07-19: 拡張性のため意図的に制約を置いていない
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
    expect(second.sqlite.pragma('user_version', { simple: true })).toBe(15);
  });

  test('前回のデータが残る', () => {
    expect(second.sqlite.prepare("SELECT name FROM tags WHERE name = 'x'").get()).toBeTruthy();
  });
});

// テーブル名・列名のタイポはここで実行時ではなく型検査で落ちる
test('Kysely の型付き Schema が実 DDL と噛み合う', async () => {
  const { db } = openDatabase(mkdb());
  await db.insertInto('tags').values({ name: 'タイプチェック用' }).execute();

  const row = await db.selectFrom('tags').select(['id', 'name', 'kind', 'reading']).executeTakeFirst();
  expect(row?.name).toBe('タイプチェック用');
});
