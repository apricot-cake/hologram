// v1 の DDL（#5 St2 / #295・app/src/main/lib-db-schema.ts）を、app/src/main/lib-db.ts の
// 本物のマイグレーション実行器へ通す単体テスト。db.test.ts が順序とトランザクションを見る
// のに使う偽の db ではなく本物を使うのは、ここでの問いが「SQL が実際に解析でき、制約が
// 実際に効くか」だから。
//
// St2 はスキーマだけ（これらのテーブルを埋めるものはまだ無い＝サイドカーの取り込みは St3）
// なので、ここで書く行は使い捨てで、制約が発火することを示すためのもの。実際のデータの
// 流れではない。

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
      /* できる範囲での片付け */
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
  'history',
  'poster_profiles',
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

  test('user_version は 44', () => {
    const { sqlite } = openDatabase(mkdb());
    expect(sqlite.pragma('user_version', { simple: true })).toBe(44);
    sqlite.close();
  });

  test('media は元画像を変えないクロップ座標を持つ', () => {
    const { sqlite } = openDatabase(mkdb());
    const columns = new Set((sqlite.prepare("PRAGMA table_info('media')").all() as Array<{ name: string }>).map((row) => row.name));
    for (const name of ['cropX', 'cropY', 'cropWidth', 'cropHeight']) expect(columns.has(name)).toBe(true);
    sqlite.close();
  });

  test('poster_profiles は廃止したプロフィール単独保存と Misskey 専用の列を持たない', () => {
    const { sqlite } = openDatabase(mkdb());
    const columns = new Set((sqlite.prepare("PRAGMA table_info('poster_profiles')").all() as Array<{ name: string }>).map((row) => row.name));
    expect(columns.has('savedAt')).toBe(false);
    expect(columns.has('instance')).toBe(false);
    sqlite.close();
  });

  test('posts は廃止した汎用ファイル用の列を持たない', () => {
    const { sqlite } = openDatabase(mkdb());
    const columns = new Set((sqlite.prepare("PRAGMA table_info('posts')").all() as Array<{ name: string }>).map((row) => row.name));
    expect(columns.has('file')).toBe(false);
    expect(columns.has('assetClass')).toBe(false);
    sqlite.close();
  });

  test('ローカル閲覧回数は非負で、既定値は 0', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('viewed', '2026-01-01', '2026-01-01')").run();
    expect(sqlite.prepare("SELECT localViewCount FROM posts WHERE captureId = 'viewed'").get()).toEqual({ localViewCount: 0 });
    expect(() => sqlite.prepare('UPDATE posts SET localViewCount = -1 WHERE captureId = ?').run('viewed')).toThrow(/CHECK/);
    sqlite.close();
  });

  test.each(EXPECTED_TABLES)('テーブル %s がある', (t) => {
    expect(names.has(t)).toBe(true);
  });

  // FTS5 は影のテーブル（posts_fts_data / _idx / _docsize / _config）も一緒に登録する
  test('posts_fts の仮想テーブルがある', () => {
    expect(names.has('posts_fts')).toBe(true);
  });

  test('廃止されたテーブルは落ちている', () => {
    expect(names.has('clip_items')).toBe(false); // #135 のマイグレーション
    expect(names.has('poster_workspace_items')).toBe(false); // drop-poster-workspace-items
  });
});

// #5 で 2026-07-17/18 に確定した項目
describe('posts_fts のクエリ契約', () => {
  const { sqlite } = openDatabase(mkdb());
  const ins = sqlite.prepare('INSERT INTO posts_fts (postId, text, title, displayName, screenName, eagleName, hashtags, tagsText, reading) VALUES (?,?,?,?,?,?,?,?,?)');
  ins.run('cap-1', '吾輩は猫である名前はまだ無い', null, null, null, null, null, null, 'わがはいはねこであるなまえはまだない');
  ins.run('cap-2', '犬も歩けば棒に当たる', null, null, null, null, null, null, 'いぬもあるけばぼうにあたる');

  // trigram はトークンを作るのに3文字以上を要する＝1文字で素朴に検索すると、黙って0件を返す。
  // db.test.ts が4文字の語句を使って避けているのと同じ罠。
  const hit = sqlite.prepare('SELECT postId, bm25(posts_fts) AS rank FROM posts_fts WHERE posts_fts MATCH ? ORDER BY rank').all('"猫である"');

  test('MATCH は索引列を検索する（トークン途中の部分文字列も＝trigram）', () => {
    expect(hit).toHaveLength(1);
  });

  test('postId は UNINDEXED 列として往復する', () => {
    expect(hit[0].postId).toBe('cap-1');
  });

  // #5 の 2026-07-18 のコメント: rank は保存された列ではなく bm25() の呼び出し
  test('bm25(posts_fts) が rank の契約', () => {
    expect(typeof hit[0].rank).toBe('number');
  });

  // reading を埋めるのは #164 の仕事。St2 では列とクエリの形があることだけを示す。
  test('reading 列は単独で引ける（列スコープの MATCH）', () => {
    expect(sqlite.prepare('SELECT postId FROM posts_fts WHERE posts_fts MATCH ?').all('reading:"ねこである"')).toHaveLength(1);
  });
});

