import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db';
import { retireScreenshotImages } from '../../app/src/main/lib-screenshot-retirement';

const dirs: string[] = [];
const handles: Array<{ sqlite: any }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.sqlite.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function library() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-no-screenshots-'));
  dirs.push(folder);
  const handle = openDatabase(path.join(folder, 'hologram.db'));
  handles.push(handle);
  return { folder, sqlite: handle.sqlite };
}

function post(sqlite: any, captureId: string, image: string, source: string | null, url: string | null = `https://x.com/u/status/${captureId}`) {
  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, hashtags, image, source, url, shotW, shotH, shotAnimated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(captureId, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', '[]', image, source, url, 800, 600, 1);
}

describe('retireScreenshotImages', () => {
  test('旧スクリーンショットだけを削除し、投稿と原本画像を残す', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'old-shot', 'items/old-shot/old-shot.jpg', null);
    post(sqlite, 'clipboard', 'items/clipboard/clipboard.png', 'clipboard');
    post(sqlite, 'old-local', 'items/old-local/old-local.jpg', null, null);
    for (const id of ['old-shot', 'clipboard', 'old-local']) {
      fs.mkdirSync(path.join(folder, 'items', id), { recursive: true });
      fs.writeFileSync(path.join(folder, 'items', id, `${id}.${id === 'clipboard' ? 'png' : 'jpg'}`), id);
    }

    expect(retireScreenshotImages(sqlite, folder)).toEqual({ posts: 1, trash: 0, files: 1 });
    expect(sqlite.prepare('SELECT image, shotW, shotH, shotAnimated FROM posts WHERE captureId = ?').get('old-shot')).toEqual({ image: null, shotW: null, shotH: null, shotAnimated: null });
    expect(sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('clipboard')).toEqual({ image: 'items/clipboard/clipboard.png' });
    expect(sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('old-local')).toEqual({ image: 'items/old-local/old-local.jpg' });
    expect(fs.existsSync(path.join(folder, 'items', 'old-shot', 'old-shot.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'items', 'clipboard', 'clipboard.png'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'items', 'old-local', 'old-local.jpg'))).toBe(true);
    expect(retireScreenshotImages(sqlite, folder)).toEqual({ posts: 0, trash: 0, files: 0 });
  });

  test('保存フォルダ外を指す参照は外部ファイルへ触れずに外す', () => {
    const { folder, sqlite } = library();
    const outside = path.join(path.dirname(folder), `${path.basename(folder)}-outside.jpg`);
    fs.writeFileSync(outside, 'keep');
    try {
      post(sqlite, 'unsafe', outside, null);
      expect(retireScreenshotImages(sqlite, folder)).toEqual({ posts: 1, trash: 0, files: 0 });
      expect((sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('unsafe') as any).image).toBeNull();
      expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('原本として media に載る画像や他投稿が共有するファイルは削除しない', () => {
    const { folder, sqlite } = library();
    post(sqlite, 'original', 'items/original/original.jpg', null);
    sqlite.prepare('INSERT INTO media (postId, seq, file) VALUES (?, ?, ?)').run('original', 0, 'items/original/original.jpg');
    post(sqlite, 'old-shot', 'shared.jpg', null);
    post(sqlite, 'other', 'shared.jpg', 'web');
    fs.mkdirSync(path.join(folder, 'items', 'original'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'items', 'original', 'original.jpg'), 'original');
    fs.writeFileSync(path.join(folder, 'shared.jpg'), 'shared');

    expect(retireScreenshotImages(sqlite, folder)).toEqual({ posts: 1, trash: 0, files: 0 });
    expect((sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('original') as any).image).toBe('items/original/original.jpg');
    expect((sqlite.prepare('SELECT image FROM posts WHERE captureId = ?').get('old-shot') as any).image).toBeNull();
    expect(fs.existsSync(path.join(folder, 'items', 'original', 'original.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'shared.jpg'))).toBe(true);
  });

  test('投稿やプロフィールが参照するアバターとバナーは削除しない', () => {
    const { folder, sqlite } = library();
    const files = ['avatars/post.png', 'avatars/profile.png', 'banners/profile.png'];
    for (const [index, file] of files.entries()) {
      post(sqlite, `old-shot-${index}`, file, null);
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      fs.writeFileSync(path.join(folder, file), file);
    }
    post(sqlite, 'avatar-owner', 'items/avatar-owner/image.png', 'web');
    sqlite.prepare('UPDATE posts SET avatarFile = ? WHERE captureId = ?').run(files[0], 'avatar-owner');
    sqlite.prepare('INSERT INTO poster_profiles (posterKey, avatarFile, bannerFile, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run('x:user', files[1], files[2], 'hash', 'capture', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');

    expect(retireScreenshotImages(sqlite, folder)).toEqual({ posts: 3, trash: 0, files: 0 });
    for (const file of files) expect(fs.existsSync(path.join(folder, file))).toBe(true);
  });

  test('ゴミ箱の画像ファイルと参照も取り除く', () => {
    const { folder, sqlite } = library();
    const trash = path.join(folder, '.trash');
    const item = path.join(trash, 'trashed');
    fs.mkdirSync(item, { recursive: true });
    fs.writeFileSync(path.join(item, 'shot.jpg'), 'shot');
    fs.writeFileSync(path.join(trash, 'trashed.json'), JSON.stringify({ captureId: 'trashed', image: 'items/trashed/shot.jpg', url: 'https://x.com/u/status/trashed', text: '本文', shotW: 10, shotH: 20, shotAnimated: false }));

    expect(retireScreenshotImages(sqlite, folder, true)).toEqual({ posts: 0, trash: 1, files: 1 });
    const record = JSON.parse(fs.readFileSync(path.join(trash, 'trashed.json'), 'utf8'));
    expect(record).toEqual({ captureId: 'trashed', url: 'https://x.com/u/status/trashed', text: '本文' });
    expect(fs.existsSync(path.join(item, 'shot.jpg'))).toBe(false);
  });

  test('ゴミ箱でも media に載る原本画像はスクリーンショットとみなさない', () => {
    const { folder, sqlite } = library();
    const trash = path.join(folder, '.trash');
    const item = path.join(trash, 'original');
    fs.mkdirSync(item, { recursive: true });
    fs.writeFileSync(path.join(item, 'original.jpg'), 'original');
    fs.writeFileSync(path.join(trash, 'original.json'), JSON.stringify({ captureId: 'original', image: 'items/original/original.jpg', media: [{ file: 'items/original/original.jpg' }], url: 'https://x.com/u/status/original' }));

    expect(retireScreenshotImages(sqlite, folder, true)).toEqual({ posts: 0, trash: 0, files: 0 });
    expect(fs.existsSync(path.join(item, 'original.jpg'))).toBe(true);
  });
});
