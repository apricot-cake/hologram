import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openDatabase } from '../app/src/main/lib-db';
import { migrateLegacySharedAssets } from '../app/src/main/lib-shared-asset-migration';
import { posterAppearanceHash } from '../app/src/main/lib-poster-profile';

const dirs: string[] = [];
const handles: Array<{ sqlite: any }> = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.sqlite.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function library() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-shared-assets-'));
  dirs.push(folder);
  const handle = openDatabase(path.join(folder, 'hologram.db'));
  handles.push(handle);
  return { folder, sqlite: handle.sqlite };
}

function insertPost(sqlite: any, captureId: string, avatar: string | null, avatarFile: string) {
  sqlite.prepare('INSERT INTO posts (captureId, assetClass, capturedAt, updatedAt, hashtags, avatar, avatarFile) VALUES (?, ?, ?, ?, ?, ?, ?)').run(captureId, 'media', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z', '[]', avatar, avatarFile);
}

describe('migrateLegacySharedAssets', () => {
  test('旧アバターを共有ストアへ移し、投稿者履歴の参照とハッシュも更新する', () => {
    const { folder, sqlite } = library();
    const avatar = 'https://cdn.example/avatar.png';
    const oldFile = 'cap-avatar.png';
    insertPost(sqlite, 'cap', avatar, oldFile);
    sqlite.prepare('INSERT INTO poster_profiles (posterKey, platform, avatar, avatarFile, contentHash, provenance, firstObservedAt, lastObservedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('x:u', 'x', avatar, oldFile, 'old-current', 'api:x', '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z');
    sqlite.prepare('INSERT INTO poster_profile_snapshots (posterKey, observedAt, avatar, avatarFile, contentHash, provenance) VALUES (?, ?, ?, ?, ?, ?)').run('x:u', '2026-08-23T00:00:00.000Z', avatar, oldFile, 'old-snapshot', 'api:x');
    fs.writeFileSync(path.join(folder, oldFile), 'avatar');

    const relative = `avatars/${crypto.createHash('sha1').update(avatar).digest('hex').slice(0, 16)}.png`;
    expect(migrateLegacySharedAssets(sqlite, folder)).toEqual({ references: 3, files: 1 });
    expect(fs.existsSync(path.join(folder, oldFile))).toBe(false);
    expect(fs.readFileSync(path.join(folder, ...relative.split('/')), 'utf8')).toBe('avatar');
    expect((sqlite.prepare('SELECT avatarFile FROM posts WHERE captureId = ?').get('cap') as any).avatarFile).toBe(relative);

    const appearance = { displayName: null, screenName: null, bio: null, links: null, avatar, avatarFile: relative, banner: null, bannerFile: null };
    expect(sqlite.prepare('SELECT avatarFile, contentHash FROM poster_profiles WHERE posterKey = ?').get('x:u') as any).toEqual({
      avatarFile: relative,
      contentHash: posterAppearanceHash(appearance),
    });
    expect(sqlite.prepare('SELECT avatarFile, contentHash FROM poster_profile_snapshots WHERE posterKey = ?').get('x:u') as any).toEqual({
      avatarFile: relative,
      contentHash: posterAppearanceHash(appearance),
    });
    expect(migrateLegacySharedAssets(sqlite, folder)).toEqual({ references: 0, files: 0 });
  });

  test('URLが残っていない旧アバターにも再実行可能なキーを付ける', () => {
    const { folder, sqlite } = library();
    const oldFile = 'cap-no-url-avatar.jpg';
    insertPost(sqlite, 'cap-no-url', null, oldFile);
    fs.writeFileSync(path.join(folder, oldFile), 'avatar');

    const relative = `avatars/legacy-${crypto.createHash('sha1').update(oldFile).digest('hex').slice(0, 16)}.jpg`;
    expect(migrateLegacySharedAssets(sqlite, folder)).toEqual({ references: 1, files: 1 });
    expect((sqlite.prepare('SELECT avatarFile FROM posts WHERE captureId = ?').get('cap-no-url') as any).avatarFile).toBe(relative);
    expect(fs.readFileSync(path.join(folder, ...relative.split('/')), 'utf8')).toBe('avatar');
  });

  test('URLハッシュの同名競合後に終了しても legacy 宛先から参照を回復する', () => {
    const { folder, sqlite } = library();
    const avatar = 'https://cdn.example/conflict.png';
    const oldFile = 'cap-conflict-avatar.png';
    insertPost(sqlite, 'cap-conflict', avatar, oldFile);
    const desired = `avatars/${crypto.createHash('sha1').update(avatar).digest('hex').slice(0, 16)}.png`;
    const fallback = `avatars/legacy-${crypto.createHash('sha1').update(oldFile).digest('hex').slice(0, 16)}.png`;
    fs.mkdirSync(path.join(folder, 'avatars'), { recursive: true });
    fs.writeFileSync(path.join(folder, ...desired.split('/')), 'unrelated');
    fs.writeFileSync(path.join(folder, ...fallback.split('/')), 'avatar');

    expect(migrateLegacySharedAssets(sqlite, folder)).toEqual({ references: 1, files: 0 });
    expect((sqlite.prepare('SELECT avatarFile FROM posts WHERE captureId = ?').get('cap-conflict') as any).avatarFile).toBe(fallback);
  });

  test('DB更新が失敗したらファイルを直下へ戻す', () => {
    const { folder, sqlite } = library();
    const oldFile = 'cap-rollback-avatar.png';
    insertPost(sqlite, 'cap-rollback', null, oldFile);
    fs.writeFileSync(path.join(folder, oldFile), 'avatar');
    sqlite.exec("CREATE TRIGGER reject_avatar_update BEFORE UPDATE OF avatarFile ON posts BEGIN SELECT RAISE(ABORT, 'reject'); END");

    expect(() => migrateLegacySharedAssets(sqlite, folder)).toThrow();
    expect(fs.readFileSync(path.join(folder, oldFile), 'utf8')).toBe('avatar');
    expect(fs.existsSync(path.join(folder, 'avatars'))).toBe(true);
    expect(fs.readdirSync(path.join(folder, 'avatars'))).toEqual([]);
  });
});
