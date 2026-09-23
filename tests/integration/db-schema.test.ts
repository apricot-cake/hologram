// 現行スキーマのテーブル、列、制約、全文検索を実際のSQLiteで確認する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';

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

const EXPECTED_TABLES = ['posts', 'media', 'tags', 'post_tags', 'folders', 'folder_items', 'poster_folders', 'poster_folder_items', 'poster_tags', 'manual_groups', 'manual_group_items', 'ungrouped_keys', 'tabs', 'tab_windows', 'store_state', 'inbox_events', 'inbox_segments', 'history', 'poster_profiles'];

describe('現行スキーマのテーブルが揃う', () => {
  const { sqlite } = openDatabase(mkdb());
  const names = new Set(
    sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r: any) => r.name),
  );
  sqlite.close();

  test('user_version は 50', () => {
    const { sqlite } = openDatabase(mkdb());
    expect(sqlite.pragma('user_version', { simple: true })).toBe(50);
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
  test('旧検索索引を作らない', () => {
    expect(names.has('posts_fts')).toBe(false);
  });

  test('廃止されたテーブルは落ちている', () => {
    expect(names.has('clip_items')).toBe(false);
    expect(names.has('poster_workspace_items')).toBe(false); // drop-poster-workspace-items
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
    expect(second.sqlite.pragma('user_version', { simple: true })).toBe(50);
  });

  test('前回のデータが残る', () => {
    expect(second.sqlite.prepare("SELECT name FROM tags WHERE name = 'x'").get()).toBeTruthy();
  });
});

// テーブル名や列名の打ち間違いは、実行時ではなくここの型検査で落ちる
test('Kysely の型付き Schema が実 DDL と噛み合う', async () => {
  const { db } = openDatabase(mkdb());
  await db.insertInto('tags').values({ name: 'タイプチェック用' }).execute();

  const row = await db.selectFrom('tags').select(['id', 'name', 'groupId', 'reading']).executeTakeFirst();
  expect(row?.name).toBe('タイプチェック用');
});
