import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  savePath: '' as string | null,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => stub.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true }),
    showSaveDialog: async () => (stub.savePath ? { canceled: false, filePath: stub.savePath } : { canceled: true }),
  },
  clipboard: { availableFormats: () => [], readImage: () => ({ isEmpty: () => true }) },
  BrowserWindow: {
    fromWebContents: () => ({ setProgressBar: vi.fn() }),
  },
  app: { getVersion: () => '0.0.0-test' },
}));

import { openDatabase } from '../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../app/src/main/lib-db-record-writer';
import { register as registerTransferIpc } from '../app/src/main/ipc-transfer';

let root: string;
let folder: string;
let sqlite: ReturnType<typeof openDatabase>['sqlite'];
let markExported: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stub.handlers.clear();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-export-complete-'));
  folder = path.join(root, 'library');
  fs.mkdirSync(folder, { recursive: true });
  const handle = openDatabase(path.join(folder, 'hologram.db'));
  sqlite = handle.sqlite;

  const captureId = '1700000000000-export';
  const image = `${captureId}.jpg`;
  fs.writeFileSync(path.join(folder, image), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writePost(preparePostStmts(sqlite), makeTagResolver(sqlite), {
    captureId,
    image,
    url: 'https://example.com/post/1',
    platform: 'web',
    text: 'エクスポート確認',
    capturedAt: '2026-08-26T00:00:00.000Z',
    tags: [],
  } as any);

  markExported = vi.fn();
  const ctx = {
    getSaveFolder: () => folder,
    getTrashDir: () => null,
    ensurePostsSynced: () => ({ db: null, sqlite }),
    send: vi.fn(),
    markExported,
    notePostsSaved: vi.fn(),
  } as unknown as IpcContext;
  registerTransferIpc(ctx);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('完全エクスポートと通知状態', () => {
  test('完全ZIPの保存に成功した時だけ通知件数をリセットする', async () => {
    stub.savePath = path.join(root, 'backup.zip');
    const result = await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false);

    expect(result).toMatchObject({ saved: true });
    expect(fs.existsSync(stub.savePath)).toBe(true);
    expect(markExported).toHaveBeenCalledTimes(1);
  });

  test('画像だけの書き出しでは通知件数をリセットしない', async () => {
    stub.savePath = path.join(root, 'images.zip');
    const result = await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'images', false);

    expect(result).toMatchObject({ saved: true });
    expect(markExported).not.toHaveBeenCalled();
  });

  test('保存を取り消した時は通知件数をリセットしない', async () => {
    stub.savePath = null;
    const result = await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false);

    expect(result).toEqual({ saved: false });
    expect(markExported).not.toHaveBeenCalled();
  });
});
import { trustedIpcEvent } from './test-ipc-event';
