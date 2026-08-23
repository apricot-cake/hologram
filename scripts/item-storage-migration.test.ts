import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { migrateItemStorage } from '../app/src/main/lib-item-storage-migration';

const dirs: string[] = [];
const handles: Array<{ sqlite: any }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.sqlite.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function library() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-items-'));
  dirs.push(folder);
  const handle = openDatabase(path.join(folder, 'hologram.db'));
  handles.push(handle);
  return { folder, sqlite: handle.sqlite };
}

function post(sqlite: any, captureId: string, values: { image?: string | null; video?: string | null; file?: string | null; linkCard?: unknown } = {}) {
  sqlite
    .prepare('INSERT INTO posts (captureId, assetClass, capturedAt, updatedAt, hashtags, image, video, file, linkCard) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(captureId, 'media', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z', '[]', values.image ?? null, values.video ?? null, values.file ?? null, values.linkCard ? JSON.stringify(values.linkCard) : null);
}

describe('migrateItemStorage', () => {
  test('投稿が所有する全ファイルとDB参照を項目フォルダーへ移す', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'cap-1', { image: 'cap-1.jpg', linkCard: { url: 'https://example.com', thumbnailFile: 'cap-1-linkcard.png' } });
    sqlite.prepare('INSERT INTO media (postId, seq, file, posterFile) VALUES (?, ?, ?, ?)').run('cap-1', 0, 'cap-1-media-0.mp4', 'cap-1-poster.jpg');
    for (const name of ['cap-1.jpg', 'cap-1-linkcard.png', 'cap-1-media-0.mp4', 'cap-1-poster.jpg']) fs.writeFileSync(path.join(folder, name), name);

    expect(migrateItemStorage(sqlite, folder)).toEqual({ posts: 1, files: 4 });
    const row = sqlite.prepare('SELECT image, linkCard FROM posts WHERE captureId = ?').get('cap-1') as any;
    const media = sqlite.prepare('SELECT file, posterFile FROM media WHERE postId = ?').get('cap-1') as any;
    expect(row.image).toBe('items/cap-1/cap-1.jpg');
    expect(JSON.parse(row.linkCard).thumbnailFile).toBe('items/cap-1/cap-1-linkcard.png');
    expect(media).toMatchObject({ file: 'items/cap-1/cap-1-media-0.mp4', posterFile: 'items/cap-1/cap-1-poster.jpg' });
    for (const name of ['cap-1.jpg', 'cap-1-linkcard.png', 'cap-1-media-0.mp4', 'cap-1-poster.jpg']) {
      expect(fs.existsSync(path.join(folder, name))).toBe(false);
      expect(fs.existsSync(path.join(folder, 'items', 'cap-1', name))).toBe(true);
    }
  });

  test('テキストだけの項目にもフォルダーを作り、再実行は何もしない', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'cap-text');
    expect(migrateItemStorage(sqlite, folder)).toEqual({ posts: 0, files: 0 });
    expect(fs.statSync(path.join(folder, 'items', 'cap-text')).isDirectory()).toBe(true);
    expect(migrateItemStorage(sqlite, folder)).toEqual({ posts: 0, files: 0 });
  });

  test('移動対象がない linkCard の表現を不必要に書き換えない', () => {
    const { folder, sqlite } = library();
    const linkCard = '{\n  "url": "https://example.com"\n}';
    sqlite.prepare('INSERT INTO posts (captureId, assetClass, capturedAt, updatedAt, hashtags, linkCard) VALUES (?, ?, ?, ?, ?, ?)').run('cap-link', 'media', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z', '[]', linkCard);

    expect(migrateItemStorage(sqlite, folder)).toEqual({ posts: 0, files: 0 });
    expect((sqlite.prepare('SELECT linkCard FROM posts WHERE captureId = ?').get('cap-link') as any).linkCard).toBe(linkCard);
  });

  test('欠損ファイルの参照は移し替えない', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'cap-missing', { image: 'cap-missing.jpg' });
    migrateItemStorage(sqlite, folder);
    expect((sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('cap-missing') as any).image).toBe('cap-missing.jpg');
  });

  test('DB更新が失敗したら移動したファイルを元へ戻す', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'cap-rollback', { image: 'cap-rollback.jpg' });
    fs.writeFileSync(path.join(folder, 'cap-rollback.jpg'), 'original');
    sqlite.exec("CREATE TRIGGER reject_item_update BEFORE UPDATE ON posts BEGIN SELECT RAISE(ABORT, 'reject'); END");

    expect(() => migrateItemStorage(sqlite, folder)).toThrow();
    expect(fs.readFileSync(path.join(folder, 'cap-rollback.jpg'), 'utf8')).toBe('original');
    expect(fs.existsSync(path.join(folder, 'items', 'cap-rollback', 'cap-rollback.jpg'))).toBe(false);
  });

  test('同名の別内容が既にあれば上書きも参照変更もしない', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'cap-conflict', { image: 'cap-conflict.jpg' });
    fs.writeFileSync(path.join(folder, 'cap-conflict.jpg'), 'root');
    fs.mkdirSync(path.join(folder, 'items', 'cap-conflict'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'items', 'cap-conflict', 'cap-conflict.jpg'), 'item');

    expect(migrateItemStorage(sqlite, folder)).toEqual({ posts: 0, files: 0 });
    expect((sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('cap-conflict') as any).image).toBe('cap-conflict.jpg');
    expect(fs.readFileSync(path.join(folder, 'cap-conflict.jpg'), 'utf8')).toBe('root');
    expect(fs.readFileSync(path.join(folder, 'items', 'cap-conflict', 'cap-conflict.jpg'), 'utf8')).toBe('item');
  });
});
