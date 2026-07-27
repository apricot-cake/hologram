// app/src/main/lib-db.ts のユニットテスト＝SQLite エンジン層（#294 / #5 St1）。2部構成:
//   1. runMigrations を偽の db に対して＝適用順・user_version の記帳・途中からの再開・
//      失敗時のロールバックを、ファイル無しで検査できる。
//   2. openDatabase を本物の一時データベースに対して。St1 の受け入れ条件
//      「読み込み + WAL + FTS5 trigram の日本語部分一致」が機械的に検査されるのもここ＝
//      出荷するネイティブバイナリが FTS5 や trigram トークナイザを失ったら、St2 で気付く
//      前にこのスイートが赤くなる。
//
// 素の Node で動く（Electron 不要）: better-sqlite3 は N-API のビルド済みバイナリを
// 同梱していて、どちらのランタイムでも読み込める（app/src/main/lib-db.ts 参照）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { DatabaseCorruptError, openDatabase, runMigrations } from '../app/src/main/lib-db';

// 実行された文を全部記録するので、順序とトランザクションの囲み方を検査できる
function fakeDb(startVersion = 0) {
  const log: string[] = [];
  let version = startVersion;
  return {
    log,
    get version() {
      return version;
    },
    exec(sql: string) {
      log.push(sql);
      const m = /^PRAGMA user_version = (\d+)$/.exec(sql);
      if (m) version = Number(m[1]);
    },
    pragma(source: string) {
      if (source === 'user_version') return version;
      throw new Error(`unexpected pragma: ${source}`);
    },
  };
}

const dirs: string[] = [];
function mkdb(name = 'test.db') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-db-'));
  dirs.push(dir);
  return path.join(dir, name);
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

describe('runMigrations', () => {
  test('配列順に適用し、1つずつトランザクションで囲み、その中で version を上げる', () => {
    const db = fakeDb();
    const r = runMigrations(db, [
      { name: 'first', up: (d: any) => d.exec('CREATE TABLE a(x)') },
      { name: 'second', up: (d: any) => d.exec('CREATE TABLE b(x)') },
    ]);

    expect(r).toEqual({ from: 0, to: 2 });
    expect(db.log).toEqual(['BEGIN', 'CREATE TABLE a(x)', 'PRAGMA user_version = 1', 'COMMIT', 'BEGIN', 'CREATE TABLE b(x)', 'PRAGMA user_version = 2', 'COMMIT']);
  });

  // すでに version 1 のデータベースは1本目を完全に飛ばさなければならない＝
  // 再実行すると既存テーブルで落ちる
  test('user_version から再開し、適用済みを飛ばす', () => {
    const ran: string[] = [];
    runMigrations(fakeDb(1), [
      { name: 'first', up: () => ran.push('first') },
      { name: 'second', up: () => ran.push('second') },
    ]);

    expect(ran).toEqual(['second']);
  });

  describe('失敗したとき', () => {
    const failing = [
      { name: 'first', up: () => {} },
      {
        name: 'boom',
        up: () => {
          throw new Error('bad DDL');
        },
      },
    ];

    test('落ちたマイグレーションを名指しする', () => {
      expect(() => runMigrations(fakeDb(), failing)).toThrow(/migration 2 \(boom\) failed: bad DDL/);
    });

    test('ロールバックし、version は最後に成功したところで止まる（次回そこから再開できる）', () => {
      const db = fakeDb();
      expect(() => runMigrations(db, failing)).toThrow();
      expect(db.log).toContain('ROLLBACK');
      expect(db.version).toBe(1);
    });
  });

  // ダウングレードガード: 古いビルドが開いたライブラリは、知らないスキーマに対して
  // クエリを投げるのでなく拒否しなければならない
  test('未来のスキーマは拒否する', () => {
    expect(() => runMigrations(fakeDb(5), [{ name: 'only', up: () => {} }])).toThrow(/schema is newer than this build/);
  });
});

describe('openDatabase', () => {
  test('WAL と外部キーが有効で、Kysely インスタンスを返す', () => {
    const { db, sqlite } = openDatabase(mkdb());

    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(typeof db.selectFrom).toBe('function');

    sqlite.close();
  });

  // St5 は「どちらが正か」の切り替えをデータベース自身に持たせる。IPC の書き手が
  // 頼り始める前に、新規データベースでもマーカーが使えていなければならない。
  test('store-state のマーカーが保存できる', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.prepare("INSERT INTO store_state (key, value) VALUES ('truthSource', 'db')").run();

    expect(sqlite.prepare("SELECT value FROM store_state WHERE key = 'truthSource'").get().value).toBe('db');

    sqlite.close();
  });

  test('編集専用フィールドが DB 直書き経路で表現できる', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt, userKind, tagReviewed) VALUES ('st5-post', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'media', 1)").run();

    expect(sqlite.prepare("SELECT userKind, tagReviewed FROM posts WHERE captureId = 'st5-post'").get()).toEqual({ userKind: 'media', tagReviewed: 1 });

    sqlite.close();
  });

  // St1 の受け入れ条件そのもの: FTS5 が組み込まれていて trigram トークナイザが使え、
  // トークンの途中から始まる日本語の部分文字列でも一致する
  test('FTS5 の trigram が日本語の部分文字列に一致する', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.exec("CREATE VIRTUAL TABLE fts USING fts5(body, tokenize='trigram')");
    sqlite.prepare('INSERT INTO fts(body) VALUES (?)').run('吾輩は猫である名前はまだ無い');

    expect(sqlite.prepare('SELECT body FROM fts WHERE fts MATCH ?').all('"猫である"')).toHaveLength(1);

    sqlite.close();
  });

  // 開き直しは再実行ではなく no-op（user_version が適用済み集合を表し、WAL は
  // ファイルヘッダに残る）
  test('開き直しても既存テーブルが残る', () => {
    const file = mkdb();
    const first = openDatabase(file);
    first.sqlite.exec('CREATE TABLE keep(x)');
    first.sqlite.close();

    const second = openDatabase(file);
    expect(second.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'keep'").get()).toBeTruthy();
    second.sqlite.close();
  });

  describe('データベースでないファイル', () => {
    const file = mkdb('garbage.db');
    fs.writeFileSync(file, Buffer.from('not a sqlite file — a truncated download, say'));

    test('破損として拒否する', () => {
      expect(() => openDatabase(file)).toThrow(DatabaseCorruptError);
    });

    // その経路でハンドルを閉じておかないと Windows はファイルを掴んだままになる
    test('拒否したファイルを掴んだままにしない', () => {
      expect(() => openDatabase(file)).toThrow();
      fs.rmSync(file);
      expect(fs.existsSync(file)).toBe(false);
    });
  });
});
