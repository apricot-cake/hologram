// Unit tests for app/src/main/lib-derived-db.ts, the SQLite engine for the
// derived-data store (#833, parent #98). Mirrors scripts/db.test.ts's shape
// (openDatabase's tests), plus #833's own acceptance criteria:
//   - derived.db lives in its own file, never touching hologram.db's schema
//     or on-disk size (criteria 1-2), and never inside the save folder
//     (criterion 3).
//   - a segment-keyed feature table (one PDF -> many segments, selectable by
//     modelId/modelRev) is possible on top of the shared key convention
//     (criterion 4) — no real feature table exists yet (#48/#49/#50/#51 are
//     separate, unimplemented Issues), so this suite builds a throwaway one
//     with the SAME convention #833's design settled on, to prove the
//     mechanism rather than any one feature's business schema.
//   - deleting a capture for good removes its rows everywhere in derived.db
//     (criterion 5's DB half — the trash-timing half is
//     scripts/ipc-trash-derived-purge.test.ts).
//
// Runs on plain Node, like lib-db.ts's own suite: better-sqlite3's prebuilt
// N-API binary needs no rebuild step under either runtime.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { derivedDbFile, openDerivedDatabase, purgeDerivedForCapture, runMigrations } from '../app/src/main/lib-derived-db';

const dirs: string[] = [];
function mkdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-derived-db-'));
  dirs.push(dir);
  return dir;
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
  // Same fake-db shape as lib-db.ts's own suite — order/transaction/version
  // bookkeeping is checkable with no file involved.
  function fakeDb(startVersion = 0) {
    const log: string[] = [];
    let version = startVersion;
    return {
      log,
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

  test('配列順に適用し、user_version を進める', () => {
    const db = fakeDb();
    const r = runMigrations(db, [
      { name: 'first', up: (d: any) => d.exec('CREATE TABLE a(x)') },
      { name: 'second', up: (d: any) => d.exec('CREATE TABLE b(x)') },
    ]);
    expect(r).toEqual({ from: 0, to: 2 });
    expect(db.log).toEqual(['BEGIN', 'CREATE TABLE a(x)', 'PRAGMA user_version = 1', 'COMMIT', 'BEGIN', 'CREATE TABLE b(x)', 'PRAGMA user_version = 2', 'COMMIT']);
  });

  test('失敗したマイグレーションはロールバックし、名指しした例外を投げる', () => {
    const db = fakeDb();
    expect(() =>
      runMigrations(db, [
        {
          name: 'boom',
          up: () => {
            throw new Error('bad DDL');
          },
        },
      ]),
    ).toThrow(/derived-db migration 1 \(boom\) failed: bad DDL/);
    expect(db.log).toContain('ROLLBACK');
  });
});

