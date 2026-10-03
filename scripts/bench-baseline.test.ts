import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db.ts';

const { snapshotDatabase } = require('./bench-baseline.cts');

describe('bench-baseline のデータベーススナップショット', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('書き換えを一時DBに隔離し、後から作られたソースの WAL/SHM を削除しない', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-bench-test-'));
    roots.push(root);
    const sourceFile = path.join(root, 'library', 'hologram.db');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });

    const initialized = openDatabase(sourceFile);
    initialized.sqlite.exec('CREATE TABLE benchmark_guard (value TEXT)');
    initialized.sqlite.close();
    expect(fs.existsSync(`${sourceFile}-wal`)).toBe(false);
    expect(fs.existsSync(`${sourceFile}-shm`)).toBe(false);

    const snapshot = await snapshotDatabase(sourceFile);
    const copy = new Database(snapshot.dbFile);
    copy.prepare('INSERT INTO benchmark_guard VALUES (?)').run('一時DBだけの変更');
    copy.close();

    // スナップショット完了後、cleanup より前に別接続がソースを利用する競合を再現する。
    const concurrent = new Database(sourceFile);
    concurrent.pragma('journal_mode = WAL');
    concurrent.prepare('SELECT count(*) FROM benchmark_guard').get();
    expect(fs.existsSync(`${sourceFile}-wal`)).toBe(true);
    expect(fs.existsSync(`${sourceFile}-shm`)).toBe(true);

    snapshot.cleanup();

    expect(fs.existsSync(snapshot.dbFile)).toBe(false);
    expect(fs.existsSync(sourceFile)).toBe(true);
    expect(fs.existsSync(`${sourceFile}-wal`)).toBe(true);
    expect(fs.existsSync(`${sourceFile}-shm`)).toBe(true);
    expect(concurrent.prepare('SELECT count(*) AS count FROM benchmark_guard').get()).toEqual({ count: 0 });
    concurrent.close();
  });
});