// #444。FTS5 の仮想テーブルは MATCH と rowid 以外に索引を持たない＝UNINDEXED の列を条件に
// すると、毎回、索引を全部走査することになる。EXPLAIN QUERY PLAN は仮想テーブルに対して常に
// "SCAN ... VIRTUAL TABLE INDEX <数字>:<文字列>" と出し、見分けが付くのは末尾の文字列
// （FTS5 の xBestIndex が選んだ経路）だけ＝空文字なら無制約の走査、"=" なら rowid での一致。
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

// 既存のライブラリが壊れないこと。#444 の直前まで進めた本物の DB を組み立て、旧来のやり方で
// 行を入れ（postId を指定し、rowid は posts と無関係）、そのうえで開き直す。
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
  insFts.run('cap-gone', '持ち主のいない索引行', '', ''); // 投稿が消えたあとに残った孤児
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

// #178: 既存のライブラリが壊れないこと。fts-rowid-addressing の直前まで進めた本物の DB
// （cw 列も posts_fts の cw 列もまだ無い状態）を組み立て、add-post-cw-sensitive まで通して
// 開き直す。FTS5 には ALTER が無いので posts_fts は丸ごと作り直される（#444 と同じ手口）。
// ここで見るのは、既存の text/hashtags/tagsText への MATCH が退行しないこと、ftsRowid が
// 引き継がれること、新たに足した cw 列が既存の行では NULL のまま（何も名乗らない）である
// こと、そして次に posts.cw を持つ行を書けば検索に乗ること。
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

  const { sqlite } = openDatabase(file); // ここで add-post-cw-sensitive が走る
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

describe('add-media-max-dims の移行（#162）', () => {
  const file = mkdb();
  const before = new Database(file);
  runMigrations(
    before,
    MIGRATIONS.slice(
      0,
      MIGRATIONS.findIndex((m) => m.name === 'add-media-max-dims'),
    ),
  );
  before.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, hashtags) VALUES (?,?,?,?)').run('cap-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '[]');
  before.close();

  const { sqlite } = openDatabase(file); // ここで add-media-max-dims が走る
  afterAll(() => sqlite.close());

  test('posts.mediaMaxW / mediaMaxH / mediaMaxBytes 列ができる', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('mediaMaxW');
    expect(cols).toContain('mediaMaxH');
    expect(cols).toContain('mediaMaxBytes');
  });

  test('移行前の行は NULL のまま（バックフィルしない — #162 の書き込み時のみ測る設計）', () => {
    expect(sqlite.prepare("SELECT mediaMaxW, mediaMaxH, mediaMaxBytes FROM posts WHERE captureId = 'cap-1'").get()).toEqual({ mediaMaxW: null, mediaMaxH: null, mediaMaxBytes: null });
  });
});

