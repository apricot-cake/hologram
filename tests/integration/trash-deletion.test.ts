import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { createDbWriter } from '../../app/src/main/lib-db-write.ts';
import { trashCapture } from '../../app/src/main/lib-trash-capture.ts';
import { itemDirectoryAbsolute } from '../../native-host/item-storage.mts';
import { postsByIds } from '../../app/src/main/lib-db-query.ts';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => path.resolve('app') } }));
vi.mock('../../app/src/main/activity-ipc.ts', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } }));
import { register } from '../../app/src/main/ipc-trash.ts';
import type { IpcContext } from '../../app/src/main/ipc-context.ts';

let dir: string;
let sqlite: ReturnType<typeof openDatabase>['sqlite'];
let writer: ReturnType<typeof createDbWriter>;
const captureId = '1700000000000-aa01';
let itemDir: string;
let trashDir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-delete-'));
  ({ sqlite } = openDatabase(path.join(dir, 'library.db')));
  writer = createDbWriter(sqlite);
  itemDir = itemDirectoryAbsolute(dir, captureId);
  trashDir = path.join(dir, '.trash');
  fs.mkdirSync(itemDir, { recursive: true });
  fs.writeFileSync(path.join(itemDir, 'image.jpg'), 'original');
  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, image) VALUES (?, ?, ?, ?)').run(captureId, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', `items/${captureId}/image.jpg`);
  writer.setFolders({
    folders: [
      { id: 'a', name: 'A', items: [captureId] },
      { id: 'b', name: 'B', items: [captureId] },
    ],
  });
  register({ getSaveFolder: () => dir, getTrashDir: () => trashDir, baseOf: () => captureId, LIBRARY_MEDIA_EXTS: ['jpg'], getDbWriter: () => writer, ensurePostsSynced: () => ({ sqlite }), scheduleSavedIndexWrite: vi.fn(), send: vi.fn() } as unknown as IpcContext);
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function deletePost() {
  return handlers.get('delete-post')!({}, captureId);
}
function expectPreserved() {
  expect(sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get(captureId)).toBeTruthy();
  expect(writer.getPostFlags(captureId)?.folders).toEqual(['a', 'b']);
  expect(fs.readFileSync(path.join(itemDir, 'image.jpg'), 'utf8')).toBe('original');
}

test('ゴミ箱を作成できない実ファイル構成では、DB と所属と元のファイルが残る', async () => {
  fs.writeFileSync(trashDir, 'not a directory');
  await expect(deletePost()).rejects.toThrow();
  expectPreserved();
});

test('共有画像の実コピー失敗では、移動済み項目を元へ戻し DB と所属を残す', async () => {
  sqlite.prepare('UPDATE posts SET image = ? WHERE captureId = ?').run('items/missing/shared.jpg', captureId);
  await expect(deletePost()).rejects.toThrow();
  expectPreserved();
  expect(fs.readdirSync(trashDir)).toEqual([]);
});

test('sidecar 書込失敗では元のファイルと所属を戻し、部分的なゴミ箱を残さない', async () => {
  const open = fs.promises.open.bind(fs.promises);
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
    if (String(args[0]).endsWith(`${captureId}.json`)) throw new Error('sidecar write denied');
    return open(...args);
  });
  await expect(deletePost()).rejects.toThrow('sidecar write denied');
  expectPreserved();
  expect(fs.readdirSync(trashDir)).toEqual([]);
});

test('DB トランザクション失敗では sidecar を撤去してファイルを戻す', async () => {
  sqlite.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON posts BEGIN SELECT RAISE(ABORT, 'delete denied'); END");
  await expect(deletePost()).rejects.toThrow('delete denied');
  expectPreserved();
  expect(fs.readdirSync(trashDir)).toEqual([]);
});

test('削除中に所属が変わった場合、古い sidecar で確定せず最新の所属を残す', async () => {
  const open = fs.promises.open.bind(fs.promises);
  vi.spyOn(fs.promises, 'open').mockImplementation(async (...args: Parameters<typeof fs.promises.open>) => {
    const result = await open(...args);
    if (String(args[0]).endsWith(`${captureId}.json`))
      writer.setFolders({
        folders: [
          { id: 'a', name: 'A', items: [captureId] },
          { id: 'b', name: 'B', items: [captureId] },
          { id: 'c', name: 'C', items: [captureId] },
        ],
      });
    return result;
  });
  await expect(deletePost()).rejects.toThrow('Post changed during deletion');
  expect(writer.getPostFlags(captureId)?.folders).toEqual(['a', 'b', 'c']);
  expect(fs.readFileSync(path.join(itemDir, 'image.jpg'), 'utf8')).toBe('original');
  expect(fs.readdirSync(trashDir)).toEqual([]);
});

