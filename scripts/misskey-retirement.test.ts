import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { retireMisskey } from '../app/src/main/lib-misskey-retirement';

const dirs: string[] = [];
const handles: Array<{ sqlite: any }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.sqlite.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function library() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-no-misskey-'));
  dirs.push(folder);
  const handle = openDatabase(path.join(folder, 'hologram.db'));
  handles.push(handle);
  return { folder, sqlite: handle.sqlite };
}

function insertPost(sqlite: any, captureId: string, platform: string, avatarFile: string | null) {
  sqlite
    .prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, hashtags, platform, image, url, avatarFile) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(captureId, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z', '[]', platform, `items/${captureId}/${captureId}.jpg`, platform === 'misskey' ? `https://misskey.io/notes/${captureId}` : `https://x.com/u/status/${captureId}`, avatarFile);
}

describe('retireMisskey', () => {
  test('Misskey の投稿・プロフィール・ゴミ箱・専用ファイルだけを削除する', () => {
    const { folder, sqlite } = library();
    insertPost(sqlite, 'misskey-post', 'misskey', 'avatars/miss.png');
    insertPost(sqlite, 'x-post', 'x', 'avatars/shared.png');
    sqlite
      .prepare('INSERT INTO poster_profiles (posterKey, platform, userId, displayName, avatarFile, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('misskey:misskey.io:u1', 'misskey', 'u1', '旧投稿者', 'avatars/miss.png', 'hash', 'api:misskey', '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z');

    for (const id of ['misskey-post', 'x-post']) {
      fs.mkdirSync(path.join(folder, 'items', id), { recursive: true });
      fs.writeFileSync(path.join(folder, 'items', id, `${id}.jpg`), id);
    }
    fs.mkdirSync(path.join(folder, 'avatars'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'avatars', 'miss.png'), 'miss');
    fs.writeFileSync(path.join(folder, 'avatars', 'shared.png'), 'shared');
    fs.mkdirSync(path.join(folder, 'emoji'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'emoji', 'old.png'), 'old');
    fs.mkdirSync(path.join(folder, '.trash', 'misskey-trash'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.trash', 'misskey-trash', 'misskey-trash.jpg'), 'trash');
    fs.writeFileSync(path.join(folder, '.trash', 'misskey-trash.json'), JSON.stringify({ captureId: 'misskey-trash', platform: 'misskey', image: 'items/misskey-trash/misskey-trash.jpg' }));

    const result = retireMisskey(sqlite, folder, true);
    expect(result).toMatchObject({ posts: 1, profiles: 1, trash: 1 });
    expect(sqlite.prepare('SELECT captureId FROM posts ORDER BY captureId').all()).toEqual([{ captureId: 'x-post' }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM poster_profiles WHERE platform = 'misskey'").get()).toEqual({ n: 0 });
    expect(fs.existsSync(path.join(folder, 'items', 'misskey-post'))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'items', 'x-post', 'x-post.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'avatars', 'miss.png'))).toBe(false);
    expect(fs.existsSync(path.join(folder, 'avatars', 'shared.png'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'emoji'))).toBe(false);
    expect(fs.existsSync(path.join(folder, '.trash', 'misskey-trash.json'))).toBe(false);
    expect(retireMisskey(sqlite, folder, true)).toEqual({ posts: 0, profiles: 0, trash: 0, files: 0 });
  });
});
