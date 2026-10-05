import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createArchiveFilePublisher } from './archive-file-publisher';
import { publishArchiveFile, cleanupArchiveImport } from './lib-archive-import';
import { openDatabase } from './lib-db';

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
