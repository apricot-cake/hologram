// 現行スキーマのテーブル、列、制約、全文検索を実際のSQLiteで確認する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { POST_COLUMNS } from '../../app/src/main/lib-db-record-writer';

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

test('v44の投稿を保ったまま保存の種類を追加する', () => {
  const file = mkdb();
  const previous = openDatabase(file);
  previous.sqlite.exec('ALTER TABLE posts DROP COLUMN saveScope; PRAGMA user_version = 44');
  previous.sqlite.prepare('INSERT INTO posts(captureId, text, capturedAt, updatedAt) VALUES (?, ?, ?, ?)').run('existing', '保存済みの本文', '2026-09-01', '2026-09-01');
  previous.sqlite.close();
  const current = openDatabase(file);
  try {
    expect(current.sqlite.prepare('SELECT captureId, text, saveScope FROM posts').get()).toEqual({ captureId: 'existing', text: '保存済みの本文', saveScope: 'post' });
    expect(current.sqlite.pragma('user_version', { simple: true })).toBe(45);
  } finally {
    current.sqlite.close();
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

describe('現行スキーマのテーブルが揃う', () => {
  const { sqlite } = openDatabase(mkdb());
  const names = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name),
  );
  sqlite.close();

  test('user_version は 45', () => {
    const { sqlite } = openDatabase(mkdb());
    expect(sqlite.pragma('user_version', { simple: true })).toBe(45);
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
    expect(names.has('clip_items')).toBe(false);
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

describe('現行データベースの開き直しは no-op', () => {
  const file = mkdb();
  const first = openDatabase(file);
  first.sqlite.prepare("INSERT INTO tags (name) VALUES ('x')").run();
  first.sqlite.close();
  const second = openDatabase(file);

  test('現行形式のバージョンを保つ', () => {
    expect(second.sqlite.pragma('user_version', { simple: true })).toBe(45);
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