describe('openDerivedDatabase', () => {
  test('WAL が有効で、derived_progress テーブルができている', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'derived_progress'").get()).toBeTruthy();
    sqlite.close();
  });

  test('開き直しても既存の行が残る（再マイグレーションしない）', () => {
    const file = derivedDbFile(mkdir());
    const first = openDerivedDatabase(file);
    first.sqlite.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES ('cap-1', 'file', 'ocr', 1, 3, '2026-01-01')").run();
    first.sqlite.close();

    const second = openDerivedDatabase(file);
    expect(second.sqlite.prepare("SELECT indexedSegments, totalSegments FROM derived_progress WHERE captureId = 'cap-1'").get()).toEqual({ indexedSegments: 1, totalSegments: 3 });
    second.sqlite.close();
  });

  // 受け入れ条件: derived.db を削除してもアプリが起動する — 壊れたファイルを
  // 投げ返さず、黙って新しく作り直す(このストアは再構築可能で、真実源ではない)。
  test('壊れたファイルは破棄して作り直す（DatabaseCorruptError を投げない）', () => {
    const file = derivedDbFile(mkdir());
    fs.writeFileSync(file, Buffer.from('not a sqlite file — a truncated download, say'));

    const { sqlite } = openDerivedDatabase(file);
    expect(sqlite.pragma('quick_check', { simple: true })).toBe('ok');
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'derived_progress'").get()).toBeTruthy();
    sqlite.close();
  });

  // 受け入れ条件: derived.db を削除してもライブラリの内容が1件も欠けない —
  // 派生ストアの操作は hologram.db に一切触れないことを、実データで確かめる。
  test('derived.db を削除して開き直しても hologram.db のデータは無事（ファイルも別）', () => {
    const configDir = mkdir();
    const saveFolder = mkdir();
    const hologramFile = path.join(saveFolder, 'hologram.db');
    const holo = openDatabase(hologramFile);
    holo.sqlite.prepare("INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES ('cap-1', '2026-01-01', '2026-01-01')").run();
    holo.sqlite.close();
    const sizeBefore = fs.statSync(hologramFile).size;

    const derivedFile = derivedDbFile(configDir);
    expect(derivedFile).not.toBe(hologramFile);
    const first = openDerivedDatabase(derivedFile);
    first.sqlite.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES ('cap-1', 'file', 'ocr', 3, 3, '2026-01-01')").run();
    first.sqlite.close();
    fs.rmSync(derivedFile, { force: true });

    // "reopen and the library is unaffected" — hologram.db's schema/size never moved.
    expect(fs.statSync(hologramFile).size).toBe(sizeBefore);
    const reopened = openDatabase(hologramFile);
    expect(reopened.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 1 });
    reopened.sqlite.close();

    // derived.db itself comes back empty, without throwing.
    const second = openDerivedDatabase(derivedFile);
    expect(second.sqlite.prepare('SELECT COUNT(*) AS n FROM derived_progress').get()).toEqual({ n: 0 });
    second.sqlite.close();
  });

  // 受け入れ条件: 保存フォルダに派生ファイルが1つも増えない。
  test('derived.db は設定ディレクトリに置かれ、保存フォルダには何も増えない', () => {
    const configDir = mkdir();
    const saveFolder = mkdir();
    const before = fs.readdirSync(saveFolder);
    const { sqlite } = openDerivedDatabase(derivedDbFile(configDir));
    sqlite.close();
    expect(fs.readdirSync(saveFolder)).toEqual(before);
    expect(derivedDbFile(configDir).startsWith(configDir)).toBe(true);
  });
});