// #36: 既存のライブラリが壊れないこと。rename-description-to-memo の直前まで進めた本物の
// DB を組み立てる。この時点で posts.description はまだ実在する（改名するのはこのマイグレーション
// だけ）。そのうえで改名まで通して開き直す。上の add-post-cw-sensitive のブロックとは違い、
// ここでは posts_fts に手で種を入れない。このマイグレーションは、以前の中身が何であれ
// posts_fts を落として `posts` から丸ごと作り直す（あちらが cw に対してしたのと同じ）ので、
// 効くフィクスチャは posts の行とその ftsRowid だけ。
describe('投稿メモ撤去の移行', () => {
  const file = mkdb();
  const before = new Database(file);
  runMigrations(
    before,
    MIGRATIONS.slice(
      0,
      MIGRATIONS.findIndex((m) => m.name === 'rename-description-to-memo'),
    ),
  );
  before.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, text, description) VALUES (?,?,?,?,?)').run('cap-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '吾輩は猫である', 'Eagle 由来の旧い注釈');
  before.exec("UPDATE posts SET ftsRowid = 1 WHERE captureId = 'cap-1'");
  before.close();

  const { sqlite } = openDatabase(file);
  afterAll(() => sqlite.close());

  test('posts は description と memo のどちらも持たない', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(posts)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain('description');
    expect(cols).not.toContain('memo');
  });

  test('posts_fts も memo 列を持たず、本文の索引は保つ', () => {
    const cols = (sqlite.prepare('PRAGMA table_info(posts_fts)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain('memo');
    expect(sqlite.prepare("SELECT postId FROM posts_fts WHERE posts_fts MATCH '猫である'").get()).toEqual({ postId: 'cap-1' });
  });

  test('ftsRowid は引き継がれる', () => {
    expect(sqlite.prepare('SELECT ftsRowid FROM posts WHERE captureId = ?').get('cap-1')).toEqual({ ftsRowid: 1 });
  });
});

describe('tags: id が実体・名前は一意でない・多親＋表示用の親は1つ', () => {
  const { sqlite } = openDatabase(mkdb());
  const insTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
  const alice1 = insTag.run('アリス').lastInsertRowid;
  const alice2 = insTag.run('アリス').lastInsertRowid; // 同名の別実体（このスキーマが #21 の問題を解く）
  const touhou = insTag.run('東方').lastInsertRowid;
  const ba = insTag.run('ブルーアーカイブ').lastInsertRowid;
  const insParent = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?,?,?)');
  insParent.run(alice1, touhou, 1); // alice1 を曖昧さ回避するための親
  insParent.run(alice1, ba, 0); // 2つ目の親（表示用ではない）＝多親を許す

  test('同名のタグが並存できる（同一性は id であって名前ではない）', () => {
    expect(alice1).not.toBe(alice2);
  });

  // 2026-07-18 10:24 のコメント
  test('タグは親を2つ以上持てる', () => {
    expect(sqlite.prepare('SELECT parentTagId, isDisplay FROM tag_parents WHERE tagId = ? ORDER BY parentTagId').all(alice1)).toHaveLength(2);
  });

  test('表示用の親はタグごとに高々1つ', () => {
    expect(() => insParent.run(alice1, ba, 1)).toThrow(/UNIQUE constraint failed/);
  });

  // 部分索引の「高々1つ」は tagId ごとであって、全体でではない
  test('別のタグは自分の表示用の親を持てる', () => {
    expect(() => insParent.run(alice2, touhou, 1)).not.toThrow();
  });
});

