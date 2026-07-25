'use strict';

// Unit tests for app/lib-db.mts — the SQLite engine layer (#294 / #5 St1).
// Two halves:
//   1. runMigrations against a fake db, so ordering, the user_version bookkeeping,
//      resume-from-partial and rollback-on-failure are checkable without a file.
//   2. openDatabase against real temp databases, which is also where the St1
//      acceptance criterion "load + WAL + FTS5 trigram Japanese partial match"
//      is machine-checked — if the shipped native binary ever loses FTS5 or the
//      trigram tokenizer, this suite goes red instead of St2 discovering it.
//
// Plain node, no Electron: better-sqlite3 ships an N-API prebuilt binary that
// loads under both runtimes (see lib-db.mts).
//
//   node scripts/test-db-unit.cts

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, runMigrations, DatabaseCorruptError } = require('../app/lib-db.mts');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
}

// Records every statement so ordering and transaction framing are assertable.
function fakeDb(startVersion = 0) {
  const log: string[] = [];
  let version = startVersion;
  return {
    log,
    get version() {
      return version;
    },
    exec(sql) {
      log.push(sql);
      const m = /^PRAGMA user_version = (\d+)$/.exec(sql);
      if (m) version = Number(m[1]);
    },
    pragma(source) {
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

// --- runMigrations -----------------------------------------------------------

{
  const db = fakeDb();
  const migrations = [
    { name: 'first', up: (d) => d.exec('CREATE TABLE a(x)') },
    { name: 'second', up: (d) => d.exec('CREATE TABLE b(x)') },
  ];
  const r = runMigrations(db, migrations);
  assert.deepStrictEqual(r, { from: 0, to: 2 }, 'reports the applied range');
  assert.deepStrictEqual(db.log, ['BEGIN', 'CREATE TABLE a(x)', 'PRAGMA user_version = 1', 'COMMIT', 'BEGIN', 'CREATE TABLE b(x)', 'PRAGMA user_version = 2', 'COMMIT'], 'applies in array order, one transaction each, version bumped inside it');
  passed += 2;
}

{
  // A database already at version 1 must skip the first migration entirely —
  // re-running it would fail on the existing table.
  const db = fakeDb(1);
  const ran: string[] = [];
  runMigrations(db, [
    { name: 'first', up: () => ran.push('first') },
    { name: 'second', up: () => ran.push('second') },
  ]);
  assert.deepStrictEqual(ran, ['second'], 'resumes from user_version, skipping applied migrations');
  passed++;
}

{
  const db = fakeDb();
  assert.throws(
    () =>
      runMigrations(db, [
        { name: 'first', up: () => {} },
        {
          name: 'boom',
          up: () => {
            throw new Error('bad DDL');
          },
        },
      ]),
    /migration 2 \(boom\) failed: bad DDL/,
    'names the failing migration',
  );
  ok(db.log.includes('ROLLBACK'), 'rolls the failed migration back');
  assert.strictEqual(db.version, 1, 'version keeps the last SUCCESSFUL migration, so the next run resumes there');
  passed += 2;
}

{
  // Downgrade guard: a library opened by an older build must refuse rather than
  // run queries against a schema it does not know.
  const db = fakeDb(5);
  assert.throws(() => runMigrations(db, [{ name: 'only', up: () => {} }]), /schema is newer than this build/, 'refuses a future schema');
  passed++;
}

// --- openDatabase ------------------------------------------------------------

{
  const file = mkdb();
  const { db, sqlite } = openDatabase(file);
  assert.strictEqual(sqlite.pragma('journal_mode', { simple: true }), 'wal', 'WAL is on');
  assert.strictEqual(sqlite.pragma('foreign_keys', { simple: true }), 1, 'foreign keys enforced');
  ok(typeof db.selectFrom === 'function', 'returns a Kysely instance');
  passed += 2;

  // St5 persists the source-of-truth switch in the database itself. The
  // marker must be available on a fresh database before IPC writers rely on
  // it, and the edit-only fields must survive the direct DB write path.
  sqlite.prepare("INSERT INTO store_state (key, value) VALUES ('truthSource', 'db')").run();
  assert.strictEqual(sqlite.prepare("SELECT value FROM store_state WHERE key = 'truthSource'").get().value, 'db', 'store-state marker persists');
  sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt, userKind, tagReviewed) VALUES ('st5-post', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'media', 1)").run();
  const st5Post = sqlite.prepare("SELECT userKind, tagReviewed FROM posts WHERE captureId = 'st5-post'").get();
  assert.deepStrictEqual(st5Post, { userKind: 'media', tagReviewed: 1 }, 'tagging-only fields are representable in the DB');
  passed += 2;

  // The St1 acceptance criterion, as a test: FTS5 compiled in, trigram tokenizer
  // available, and a Japanese substring that starts mid-token still matches.
  sqlite.exec("CREATE VIRTUAL TABLE fts USING fts5(body, tokenize='trigram')");
  sqlite.prepare('INSERT INTO fts(body) VALUES (?)').run('吾輩は猫である名前はまだ無い');
  const hits = sqlite.prepare('SELECT body FROM fts WHERE fts MATCH ?').all('"猫である"');
  assert.strictEqual(hits.length, 1, 'FTS5 trigram matches a Japanese substring');
  passed++;

  sqlite.close();
}

{
  // Reopening must be a no-op, not a re-run: user_version already covers the
  // applied set, and WAL persists in the file header.
  const file = mkdb();
  const first = openDatabase(file);
  first.sqlite.exec('CREATE TABLE keep(x)');
  first.sqlite.close();

  const second = openDatabase(file);
  ok(second.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'keep'").get(), 'reopen preserves existing tables');
  second.sqlite.close();
}

{
  const file = mkdb('garbage.db');
  fs.writeFileSync(file, Buffer.from('not a sqlite file — a truncated download, say'));
  assert.throws(() => openDatabase(file), DatabaseCorruptError, 'a non-database file is rejected as corrupt');
  passed++;
  // The handle must be closed on that path or Windows keeps the file locked.
  fs.rmSync(file);
  ok(!fs.existsSync(file), 'the rejected file is not left locked open');
}

for (const d of dirs) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch (e) {
    /* best-effort cleanup */
  }
}

console.log(`PASS test-db-unit: ${passed} assertions`);