test('コピーによる引用保持の途中失敗でも元ファイルと DB 所属を残す', async () => {
  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, quotedPostId) VALUES (?, ?, ?, ?)').run('quote-user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', captureId);
  sqlite.prepare('UPDATE posts SET image = ? WHERE captureId = ?').run('items/missing/shared.jpg', captureId);
  await expect(deletePost()).rejects.toThrow();
  expectPreserved();
  expect(sqlite.prepare('SELECT isContext FROM posts WHERE captureId = ?').get(captureId)).toEqual({ isContext: 0 });
  expect(fs.readdirSync(trashDir)).toEqual([]);
});

test('既存のゴミ箱レコードには上書きせず、元の投稿も消さない', async () => {
  fs.mkdirSync(trashDir);
  fs.writeFileSync(path.join(trashDir, `${captureId}.json`), 'previous trash record');
  await expect(deletePost()).rejects.toThrow('already exists');
  expectPreserved();
  expect(fs.readFileSync(path.join(trashDir, `${captureId}.json`), 'utf8')).toBe('previous trash record');
});

test('成功時は複数フォルダを sidecar に保存してから DB の削除を確定する', async () => {
  await expect(deletePost()).resolves.toEqual({ ok: true });
  expect(sqlite.prepare('SELECT captureId FROM posts WHERE captureId = ?').get(captureId)).toBeUndefined();
  expect(fs.existsSync(itemDir)).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(trashDir, `${captureId}.json`), 'utf8')).folders).toEqual(['a', 'b']);
  expect(fs.readFileSync(path.join(trashDir, captureId, 'image.jpg'), 'utf8')).toBe('original');
});

test('引用される投稿は context 化し、共有用の元ファイルを保持する', async () => {
  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt, quotedPostId) VALUES (?, ?, ?, ?)').run('quote-user', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', captureId);
  await expect(deletePost()).resolves.toEqual({ ok: true });
  expect(sqlite.prepare('SELECT isContext FROM posts WHERE captureId = ?').get(captureId)).toEqual({ isContext: 1 });
  expect(fs.readFileSync(path.join(itemDir, 'image.jpg'), 'utf8')).toBe('original');
  expect(fs.readFileSync(path.join(trashDir, captureId, 'image.jpg'), 'utf8')).toBe('original');
  expect(JSON.parse(fs.readFileSync(path.join(trashDir, `${captureId}.json`), 'utf8')).folders).toEqual(['a', 'b']);
});

test('同一投稿の並行削除は拒否し、最初の処理の保存先を触らない', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mkdir = fs.promises.mkdir.bind(fs.promises);
  vi.spyOn(fs.promises, 'mkdir').mockImplementation(async (...args: Parameters<typeof fs.promises.mkdir>) => {
    await held;
    return mkdir(...args);
  });
  const options = { folder: dir, trashDir, mediaExts: ['jpg'], captureId, record: { captureId, image: `items/${captureId}/image.jpg` }, commitDelete: vi.fn() };
  const first = trashCapture(options);
  await expect(trashCapture(options)).rejects.toThrow('already in progress');
  release();
  await first;
  expect(options.commitDelete).toHaveBeenCalledOnce();
});

test.skipIf(process.platform !== 'win32')('Windows の一時的な拒否後も削除と復元が完了し、所属が戻る', async () => {
  const rename = fs.promises.rename.bind(fs.promises);
  let failures = 2;
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: Parameters<typeof fs.promises.rename>) => {
    if (failures-- > 0) throw Object.assign(new Error('transient lock'), { code: 'EPERM' });
    return rename(...args);
  });
  await expect(deletePost()).resolves.toEqual({ ok: true });
  failures = 2;
  await expect(handlers.get('restore-post')!({}, captureId)).resolves.toEqual({ ok: true });
  expectPreserved();
  expect(fs.existsSync(path.join(trashDir, `${captureId}.json`))).toBe(false);
});

test.skipIf(process.platform !== 'win32')('Windows の恒久的な後続移動拒否は、復元の一時ロックも待って先に動かした項目を戻す', async () => {
  const legacy = path.join(dir, `${captureId}-media-0.png`);
  fs.writeFileSync(legacy, 'legacy original');
  const rename = fs.promises.rename.bind(fs.promises);
  let rollbackFailures = 2;
  vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: Parameters<typeof fs.promises.rename>) => {
    if (String(args[0]) === legacy) throw Object.assign(new Error('permanent lock'), { code: 'EACCES' });
    if (String(args[0]) === path.join(trashDir, captureId) && rollbackFailures-- > 0) throw Object.assign(new Error('rollback transient lock'), { code: 'EBUSY' });
    return rename(...args);
  });
  await expect(deletePost()).rejects.toThrow('permanent lock');
  expectPreserved();
  expect(fs.readFileSync(legacy, 'utf8')).toBe('legacy original');
  expect(fs.readdirSync(trashDir)).toEqual([]);
  expect(rollbackFailures).toBeLessThan(0);
});