describe('FK カスケード: 投稿を消すと media/post_tags/folder_items も消える', () => {
  const { sqlite } = openDatabase(mkdb());
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-1', '2026-01-01', '2026-01-01')").run();
  sqlite.prepare("INSERT INTO media (postId, seq, file) VALUES ('cap-1', 0, 'cap-1-media-0.jpg')").run();
  const tagId = sqlite.prepare('INSERT INTO tags (name) VALUES (?)').run('タグ').lastInsertRowid;
  sqlite.prepare('INSERT INTO post_tags (postId, tagId) VALUES (?,?)').run('cap-1', tagId);
  sqlite.prepare("INSERT INTO folders (id, name) VALUES ('f1', 'フォルダ')").run();
  sqlite.prepare("INSERT INTO folder_items (folderId, postId) VALUES ('f1', 'cap-1')").run();
  sqlite.prepare("DELETE FROM posts WHERE captureId = 'cap-1'").run();

  const count = (table: string) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  test.each(['media', 'post_tags', 'folder_items'])('%s がカスケードで消える', (table) => {
    expect(count(table)).toBe(0);
  });

  // タグ自体には触れない＝消えた投稿を参照する中間テーブルの行だけが消える
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

// #5 2026-07-19: 拡張の余地を残すため、意図して無制約にしてある
// #919。不具合はスキーマと実装の食い違いだった。posterKeyOf は #760 以降、プラットフォームを
// 持たない投稿者のために `web:<host>:<id>` の枝を持っていたのに、列がその行を拒んでいたので、
// 著者を名乗るページのブックマークは取り込みのたびに例外を投げていた。これを緩める作り直しは、
// カスケード元のテーブルの DROP をまたいで poster_profile_snapshots を運ばなければならず、
// 固定する値打ちがあるのはそこ。
describe('poster_profiles.platform は null を取れる（#919）', () => {
  const { sqlite } = openDatabase(mkdb());
  const insert = (posterKey: string, platform: string | null) =>
    sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, userId, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,?,?,?,?,?,?)').run(posterKey, platform, 'https://qiita.com/Y-Y-dev', 'hash', 'api:unknown', '2026-08-05', '2026-08-05');

  test('platform 無しの行が書ける（ブックマークの著者）', () => {
    insert('web:qiita.com:https://qiita.com/Y-Y-dev', null);
    expect(sqlite.prepare("SELECT platform FROM poster_profiles WHERE posterKey = 'web:qiita.com:https://qiita.com/Y-Y-dev'").get().platform).toBeNull();
  });

  test('platform 付きの行は従来どおり', () => {
    insert('x:123', 'x');
    expect(sqlite.prepare("SELECT platform FROM poster_profiles WHERE posterKey = 'x:123'").get().platform).toBe('x');
  });

  test('他の NOT NULL は緩んでいない', () => {
    expect(() => sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?,NULL,NULL,?,?,?)').run('web:example.com:x', 'api:unknown', '2026-08-05', '2026-08-05')).toThrow(/NOT NULL/);
  });
});

describe('プロフィール履歴撤去のマイグレーションが現在値を保つ', () => {
  const file = mkdb();
  const upto = MIGRATIONS.findIndex((m) => m.name === 'poster-profile-platform-nullable');
  const before = new Database(file);
  before.pragma('foreign_keys = ON');
  runMigrations(before, MIGRATIONS.slice(0, upto)); // #919 より前に配ったライブラリが取っている形
  before.prepare("INSERT INTO poster_profiles (posterKey, platform, userId, instance, displayName, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES ('x:123', 'x', '123', NULL, 'アリス', 'h1', 'api:x', '2026-08-01', '2026-08-03')").run();
  before.prepare("INSERT INTO poster_profiles (posterKey, platform, userId, instance, displayName, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES ('misskey:misskey.io:9', 'misskey', '9', 'misskey.io', 'ボブ', 'h2', 'api:misskey', '2026-08-02', '2026-08-02')").run();
  const snap = before.prepare('INSERT INTO poster_profile_snapshots (posterKey, observedAt, displayName, contentHash, provenance) VALUES (?,?,?,?,?)');
  snap.run('x:123', '2026-08-01', 'アリス（旧）', 'h0', 'api:x');
  snap.run('x:123', '2026-08-03', 'アリス', 'h1', 'api:x');
  snap.run('misskey:misskey.io:9', '2026-08-02', 'ボブ', 'h2', 'api:misskey');
  before.close();

  const { sqlite } = openDatabase(file); // 残りのマイグレーションを走らせる

  test('プロフィール行が全部残る', () => {
    expect(sqlite.prepare('SELECT posterKey, platform, displayName FROM poster_profiles ORDER BY posterKey').all()).toEqual([
      { posterKey: 'misskey:misskey.io:9', platform: 'misskey', displayName: 'ボブ' },
      { posterKey: 'x:123', platform: 'x', displayName: 'アリス' },
    ]);
  });

  test('履歴テーブルと作業用テーブルを残さない', () => {
    const names = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'poster_profile%'")
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(names).toEqual(['poster_profiles']);
  });
});

describe('既存 v1 データベースの開き直しは no-op', () => {
  const file = mkdb();
  const first = openDatabase(file);
  first.sqlite.prepare("INSERT INTO tags (name) VALUES ('x')").run();
  first.sqlite.close();
  const second = openDatabase(file);

  test('マイグレーションを再実行しない', () => {
    expect(second.sqlite.pragma('user_version', { simple: true })).toBe(44);
  });

  test('前回のデータが残る', () => {
    expect(second.sqlite.prepare("SELECT name FROM tags WHERE name = 'x'").get()).toBeTruthy();
  });
});

// テーブル名や列名の打ち間違いは、実行時ではなくここの型検査で落ちる
test('Kysely の型付き Schema が実 DDL と噛み合う', async () => {
  const { db } = openDatabase(mkdb());
  await db.insertInto('tags').values({ name: 'タイプチェック用' }).execute();

  const row = await db.selectFrom('tags').select(['id', 'name', 'kind', 'reading']).executeTakeFirst();
  expect(row?.name).toBe('タイプチェック用');
});
