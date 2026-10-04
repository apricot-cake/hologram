import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../../app/src/main/ipc-context';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  savePath: '' as string | null,
  saveCalls: 0,
  trash: null as string | null,
  dialogError: null as string | null,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => stub.handlers.set(channel, handler),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true }),
    showSaveDialog: async () => {
      stub.saveCalls++;
      if (stub.dialogError) throw new Error(stub.dialogError);
      return stub.savePath ? { canceled: false, filePath: stub.savePath } : { canceled: true };
    },
  },
  clipboard: { read: async () => [] },
  BrowserWindow: {
    fromWebContents: () => ({ setProgressBar: vi.fn() }),
  },
  app: { getVersion: () => '0.0.0-test' },
}));

import { openDatabase } from '../../app/src/main/lib-db';
import { makeTagResolver, preparePostStmts, writePost } from '../../app/src/main/lib-db-record-writer';
import { register as registerTransferIpc } from '../../app/src/main/ipc-transfer';
import { createDbWriter } from '../../app/src/main/lib-db-write';

let root: string;
let folder: string;
let sqlite: ReturnType<typeof openDatabase>['sqlite'];
let markExported: ReturnType<typeof vi.fn>;
let finishSnapshot: ReturnType<typeof vi.fn>;

beforeEach(() => {
  stub.handlers.clear();
  stub.saveCalls = 0;
  stub.trash = null;
  stub.dialogError = null;
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
  let reserved = false;
  finishSnapshot = vi.fn(async () => {
    reserved = false;
  });
  const ctx = {
    getSaveFolder: () => folder,
    getTrashDir: () => stub.trash,
    ensurePostsSynced: () => ({ db: null, sqlite }),
    getDbWriter: () => createDbWriter(sqlite),
    readConfig: () => ({ saveFolder: folder }),
    readSavePointer: () => folder,
    isConfigCorrupt: () => false,
    clearAllBlockReason: () => null,
    getLibraryStatus: () => ({ missing: false }),
    LIBRARY_MEDIA_EXTS: ['jpg', 'png'],
    send: vi.fn(),
    markExported,
    beginCompleteExport: () => ({ library: folder, epoch: 0, generation: 1 }),
    reserveCompleteExport: () => {
      if (reserved) return null;
      reserved = true;
      return 1;
    },
    pauseCompleteExport: async () => (reserved ? 1 : null),
    finishCompleteExport: finishSnapshot,
    pauseLibraryRelocation: async () => 1,
    finishLibraryRelocation: finishSnapshot,
    getDbForCompleteExport: () => ({ db: null, sqlite }),
    notePostsSaved: vi.fn(),
  } as unknown as IpcContext;
  registerTransferIpc(ctx);
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('完全エクスポートと通知状態', () => {
  test.each(['cancel', 'error'])('保存ダイアログの %s でも reservation を解放して次の export が成功する', async (mode) => {
    if (mode === 'error') stub.dialogError = 'dialog-failed';
    const result = await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false);
    expect(result).toMatchObject({ saved: false });
    if (mode === 'error') expect(result.error).toBe('dialog-failed');
    expect(finishSnapshot).toHaveBeenCalledWith(1);
    expect(markExported).not.toHaveBeenCalled();
    stub.dialogError = null;
    stub.savePath = path.join(root, 'next.zip');
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toMatchObject({ saved: true });
  });
  test('DBと媒体が空なら保存ダイアログを開かず、予約を解放する', async () => {
    fs.unlinkSync(path.join(folder, '1700000000000-export.jpg'));
    sqlite.prepare('DELETE FROM posts').run();
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toEqual({ saved: false, empty: true });
    expect(stub.saveCalls).toBe(0);
    expect(finishSnapshot).toHaveBeenCalledWith(1);
  });

  test('文字だけの投稿は保存ダイアログ前の空判定を通る', async () => {
    fs.unlinkSync(path.join(folder, '1700000000000-export.jpg'));
    sqlite.prepare('UPDATE posts SET image=NULL').run();
    stub.savePath = path.join(root, 'text.zip');
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toMatchObject({ saved: true });
    expect(stub.saveCalls).toBe(1);
  });

  test('分類語彙だけのライブラリも保存ダイアログ前の空判定を通る', async () => {
    fs.unlinkSync(path.join(folder, '1700000000000-export.jpg'));
    sqlite.prepare('DELETE FROM posts').run();
    sqlite.prepare("INSERT INTO tags(name, category) VALUES ('分類語彙だけ', 'character')").run();
    stub.savePath = path.join(root, 'classification.zip');
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toMatchObject({ saved: true });
    expect(stub.saveCalls).toBe(1);
  });

  test('ゴミ箱だけなら includeTrash に応じてダイアログ前に空判定する', async () => {
    fs.unlinkSync(path.join(folder, '1700000000000-export.jpg'));
    sqlite.prepare('DELETE FROM posts').run();
    stub.trash = path.join(root, 'trash');
    fs.mkdirSync(stub.trash);
    fs.writeFileSync(path.join(stub.trash, 'old.json'), '{}');
    stub.savePath = path.join(root, 'trash.zip');
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toEqual({ saved: false, empty: true });
    expect(stub.saveCalls).toBe(0);
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', true)).toMatchObject({ saved: true });
    expect(stub.saveCalls).toBe(1);
  });

  test('コピー中の別 export はダイアログ無しで busy、stage は選択出力の volume に置く', async () => {
    const outputDir = path.join(root, 'external-drive');
    fs.mkdirSync(outputDir);
    stub.savePath = path.join(outputDir, 'backup.zip');
    let start: () => void = () => {},
      release: () => void = () => {};
    const copied = new Promise<void>((resolve) => {
      start = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const copy = fs.promises.copyFile.bind(fs.promises);
    const hook = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args) => {
      expect(path.dirname(path.dirname(String(args[1])))).toBe(outputDir);
      expect(path.basename(path.dirname(String(args[1])))).toMatch(/^\.hologram-complete-export-/);
      start();
      await gate;
      return copy(...args);
    });
    try {
      const first = stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false);
      await copied;
      expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toEqual({ saved: false, error: 'library-busy' });
      expect(stub.saveCalls).toBe(1);
      release();
      expect(await first).toMatchObject({ saved: true });
      expect(fs.readdirSync(outputDir)).toEqual(['backup.zip']);
    } finally {
      release();
      hook.mockRestore();
    }
  });
  test('snapshot copy 失敗でも owner を復旧し、通知を減らさない', async () => {
    stub.savePath = path.join(root, 'backup.zip');
    fs.writeFileSync(stub.savePath, 'existing export');
    const hook = vi.spyOn(fs.promises, 'copyFile').mockRejectedValue(new Error('disk-full'));
    try {
      expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toMatchObject({ saved: false, error: 'disk-full' });
      expect(finishSnapshot).toHaveBeenCalledWith(1);
      expect(markExported).not.toHaveBeenCalled();
      expect(fs.readFileSync(stub.savePath, 'utf8')).toBe('existing export');
    } finally {
      hook.mockRestore();
    }
  });

  test('owner 復旧後の ZIP 出力失敗でも通知を減らさない', async () => {
    stub.savePath = path.join(root, 'missing', 'backup.zip');
    expect(await stub.handlers.get('export-complete')?.(trustedIpcEvent(), 'full', false)).toMatchObject({ saved: false });
    expect(finishSnapshot).toHaveBeenCalledWith(1);
    expect(markExported).not.toHaveBeenCalled();
  });
  test('全消去は引用元の共有メディアも削除する', async () => {
    const quotedFile = path.join(folder, 'quoted-media', 'quote-test', 'media.jpg');
    fs.mkdirSync(path.dirname(quotedFile), { recursive: true });
    fs.writeFileSync(quotedFile, 'quoted image');

    const result = await stub.handlers.get('clear-all')?.(trustedIpcEvent());

    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(fs.existsSync(path.join(folder, 'quoted-media'))).toBe(false);
  });

  test('全消去は通常・衝突captureIdのsidecarだけを削除し無関係なJSONを保持する', async () => {
    const normal = path.join(folder, '1755907200000-a1b2c3d4.json');
    const collision = path.join(folder, '1755907200000-a1b2c3d4-1.json');
    const unrelated = path.join(folder, 'settings.json');
    fs.writeFileSync(normal, '{}');
    fs.writeFileSync(collision, '{}');
    fs.writeFileSync(unrelated, '{}');

    const result = await stub.handlers.get('clear-all')?.(trustedIpcEvent());

    expect(result).toMatchObject({ ok: true, count: 3 });
    expect(fs.existsSync(normal)).toBe(false);
    expect(fs.existsSync(collision)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
  });

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
import { trustedIpcEvent } from '../helpers/test-ipc-event';
