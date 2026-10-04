import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDatabase } from '../../app/src/main/lib-db.ts';
import { createDbWriter } from '../../app/src/main/lib-db-write.ts';
import { trashCapture } from '../../app/src/main/lib-trash-capture.ts';
import { itemDirectoryAbsolute } from '../../native-host/item-storage.mts';

const handlers = vi.hoisted(() => new Map<string, (...args: any[]) => any>());
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
  register({ getSaveFolder: () => dir, getTrashDir: () => trashDir, baseOf: () => captureId, LIBRARY_MEDIA_EXTS: ['jpg'], getDbWriter: () => writer, ensurePostsSynced: () => ({ sqlite }), scheduleSavedIndexWrite: vi.fn() } as unknown as IpcContext);
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