// 受け入れ条件: 1つの PDF から複数セグメントの行が持てる。行から modelId /
// modelRev が読め、rev が違う行だけを選び出せる。
//
// #48/#49/#50/#51 のどれもまだ実装されていない(#833 が用意するのは「置き場と
// 鍵とスタンプ」だけ)ので、実在する機能テーブルは無い。ここでは #833 の設計が
// 決めた共有の鍵規約(captureId + assetRef + segment、modelId/modelRev の
// スタンプ)に従う仮のテーブルを立て、その規約が実際に機能することを示す。
describe('セグメント単位の派生行(将来の機能テーブルが従う鍵規約の検証)', () => {
  function withFixtureTable(sqlite: any) {
    sqlite.exec(`
      CREATE TABLE fixture_ocr_segments (
        captureId TEXT NOT NULL,
        assetRef TEXT NOT NULL,
        segment INTEGER NOT NULL,
        modelId TEXT,
        modelRev TEXT,
        text TEXT,
        PRIMARY KEY (captureId, assetRef, segment, modelRev)
      );
    `);
  }

  test('1つの PDF(1 capture)から複数ページ分の行が持てる', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    withFixtureTable(sqlite);
    const ins = sqlite.prepare('INSERT INTO fixture_ocr_segments (captureId, assetRef, segment, modelId, modelRev, text) VALUES (?,?,?,?,?,?)');
    ins.run('pdf-1', 'file', 0, 'tesseract', 'rev-a', '1ページ目');
    ins.run('pdf-1', 'file', 1, 'tesseract', 'rev-a', '2ページ目');
    ins.run('pdf-1', 'file', 2, 'tesseract', 'rev-a', '3ページ目');

    const rows = sqlite.prepare('SELECT segment FROM fixture_ocr_segments WHERE captureId = ? AND assetRef = ? ORDER BY segment').all('pdf-1', 'file');
    expect(rows.map((r: any) => r.segment)).toEqual([0, 1, 2]);
    sqlite.close();
  });

  test('modelRev が違う行だけを選び出せる(モデル更新後の再実行を旧revと区別する)', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    withFixtureTable(sqlite);
    const ins = sqlite.prepare('INSERT INTO fixture_ocr_segments (captureId, assetRef, segment, modelId, modelRev, text) VALUES (?,?,?,?,?,?)');
    ins.run('pdf-1', 'file', 0, 'tesseract', 'rev-a', '旧モデルの結果');
    ins.run('pdf-1', 'file', 0, 'tesseract', 'rev-b', '新モデルの結果');

    const current = sqlite.prepare('SELECT text FROM fixture_ocr_segments WHERE captureId = ? AND assetRef = ? AND segment = ? AND modelRev = ?').all('pdf-1', 'file', 0, 'rev-b');
    expect(current).toEqual([{ text: '新モデルの結果' }]);
    const all = sqlite.prepare('SELECT COUNT(*) AS n FROM fixture_ocr_segments WHERE captureId = ? AND assetRef = ? AND segment = ?').get('pdf-1', 'file', 0) as { n: number };
    expect(all.n).toBe(2); // both revisions still on disk — nothing overwrites the old one
    sqlite.close();
  });
});

// 受け入れ条件(DB 半分): 完全削除の連動 — captureId を跨いだ全テーブルの一括
// 削除が、そのキーの行だけ落とし他は残すことを確認する。ゴミ箱にある間は消さ
// ない、というタイミングの半分は ipc-trash 側の呼び出しどころが決める
// (scripts/ipc-trash-derived-purge.test.ts)。
describe('purgeDerivedForCapture: captureId 単位で全テーブルから消える', () => {
  test('対象 captureId の行だけ消え、他の capture・他のテーブルは残る', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    sqlite.exec(`
      CREATE TABLE fixture_tags (
        captureId TEXT NOT NULL,
        assetRef TEXT NOT NULL,
        segment INTEGER NOT NULL,
        modelId TEXT,
        modelRev TEXT,
        label TEXT
      );
    `);
    sqlite.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES ('cap-1', 'file', 'ocr', 3, 3, '2026-01-01')").run();
    sqlite.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES ('cap-2', 'image', 'tag', 1, 1, '2026-01-01')").run();
    sqlite.prepare("INSERT INTO fixture_tags (captureId, assetRef, segment, modelId, modelRev, label) VALUES ('cap-1', 'image', 0, 'm', 'r1', '猫')").run();
    sqlite.prepare("INSERT INTO fixture_tags (captureId, assetRef, segment, modelId, modelRev, label) VALUES ('cap-2', 'image', 0, 'm', 'r1', '犬')").run();

    purgeDerivedForCapture(sqlite, 'cap-1');

    const n = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT COUNT(*) AS n FROM derived_progress WHERE captureId = 'cap-1'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM fixture_tags WHERE captureId = 'cap-1'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM derived_progress WHERE captureId = 'cap-2'")).toBe(1);
    expect(n("SELECT COUNT(*) AS n FROM fixture_tags WHERE captureId = 'cap-2'")).toBe(1);
    sqlite.close();
  });

  test('captureId 列を持たないテーブルには触らない(sqlite_master の内部テーブルも含め空振りで終わる)', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    expect(() => purgeDerivedForCapture(sqlite, 'nonexistent')).not.toThrow();
    sqlite.close();
  });
});
