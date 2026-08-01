// Unit test for app/src/main/lib-db.ts, the SQLite engine layer (#294 / #5
// St1). Two parts:
//   1. runMigrations against a fake db = application order, user_version
//      bookkeeping, resuming partway through, and rollback on failure can all be checked with no file involved.
//   2. openDatabase against a real temporary database. This is also where St1's
//      acceptance criterion — "read + WAL + FTS5 trigram partial matching on
//      Japanese" — is mechanically checked = if the shipped native binary loses
//      FTS5 or its trigram tokenizer, this suite turns red before it's ever noticed in St2.
//
// Runs on plain Node (no Electron needed): better-sqlite3 bundles a prebuilt
// N-API binary that loads under either runtime (see app/src/main/lib-db.ts).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { DatabaseCorruptError, openDatabase, runMigrations } from '../app/src/main/lib-db';

// Records every statement executed, so order and how transactions wrap them can be checked
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

  // A database already at version 1 must skip the first migration entirely = re-running it would fail on the existing table
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

  // Downgrade guard: when an old build opens a library, it must refuse to run
  // queries against a schema it doesn't recognize, rather than actually issuing them
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

  // store_state is where the organization layer keeps single items that don't
  // become a "row" (the tag vocabulary's labels, the last folder that was
  // selected). If it isn't usable immediately even on a brand-new database, the
  // IPC writer fails on its very first write.
  test('store-state のマーカーが保存できる', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.prepare("INSERT INTO store_state (key, value) VALUES ('activeFolderId', 'f-1')").run();

    expect(sqlite.prepare("SELECT value FROM store_state WHERE key = 'activeFolderId'").get().value).toBe('f-1');

    sqlite.close();
  });

  test('編集専用フィールドが DB 直書き経路で表現できる', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt, userKind, tagReviewed) VALUES ('st5-post', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'media', 1)").run();

    expect(sqlite.prepare("SELECT userKind, tagReviewed FROM posts WHERE captureId = 'st5-post'").get()).toEqual({ userKind: 'media', tagReviewed: 1 });

    sqlite.close();
  });

  // St1's acceptance criterion itself: FTS5 is built in and the trigram
  // tokenizer works, matching even a Japanese substring that starts partway through a token
  test('FTS5 の trigram が日本語の部分文字列に一致する', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.exec("CREATE VIRTUAL TABLE fts USING fts5(body, tokenize='trigram')");
    sqlite.prepare('INSERT INTO fts(body) VALUES (?)').run('吾輩は猫である名前はまだ無い');

    expect(sqlite.prepare('SELECT body FROM fts WHERE fts MATCH ?').all('"猫である"')).toHaveLength(1);

    sqlite.close();
  });

  // Reopening is a no-op, not a re-run (user_version represents the applied set, and WAL stays in the file header)
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

    // If the handle isn't closed on that path, Windows keeps holding the file open
    test('拒否したファイルを掴んだままにしない', () => {
      expect(() => openDatabase(file)).toThrow();
      fs.rmSync(file);
      expect(fs.existsSync(file)).toBe(false);
    });
  });
});
