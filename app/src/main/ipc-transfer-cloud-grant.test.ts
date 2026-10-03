import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from './ipc-context';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const stub = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  picked: '' as string,
  confirmation: 1 as number | null,
  messageResolvers: [] as Array<(answer: { response: number }) => void>,
  messageOptions: null as null | { message: string; detail: string; buttons: string[] },
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '0.0.0-test', getLocale: () => 'ja-JP' },
  ipcMain: { handle: (channel: string, handler: Handler) => stub.handlers.set(channel, handler) },
  dialog: {
    showOpenDialog: async () => ({ canceled: !stub.picked, filePaths: stub.picked ? [stub.picked] : [] }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async (...args: unknown[]) => {
      stub.messageOptions = args.at(-1) as typeof stub.messageOptions;
      if (stub.confirmation !== null) return { response: stub.confirmation };
      return new Promise<{ response: number }>((resolve) => stub.messageResolvers.push(resolve));
    },
  },
  clipboard: { read: async () => [] },
  BrowserWindow: { fromWebContents: () => ({}) },
  nativeImage: {},
}));

import { register } from './ipc-transfer';

class FakeWebContents extends EventEmitter {
  readonly id: number;
  readonly mainFrame: { url: string };
  destroyed = false;

  constructor(id: number) {
    super();
    this.id = id;
    this.mainFrame = { url: 'app://bundle/index.html' };
  }

  isDestroyed() {
    return this.destroyed;
  }

  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
  }
}

function eventFor(sender: FakeWebContents) {
  return { sender, senderFrame: sender.mainFrame };
}

