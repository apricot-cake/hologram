import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { openDatabase } from './lib-db.ts';
import { repairLegacyItemReferences } from './lib-legacy-item-repair.ts';
import { itemFileRelative } from '../../../native-host/item-storage.mts';

let folder: string, db: ReturnType<typeof openDatabase>['sqlite'];
const id = 'repair-post',
  names = ['image.png', 'video.mp4', 'avatar.png', 'poster.png', 'thumbnail.png'];
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-item-reference-repair-'));
  db = openDatabase(path.join(folder, 'hologram.db')).sqlite;
  db.prepare('INSERT INTO posts(captureId,capturedAt,updatedAt,image,video,avatarFile,linkCard,localViewCount,tagReviewed) VALUES(?,?,?,?,?,?,?,?,?)').run(id, '2026-01-01', '2026-01-01', names[0], names[1], names[2], JSON.stringify({ url: 'https://example.test', thumbnailFile: names[4] }), 7, 1);
  db.prepare('INSERT INTO media(postId,seq,file,posterFile,frames,rotation) VALUES(?,?,?,?,?,?)').run(id, 0, names[0], names[3], JSON.stringify({ file: 'frames.zip' }), 90);
  for (const name of names) {
    const file = path.join(folder, itemFileRelative(id, name));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'original');
  }
});
afterEach(() => {
  db.close();
  fs.rmSync(folder, { recursive: true, force: true });
});
test('既存DBの全参照欄を実体へ補正し他metadataとframesを保持する', async () => {
  expect(await repairLegacyItemReferences(db, folder)).toBe(6);
  const post: any = db.prepare('SELECT * FROM posts WHERE captureId=?').get(id);
  expect([post.image, post.video, post.avatarFile, JSON.parse(post.linkCard).thumbnailFile]).toEqual([0, 1, 2, 4].map((i) => itemFileRelative(id, names[i])));
  expect(post.localViewCount).toBe(7);
  expect(post.tagReviewed).toBe(1);
  expect(db.prepare('SELECT file,posterFile,frames,rotation FROM media').get()).toEqual({ file: itemFileRelative(id, names[0]), posterFile: itemFileRelative(id, names[3]), frames: JSON.stringify({ file: 'frames.zip' }), rotation: 90 });
  expect(await repairLegacyItemReferences(db, folder)).toBe(0);
});
test('rootとownの両方が存在する場合はroot参照を保持する', async () => {
  for (const name of names) fs.writeFileSync(path.join(folder, name), 'different');
  expect(await repairLegacyItemReferences(db, folder)).toBe(0);
  expect(db.prepare('SELECT image FROM posts').get()).toEqual({ image: names[0] });
});
test('異owner・共有参照は書き換えず、ないown候補も採用しない', async () => {
  db.prepare('UPDATE posts SET image=?,avatarFile=? WHERE captureId=?').run('items/other/image.png', 'avatars/shared.png', id);
  fs.rmSync(path.join(folder, itemFileRelative(id, names[1])));
  await repairLegacyItemReferences(db, folder);
  expect(db.prepare('SELECT image,video,avatarFile FROM posts').get()).toEqual({ image: 'items/other/image.png', video: names[1], avatarFile: 'avatars/shared.png' });
});
test('全scalar・media・JSON欄のCASで調査後の変更を上書きしない', async () => {
  expect(
    await repairLegacyItemReferences(
      db,
      folder,
      () => true,
      () => {
        db.prepare('UPDATE posts SET image=?,video=?,avatarFile=?,linkCard=?').run('new-image', 'new-video', 'new-avatar', JSON.stringify({ thumbnailFile: 'new-card' }));
        db.prepare('UPDATE media SET file=?,posterFile=?').run('new-file', 'new-poster');
      },
    ),
  ).toBe(0);
  expect(db.prepare('SELECT image,video,avatarFile,linkCard FROM posts').get()).toEqual({ image: 'new-image', video: 'new-video', avatarFile: 'new-avatar', linkCard: JSON.stringify({ thumbnailFile: 'new-card' }) });
  expect(db.prepare('SELECT file,posterFile FROM media').get()).toEqual({ file: 'new-file', posterFile: 'new-poster' });
});
test('所有権が失われた時はDBへ書き込まない', async () => {
  let current = true;
  expect(
    await repairLegacyItemReferences(
      db,
      folder,
      () => current,
      () => {
        current = false;
      },
    ),
  ).toBe(0);
});
test('junctionで別領域にある自item候補は採用しない', async () => {
  const dir = path.join(folder, 'items', id),
    moved = path.join(folder, 'linked');
  fs.renameSync(dir, moved);
  fs.symlinkSync(moved, dir, process.platform === 'win32' ? 'junction' : 'dir');
  expect(await repairLegacyItemReferences(db, folder)).toBe(0);
});

test.each(['missing', 'flat-returned', 'parent-link'])('CAS 直前 %s は旧参照を保全する', async (mode) => {
  expect(
    await repairLegacyItemReferences(
      db,
      folder,
      () => true,
      () => {
        if (mode === 'missing') for (const name of names) fs.unlinkSync(path.join(folder, itemFileRelative(id, name)));
        if (mode === 'flat-returned') for (const name of names) fs.writeFileSync(path.join(folder, name), 'new root');
        if (mode === 'parent-link') {
          const items = path.join(folder, 'items');
          const moved = path.join(folder, 'linked-items');
          fs.renameSync(items, moved);
          fs.symlinkSync(moved, items, process.platform === 'win32' ? 'junction' : 'dir');
        }
      },
    ),
  ).toBe(0);
  expect(db.prepare('SELECT image FROM posts').get()).toEqual({ image: names[0] });
  expect(db.prepare('SELECT file,posterFile FROM media').get()).toEqual({ file: names[0], posterFile: names[3] });
});

test('後続 SQL 拒否で先行 CAS も rollback する', async () => {
  db.exec("CREATE TRIGGER reject_media_repair BEFORE UPDATE ON media BEGIN SELECT RAISE(ABORT, 'repair denied'); END");
  await expect(repairLegacyItemReferences(db, folder)).rejects.toThrow('repair denied');
  expect(db.prepare('SELECT image,video,avatarFile FROM posts').get()).toEqual({ image: names[0], video: names[1], avatarFile: names[2] });
});
