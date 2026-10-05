import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createArchiveFilePublisher } from './archive-file-publisher';
import { publishArchiveFile, cleanupArchiveImport, compactArchiveImportStage } from './lib-archive-import';
import { openDatabase } from './lib-db';
import { createArchiveStage } from './archive-stage-ownership';

const folders: string[] = [];
const temp = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-publish-test-'));
  folders.push(folder);
  return folder;
};
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

test('完成した私有ファイルを非置換公開し、既存媒体を保持する', async () => {
  const folder = temp();
  const executable = process.env.HOLOGRAM_ARCHIVE_PUBLISHER ?? path.resolve('app/vendor/avif/avif-validator.exe');
  const publisher = createArchiveFilePublisher(executable);
  try {
    const source = path.join(folder, '入力.png'),
      target = path.join(folder, '既存.png');
    const data = Buffer.alloc(4 * 1024 * 1024, 91);
    fs.writeFileSync(source, data);
    const journal: string[] = [];
    expect(await publishArchiveFile(source, target, publisher.publish, (name) => journal.push(name))).toBe(true);
    expect(fs.readFileSync(target).equals(data)).toBe(true);
    fs.writeFileSync(source, 'collision');
    expect(await publishArchiveFile(source, target, publisher.publish)).toBe(false);
    expect(fs.readFileSync(target).equals(data)).toBe(true);
    expect(journal).toHaveLength(1);
    expect(fs.existsSync(journal[0])).toBe(false);
    expect(fs.readdirSync(folder).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  } finally {
    await publisher.close();
  }
});

test('中断後の journal 清掃は所有する途中ファイルだけを消し、既存媒体を保持する', async () => {
  const stage = temp(),
    destination = temp();
  const partial = path.join(destination, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
  const original = path.join(destination, 'existing.png');
  fs.writeFileSync(partial, 'incomplete');
  fs.writeFileSync(original, 'original');
  const db = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO media_publications VALUES(?)').run(partial);
  db.close();
  await cleanupArchiveImport(stage, destination);
  expect(fs.existsSync(partial)).toBe(false);
  expect(fs.readFileSync(original, 'utf8')).toBe('original');
  await cleanupArchiveImport(stage, destination);
});

test('journal が所有領域外のファイルを指しても削除しない', async () => {
  const stage = temp(),
    destination = temp(),
    outside = temp();
  const file = path.join(outside, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
  fs.writeFileSync(file, 'keep');
  const db = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO media_publications VALUES(?)').run(file);
  db.close();
  await expect(cleanupArchiveImport(stage, destination)).rejects.toThrow('invalid-import-cleanup-owner');
  expect(fs.readFileSync(file, 'utf8')).toBe('keep');
});

test('二つのドットで始まる合法な子フォルダーでは登録済み tmp だけを清掃する', async () => {
  const stage = temp(),
    destination = temp();
  const child = path.join(destination, '..media');
  fs.mkdirSync(child);
  const file = path.join(child, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
  const original = path.join(child, 'media.png');
  fs.writeFileSync(file, 'partial');
  fs.writeFileSync(original, 'original');
  const db = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO media_publications VALUES(?)').run(file);
  db.close();
  await cleanupArchiveImport(stage, destination);
  expect(fs.existsSync(file)).toBe(false);
  expect(fs.readFileSync(original, 'utf8')).toBe('original');
});

test('journal の親が junction に変わった場合はリンク先の途中ファイルを消さない', async () => {
  const stage = temp(),
    destination = temp(),
    outside = temp();
  const name = '.hologram-import-11111111-1111-4111-8111-111111111111.tmp';
  fs.writeFileSync(path.join(outside, name), 'foreign');
  fs.symlinkSync(outside, path.join(destination, 'redirected'), process.platform === 'win32' ? 'junction' : 'dir');
  const db = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO media_publications VALUES(?)').run(path.join(destination, 'redirected', name));
  db.close();
  await expect(cleanupArchiveImport(stage, destination)).rejects.toThrow('invalid-import-cleanup-owner');
  expect(fs.readFileSync(path.join(outside, name), 'utf8')).toBe('foreign');
});

test('所有 tmp の名前でもディレクトリなら消さない', async () => {
  const stage = temp(),
    destination = temp();
  const file = path.join(destination, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'foreign'), 'keep');
  const db = openDatabase(path.join(stage, 'prepared.sqlite')).sqlite;
  db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO media_publications VALUES(?)').run(file);
  db.close();
  await expect(cleanupArchiveImport(stage, destination)).rejects.toThrow('invalid-import-cleanup-owner');
  expect(fs.readFileSync(path.join(file, 'foreign'), 'utf8')).toBe('keep');
});

test('runtime stage のライブラリ UUID が変わった場合は途中ファイルを消さない', async () => {
  const profile = temp(),
    destination = temp(),
    temporary = temp();
  const library = openDatabase(path.join(destination, 'hologram.db')).sqlite;
  library.prepare('INSERT INTO store_state(key,value) VALUES(?,?)').run('libraryId', 'current-library');
  library.close();
  const owned = await createArchiveStage(profile, destination, 'old-library', temporary);
  try {
    const file = path.join(destination, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
    fs.writeFileSync(file, 'keep');
    const db = openDatabase(path.join(owned.stage, 'prepared.sqlite')).sqlite;
    db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO media_publications VALUES(?)').run(file);
    db.close();
    await expect(cleanupArchiveImport(owned.stage, destination)).rejects.toThrow('invalid-import-cleanup-owner');
    expect(fs.readFileSync(file, 'utf8')).toBe('keep');
  } finally {
    await owned.close();
  }
});

test.skipIf(process.platform !== 'win32')('Windows の大小文字が異なる所有 manifest と journal でも一致する tmp を回収する', async () => {
  const profile = temp(),
    destination = temp(),
    temporary = temp();
  const library = openDatabase(path.join(destination, 'hologram.db')).sqlite;
  library.prepare('INSERT INTO store_state(key,value) VALUES(?,?)').run('libraryId', 'same-library');
  library.close();
  const owned = await createArchiveStage(profile, destination, 'same-library', temporary);
  try {
    const file = path.join(destination, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
    const original = path.join(destination, 'existing.png');
    fs.writeFileSync(file, 'partial');
    fs.writeFileSync(original, 'keep');
    const db = openDatabase(path.join(owned.stage, 'prepared.sqlite')).sqlite;
    db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO media_publications VALUES(?)').run(file);
    db.close();
    expect(owned.manifest.destination).toBe(path.resolve(destination).toLowerCase());
    expect(file.startsWith(owned.manifest.destination + path.sep)).toBe(false);
    await cleanupArchiveImport(owned.stage, owned.manifest.destination);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(original, 'utf8')).toBe('keep');
    await cleanupArchiveImport(owned.stage, destination.toUpperCase());
  } finally {
    await owned.close();
  }
});

async function compactionFixture() {
  const profile = temp(),
    destination = temp(),
    temporary = temp();
  const owned = await createArchiveStage(profile, destination, 'retained-library', temporary);
  fs.mkdirSync(path.join(owned.stage, 'library'));
  fs.writeFileSync(path.join(owned.stage, 'library', 'expanded.bin'), Buffer.alloc(1024 * 1024, 81));
  const file = path.join(destination, '.hologram-import-11111111-1111-4111-8111-111111111111.tmp');
  fs.writeFileSync(file, 'foreign destination remains');
  const db = openDatabase(path.join(owned.stage, 'prepared.sqlite')).sqlite;
  db.exec('CREATE TABLE media_publications(tmp TEXT PRIMARY KEY); CREATE TABLE archive_records(captureId TEXT,json TEXT)');
  db.prepare('INSERT INTO media_publications VALUES(?)').run(file);
  db.prepare('INSERT INTO archive_records VALUES(?,?)').run('large', 'X'.repeat(4 * 1024 * 1024));
  db.close();
  return { owned, file, dbPath: path.join(owned.stage, 'prepared.sqlite') };
}

test('所有 stage の容量を journal のみに縮小し、外部 tmp と manifest を保持する', async () => {
  const { owned, file, dbPath } = await compactionFixture();
  try {
    const many = openDatabase(dbPath).sqlite;
    try {
      const insert = many.prepare('INSERT INTO media_publications VALUES(?)');
      many.transaction(() => {
        for (let index = 0; index < 205; index++) insert.run(file + '-' + index);
      })();
    } finally {
      many.close();
    }
    const before = fs.statSync(dbPath).size;
    await compactArchiveImportStage(owned.stage);
    expect(fs.existsSync(path.join(owned.stage, 'library'))).toBe(false);
    expect(fs.statSync(dbPath).size).toBeLessThan(before / 2);
    const compact = openDatabase(dbPath, { readonly: true }).sqlite;
    try {
      expect(compact.prepare('SELECT count(*) AS n FROM media_publications').get()).toEqual({ n: 206 });
      expect(compact.prepare('SELECT tmp FROM media_publications WHERE tmp=?').get(file)).toEqual({ tmp: file });
      expect(compact.prepare('SELECT count(*) AS n FROM posts').get()).toEqual({ n: 0 });
      expect(compact.prepare("SELECT name FROM sqlite_master WHERE name='archive_records'").get()).toBeUndefined();
    } finally {
      compact.close();
    }
    expect(fs.readFileSync(file, 'utf8')).toBe('foreign destination remains');
    expect(fs.existsSync(path.join(path.dirname(owned.stage), path.basename(owned.stage) + '.json'))).toBe(true);
    expect(fs.existsSync(dbPath + '-wal')).toBe(false);
    expect(fs.existsSync(dbPath + '-shm')).toBe(false);
    await compactArchiveImportStage(owned.stage);
  } finally {
    await owned.close();
  }
});

test('DB の原子的置換に失敗しても元 journal と展開媒体を保持して再試行できる', async () => {
  const { owned, file, dbPath } = await compactionFixture();
  try {
    const rename = vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(Object.assign(new Error('held destination'), { code: 'EPERM' }));
    try {
      await expect(compactArchiveImportStage(owned.stage)).rejects.toThrow('held destination');
    } finally {
      rename.mockRestore();
    }
    expect(fs.existsSync(path.join(owned.stage, 'library', 'expanded.bin'))).toBe(true);
    const original = openDatabase(dbPath, { readonly: true }).sqlite;
    try {
      expect(original.prepare('SELECT tmp FROM media_publications').all()).toEqual([{ tmp: file }]);
    } finally {
      original.close();
    }
    expect(fs.existsSync(path.join(owned.stage, 'prepared-journal.sqlite'))).toBe(true);
    await compactArchiveImportStage(owned.stage);
    expect(fs.existsSync(path.join(owned.stage, 'library'))).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('foreign destination remains');
  } finally {
    await owned.close();
  }
});

test('WAL の reader が checkpoint を妨げる場合は journal と展開容量を保全する', async () => {
  const { owned, file, dbPath } = await compactionFixture();
  const writer = openDatabase(dbPath).sqlite,
    reader = openDatabase(dbPath, { readonly: true }).sqlite;
  try {
    reader.exec('BEGIN');
    reader.prepare('SELECT tmp FROM media_publications').get();
    writer.prepare('INSERT INTO media_publications VALUES(?)').run(file + '-another');
    await expect(compactArchiveImportStage(owned.stage)).rejects.toThrow('archive-compaction-checkpoint-busy');
    expect(fs.existsSync(path.join(owned.stage, 'library', 'expanded.bin'))).toBe(true);
    reader.exec('ROLLBACK');
    reader.close();
    writer.close();
    await compactArchiveImportStage(owned.stage);
    const compact = openDatabase(dbPath, { readonly: true }).sqlite;
    try {
      expect(compact.prepare('SELECT count(*) AS n FROM media_publications').get()).toEqual({ n: 2 });
    } finally {
      compact.close();
    }
  } finally {
    if (reader.open) reader.close();
    if (writer.open) writer.close();
    await owned.close();
  }
}, 10000);