async function legacyTrash() {
  fs.rmSync(itemDir, { recursive: true });
  sqlite.prepare('DELETE FROM posts WHERE captureId=?').run(captureId);
  fs.mkdirSync(trashDir);
  const names = ['image.png', 'video.mp4', 'poster.png', 'avatar.png', 'thumbnail.png'];
  for (const name of names) fs.writeFileSync(path.join(trashDir, name), 'original-' + name);
  const record = {
    captureId,
    capturedAt: '2026-01-01',
    updatedAt: '2026-01-01',
    image: names[0],
    video: names[1],
    avatarFile: names[3],
    media: [{ file: names[0], posterFile: names[2], type: 'image', rotation: 90 }],
    linkCard: { url: 'https://example.test', thumbnailFile: names[4] },
    folders: ['a', 'b'],
    manualGroups: [{ groupId: 7, seq: 0 }],
    userKind: 'media',
    tagReviewed: true,
    localViewCount: 9,
    tagClassification: { generalTags: ['general'], tags: [{ name: 'work', category: 'work', workName: null }] },
  };
  sqlite.prepare('INSERT INTO manual_groups(id) VALUES(?)').run(7);
  fs.writeFileSync(path.join(trashDir, captureId + '.json'), JSON.stringify(record));
  return { names, record };
}

test('旧 flat を実 IPC で復元し全 DB 参照と所属を保持して再削除・再復元する', async () => {
  const { names } = await legacyTrash();
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(handlers.get('restore-post')!({}, captureId)).resolves.toEqual({ ok: true });
    const post = (await postsByIds(sqlite, [captureId]))[0];
    expect(post).toMatchObject({
      image: `items/${captureId}/${names[0]}`,
      video: `items/${captureId}/${names[1]}`,
      avatarFile: `items/${captureId}/${names[3]}`,
      linkCard: { thumbnailFile: `items/${captureId}/${names[4]}` },
      media: [{ file: `items/${captureId}/${names[0]}`, posterFile: `items/${captureId}/${names[2]}`, rotation: 90 }],
    });
    expect(writer.getPostFlags(captureId)).toMatchObject({ folders: ['a', 'b'], manualGroups: [{ groupId: 7, seq: 0 }], userKind: 'media', tagReviewed: true, tagClassification: { generalTags: ['general'], tags: [{ name: 'work', category: 'work', workName: null }] } });
    expect(sqlite.prepare('SELECT localViewCount FROM posts WHERE captureId=?').get(captureId)).toEqual({ localViewCount: 9 });
    for (const name of names) expect(fs.readFileSync(path.join(itemDir, name), 'utf8')).toBe('original-' + name);
    if (!attempt) {
      await deletePost();
      expect(JSON.parse(fs.readFileSync(path.join(trashDir, captureId + '.json'), 'utf8')).image).toBe(`items/${captureId}/${names[0]}`);
    }
  }
});

test.each(['insert', 'flags'])('実 IPC の %s 拒否は全媒体と sidecar を戻し DB を確定しない', async (mode) => {
  const { names, record } = await legacyTrash();
  sqlite.exec(mode === 'insert' ? "CREATE TRIGGER reject_restore BEFORE INSERT ON posts BEGIN SELECT RAISE(ABORT, 'restore denied'); END" : "CREATE TRIGGER reject_restore_flags BEFORE INSERT ON folder_items BEGIN SELECT RAISE(ABORT, 'restore denied'); END");
  await expect(handlers.get('restore-post')!({}, captureId)).rejects.toThrow('restore denied');
  expect(sqlite.prepare('SELECT captureId FROM posts WHERE captureId=?').get(captureId)).toBeUndefined();
  expect(sqlite.prepare('SELECT * FROM folder_items WHERE postId=?').all(captureId)).toEqual([]);
  for (const name of names) expect(fs.readFileSync(path.join(trashDir, name), 'utf8')).toBe('original-' + name);
  expect(JSON.parse(fs.readFileSync(path.join(trashDir, captureId + '.json'), 'utf8'))).toEqual(record);
  expect(fs.existsSync(itemDir)).toBe(false);
});
