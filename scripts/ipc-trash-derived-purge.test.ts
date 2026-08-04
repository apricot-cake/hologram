// Integration test for #833's acceptance criterion 5: derived rows survive a
// soft-delete into the trash, and are removed only once a capture is gone for
// good (delete-from-trash / empty-trash) — the same timing hologram.db's own
// posts row already follows via ipc-trash.ts's delete-post (which drops the
// posts row the moment a capture moves INTO the trash, not when it leaves it).
//
// Follows scripts/clipboard-intake.test.ts's shape: 'electron' is mocked so
// ipcMain.handle's registered callbacks can be invoked directly; everything
// else (the save folder, the trash folder, hologram.db, derived.db) is real.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      stub.handlers.set(channel, handler);
    },
  },
}));

const env = vi.hoisted(() => ({ configDir: '' }));
vi.mock('../app/src/main/native-host.ts', () => ({ configDir: () => env.configDir }));

import { openDatabase } from '../app/src/main/lib-db';
import { createDbWriter } from '../app/src/main/lib-db-write';
import { ensureDerivedDb, purgeDerivedForCapture, resetDerivedDbForTest } from '../app/src/main/lib-derived-db';
import { TRASH_SUBDIR } from '../app/src/main/lib-save-folder-path';
import { register as registerTrashIpc } from '../app/src/main/ipc-trash';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-trash-derived-'));
env.configDir = path.join(root, 'config');
const saveFolder = path.join(root, 'library');
fs.mkdirSync(saveFolder, { recursive: true });
fs.mkdirSync(env.configDir, { recursive: true });

const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));

// Same regex index.ts's private baseOf() uses — not exported, so mirrored here.
const baseOf = (name: string | null | undefined) =>
  path
    .basename(name || '')
    .replace(/-poster\.[a-z0-9]+$/i, '')
    .replace(/\.[a-z0-9]+$/i, '');

const ctx = {
  getSaveFolder: () => saveFolder,
  getTrashDir: () => path.join(saveFolder, TRASH_SUBDIR),
  baseOf,
  LIBRARY_MEDIA_EXTS: ['jpg', 'jpeg', 'png'],
  getDbWriter: () => createDbWriter(sqlite),
  ensurePostsSynced: () => ({ db: null, sqlite }),
  scheduleSavedIndexWrite: () => {},
  send: () => {},
} as unknown as IpcContext;

registerTrashIpc(ctx);

const deletePost = (image: string) => stub.handlers.get('delete-post')?.(null, image);
const deleteFromTrash = (image: string) => stub.handlers.get('delete-from-trash')?.(null, image);
const emptyTrash = () => stub.handlers.get('empty-trash')?.(null);

function insertPost(captureId: string) {
  sqlite.prepare('INSERT INTO posts (captureId, capturedAt, updatedAt) VALUES (?, ?, ?)').run(captureId, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
}

function seedDerived(captureId: string) {
  const { sqlite: derived } = ensureDerivedDb(env.configDir);
  derived.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES (?, 'file', 'ocr', 1, 1, '2026-01-01')").run(captureId);
}

function derivedCount(captureId: string): number {
  const { sqlite: derived } = ensureDerivedDb(env.configDir);
  return (derived.prepare('SELECT COUNT(*) AS n FROM derived_progress WHERE captureId = ?').get(captureId) as { n: number }).n;
}

beforeEach(() => {
  sqlite.exec('DELETE FROM posts');
  fs.rmSync(path.join(saveFolder, TRASH_SUBDIR), { recursive: true, force: true });
  resetDerivedDbForTest();
  fs.rmSync(path.join(env.configDir, 'derived.db'), { force: true });
});

afterAll(() => {
  sqlite.close();
  resetDerivedDbForTest();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('delete-post（ゴミ箱行き）', () => {
  test('派生行は消えない', async () => {
    insertPost('cap-1');
    seedDerived('cap-1');

    await deletePost('cap-1.jpg');

    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM posts WHERE captureId = 'cap-1'").get()).toEqual({ n: 0 }); // 真実源側は即座に消える
    expect(fs.existsSync(path.join(saveFolder, TRASH_SUBDIR, 'cap-1.json'))).toBe(true); // ゴミ箱に自己記述レコードが残る
    expect(derivedCount('cap-1')).toBe(1); // 派生行はまだ残る
  });
});

describe('delete-from-trash（完全削除・1件）', () => {
  test('派生行が消える', async () => {
    insertPost('cap-1');
    seedDerived('cap-1');
    await deletePost('cap-1.jpg');
    expect(derivedCount('cap-1')).toBe(1);

    await deleteFromTrash('cap-1.jpg');

    expect(fs.existsSync(path.join(saveFolder, TRASH_SUBDIR, 'cap-1.json'))).toBe(false);
    expect(derivedCount('cap-1')).toBe(0);
  });

  test('無関係な capture の派生行には触らない', async () => {
    insertPost('cap-1');
    insertPost('cap-2');
    seedDerived('cap-1');
    seedDerived('cap-2');
    await deletePost('cap-1.jpg');
    await deletePost('cap-2.jpg');

    await deleteFromTrash('cap-1.jpg');

    expect(derivedCount('cap-1')).toBe(0);
    expect(derivedCount('cap-2')).toBe(1);
  });
});

describe('empty-trash（完全削除・一括）', () => {
  test('ゴミ箱にあった全 capture の派生行が消える', async () => {
    insertPost('cap-1');
    insertPost('cap-2');
    seedDerived('cap-1');
    seedDerived('cap-2');
    await deletePost('cap-1.jpg');
    await deletePost('cap-2.jpg');
    expect(derivedCount('cap-1')).toBe(1);
    expect(derivedCount('cap-2')).toBe(1);

    await emptyTrash();

    expect(fs.existsSync(path.join(saveFolder, TRASH_SUBDIR))).toBe(false);
    expect(derivedCount('cap-1')).toBe(0);
    expect(derivedCount('cap-2')).toBe(0);
  });

  test('ゴミ箱が無くても例外を投げない', async () => {
    await expect(emptyTrash()).resolves.toEqual({ ok: true });
  });
});

// 直接 purgeDerivedForCapture を叩く経路も、trash を経由しない完全削除の呼び
// 出しどころ(将来 clear-all 等が使うとしても)として動くことを確認しておく。
describe('purgeDerivedForCapture は ipc-trash からも同じ関数が呼ばれている', () => {
  test('trash を経ずに直接呼んでも同じ結果になる', () => {
    insertPost('cap-1');
    seedDerived('cap-1');
    const { sqlite: derived } = ensureDerivedDb(env.configDir);

    purgeDerivedForCapture(derived, 'cap-1');

    expect(derivedCount('cap-1')).toBe(0);
  });
});