describe('クラウド同期先への移動許可', () => {
  let root: string;
  let source: string;
  let savedLanguage: string;
  let libraryMissing: boolean;
  let relocateLibrary: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stub.handlers.clear();
    stub.picked = '';
    stub.confirmation = 1;
    stub.messageResolvers.length = 0;
    stub.messageOptions = null;
    savedLanguage = 'ja';
    libraryMissing = false;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-cloud-grant-'));
    source = path.join(root, 'current-library');
    fs.mkdirSync(source);
    relocateLibrary = vi.fn((_src, dest) => ({ ok: true, saveFolder: dest, moved: 0 }));
    const ctx = {
      getSaveFolder: () => source,
      getLibraryStatus: () => ({ missing: libraryMissing }),
      validateSaveFolder: (dest: string) => {
        fs.mkdirSync(dest, { recursive: true });
        return { ok: true };
      },
      relocateLibrary,
      readConfig: () => ({ saveFolder: source, language: savedLanguage }),
      writeConfig: vi.fn(),
      send: vi.fn(),
      closeDb: vi.fn(),
      openDb: vi.fn(),
      defaultLibraryDir: () => path.join(root, 'default-library'),
      watchInboxFolder: vi.fn(),
      resetDelta: vi.fn(),
    } as unknown as IpcContext;
    register(ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('renderer は移動先を指定できず、承認前には移動できない', async () => {
    const sender = new FakeWebContents(1);
    expect(() => stub.handlers.get('move-save-folder')?.(eventFor(sender), path.join(root, 'arbitrary'))).toThrow('Invalid IPC input');
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(relocateLibrary).not.toHaveBeenCalled();
  });

  test('取消後には許可を残さない', async () => {
    const sender = new FakeWebContents(1);
    stub.picked = path.join(root, 'OneDrive');
    stub.confirmation = 1;

    await expect(stub.handlers.get('pick-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ ok: false, canceled: true });
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(relocateLibrary).not.toHaveBeenCalled();
  });

  test('通常の非クラウド先は警告許可を介さず移動する', async () => {
    const sender = new FakeWebContents(1);
    stub.picked = path.join(root, 'local-disk');

    await expect(stub.handlers.get('pick-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ ok: true });
    expect(stub.messageResolvers).toHaveLength(0);
    expect(relocateLibrary).toHaveBeenCalledOnce();
    expect(relocateLibrary.mock.calls[0][1]).toBe(path.join(stub.picked, 'Hologram', 'Library'));
  });

  test('保存済み English 設定で main 所有の警告を英語表示する', async () => {
    const sender = new FakeWebContents(1);
    savedLanguage = 'en';
    stub.picked = path.join(root, 'OneDrive');
    stub.confirmation = 1;

    await stub.handlers.get('pick-save-folder')?.(eventFor(sender));
    expect(stub.messageOptions).toMatchObject({
      message: 'This folder looks like it syncs with OneDrive',
      buttons: ['Change anyway', 'Cancel'],
    });
    expect(stub.messageOptions?.detail).toContain('The library is rewritten while you use it');
  });

  test('承認した sender だけが main 保持の移動先を一度使える', async () => {
    const approved = new FakeWebContents(1);
    const other = new FakeWebContents(2);
    stub.picked = path.join(root, 'OneDrive');
    stub.confirmation = 0;

    const picked = await stub.handlers.get('pick-save-folder')?.(eventFor(approved));
    expect(picked).toEqual({ ok: false, confirm: 'cloud-sync', provider: 'OneDrive' });
    expect(picked).not.toHaveProperty('dest');
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(other))).resolves.toEqual({ ok: false, error: 'invalid' });
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(approved))).resolves.toMatchObject({ ok: true });
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(approved))).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(relocateLibrary).toHaveBeenCalledOnce();
    expect(relocateLibrary.mock.calls[0][1]).toBe(path.join(stub.picked, 'Hologram', 'Library'));
  });

  test('古い承認は新しい picker の取消後に許可を復活させない', async () => {
    const sender = new FakeWebContents(1);
    stub.confirmation = null;
    stub.picked = path.join(root, 'OneDrive', 'A');
    const oldPick = Promise.resolve(stub.handlers.get('pick-save-folder')?.(eventFor(sender)));
    await vi.waitFor(() => expect(stub.messageResolvers).toHaveLength(1));

    stub.picked = '';
    await expect(stub.handlers.get('pick-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ canceled: true });
    stub.messageResolvers[0]({ response: 0 });
    await expect(oldPick).resolves.toMatchObject({ canceled: true });
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(relocateLibrary).not.toHaveBeenCalled();
  });

  test('古い取消は新しい picker が発行した許可を消さない', async () => {
    const sender = new FakeWebContents(1);
    stub.confirmation = null;
    stub.picked = path.join(root, 'OneDrive', 'A');
    const oldPick = Promise.resolve(stub.handlers.get('pick-save-folder')?.(eventFor(sender)));
    await vi.waitFor(() => expect(stub.messageResolvers).toHaveLength(1));

    stub.picked = path.join(root, 'Dropbox', 'B');
    const newPick = Promise.resolve(stub.handlers.get('pick-save-folder')?.(eventFor(sender)));
    await vi.waitFor(() => expect(stub.messageResolvers).toHaveLength(2));
    stub.messageResolvers[1]({ response: 0 });
    await expect(newPick).resolves.toEqual({ ok: false, confirm: 'cloud-sync', provider: 'Dropbox' });

    stub.messageResolvers[0]({ response: 1 });
    await expect(oldPick).resolves.toMatchObject({ canceled: true });
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ ok: true });
    expect(relocateLibrary).toHaveBeenCalledOnce();
    expect(relocateLibrary.mock.calls[0][1]).toBe(path.join(root, 'Dropbox', 'B', 'Hologram', 'Library'));
  });

  test('25回の承認と終了を繰り返しても destroyed listener は一つだけ', async () => {
    const sender = new FakeWebContents(1);
    stub.confirmation = 0;

    for (let i = 0; i < 25; i++) {
      stub.picked = path.join(root, 'OneDrive', String(i));
      await expect(stub.handlers.get('pick-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ confirm: 'cloud-sync' });
      expect(sender.listenerCount('destroyed')).toBe(1);

      if (i % 3 === 0) {
        await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ ok: true });
      } else if (i % 3 === 1) {
        // 新しい picker の開始とネイティブ警告の取消で、直前の未使用 grant を終える。
        stub.confirmation = 1;
        stub.picked = path.join(root, 'OneDrive', `${i}-cancel`);
        await expect(stub.handlers.get('pick-save-folder')?.(eventFor(sender))).resolves.toMatchObject({ canceled: true });
        stub.confirmation = 0;
        await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toEqual({ ok: false, error: 'invalid' });
      } else {
        // 移動前ガードの失敗でも grant は先に一回消費される。
        libraryMissing = true;
        await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toEqual({ ok: false, error: 'library-missing' });
        libraryMissing = false;
      }
      expect(sender.listenerCount('destroyed')).toBe(1);
    }

    sender.destroy();
    expect(sender.listenerCount('destroyed')).toBe(0);
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(sender))).resolves.toEqual({ ok: false, error: 'invalid' });
  });

  test('期限切れと sender 破棄で許可を消す', async () => {
    vi.useFakeTimers();
    stub.picked = path.join(root, 'OneDrive');
    stub.confirmation = 0;
    const expired = new FakeWebContents(1);
    await stub.handlers.get('pick-save-folder')?.(eventFor(expired));
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(expired))).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(vi.getTimerCount()).toBe(0);

    const destroyed = new FakeWebContents(2);
    await stub.handlers.get('pick-save-folder')?.(eventFor(destroyed));
    destroyed.destroy();
    await expect(stub.handlers.get('move-save-folder')?.(eventFor(destroyed))).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(destroyed.listenerCount('destroyed')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(relocateLibrary).not.toHaveBeenCalled();
  });
});
