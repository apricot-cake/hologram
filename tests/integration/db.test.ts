// 現行DBの初期化・再接続・異なる形式の拒否を確認する。
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { DatabaseCorruptError, openDatabase } from '../../app/src/main/lib-db';

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
      /* 片付けはできる範囲で */
    }
  }
});

describe('openDatabase', () => {
  test('WAL と外部キーが有効で、Kysely インスタンスを返す', () => {
    const { db, sqlite } = openDatabase(mkdb());

    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(typeof db.selectFrom).toBe('function');

    sqlite.close();
  });

  // store_state は、整理の層が「行」にならない単発の項目を置く場所（タグ語彙のラベル、
  // 最後に選んだフォルダ）。真新しいデータベースでもすぐ使えなければ、IPC の書き手は
  // いちばん最初の書き込みで落ちる。
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

  // St1 の受け入れ条件そのもの。FTS5 が組み込まれていて、trigram のトークナイザが働き、
  // トークンの途中から始まる日本語の部分文字列にも一致する
  test('FTS5 の trigram が日本語の部分文字列に一致する', () => {
    const { sqlite } = openDatabase(mkdb());
    sqlite.exec("CREATE VIRTUAL TABLE fts USING fts5(body, tokenize='trigram')");
    sqlite.prepare('INSERT INTO fts(body) VALUES (?)').run('吾輩は猫である名前はまだ無い');

    expect(sqlite.prepare('SELECT body FROM fts WHERE fts MATCH ?').all('"猫である"')).toHaveLength(1);

    sqlite.close();
  });

  // 開き直しても何もしない。流し直しではない（user_version が適用済みの集合を表し、WAL はファイルのヘッダに残る）
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

    // その経路でハンドルを閉じないと、Windows はファイルを掴んだままになる
    test('拒否したファイルを掴んだままにしない', () => {
      expect(() => openDatabase(file)).toThrow();
      fs.rmSync(file);
      expect(fs.existsSync(file)).toBe(false);
    });
  });
});

describe('現行形式と更新元以外のDBを変更しない', () => {
  test.each([0, 1, 43, 44, 45, 46, 47, 48, 54])('バージョン %i の既存DBは書き換えず拒否する', (version) => {
    const file = mkdb();
    const before = new Database(file);
    before.exec("CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES ('keep')");
    before.pragma(`user_version = ${version}`);
    before.close();
    expect(() => openDatabase(file)).toThrow(/Unsupported database schema/);
    expect(() => openDatabase(file, { readonly: true })).toThrow(/Unsupported database schema/);
    const after = new Database(file, { readonly: true });
    expect(after.pragma('user_version', { simple: true })).toBe(version);
    expect(after.prepare('SELECT value FROM sentinel').get()).toEqual({ value: 'keep' });
    expect(after.prepare("SELECT name FROM sqlite_schema WHERE name = 'posts'").get()).toBeUndefined();
    after.close();
  });
});
