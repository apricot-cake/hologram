import { afterEach, expect, test, vi } from 'vitest';
import { trustedIpcEvent } from '../../../tests/helpers/test-ipc-event';

const stub = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({ app: { isPackaged: true }, ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => stub.handlers.set(channel, fn), on: (channel: string, fn: (...args: any[]) => any) => stub.events.set(channel, fn) } }));
import { closeLibraryIpcAdmission, ipcMain, isAdmittedLibraryIpc, libraryIpcActivity, openLibraryIpcAdmission, runWhenLibraryAdmissionOpen } from './activity-ipc';

afterEach(() => {
  openLibraryIpcAdmission();
  vi.restoreAllMocks();
});

test('不正入力はハンドラを実行せず、データをログに含めない', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const handler = vi.fn(() => ({ ok: true }));
  ipcMain.handle('set-folders', handler);
  expect(() => stub.handlers.get('set-folders')!(trustedIpcEvent(), { folders: 'private-value' })).toThrow('Invalid IPC input');
  expect(handler).not.toHaveBeenCalled();
  expect(JSON.stringify(warn.mock.calls)).not.toContain('private-value');
});

test('外部ページ・子フレーム・破棄されたフレームはハンドラを実行しない', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const handler = vi.fn(() => ({ ok: true }));
  ipcMain.handle('clear-history', handler);
  const external = trustedIpcEvent();
  external.senderFrame.url = 'https://example.com/';
  const child = trustedIpcEvent();
  child.senderFrame = { url: 'app://bundle/index.html' };
  for (const event of [external, child, { senderFrame: null }, null]) expect(() => stub.handlers.get('clear-history')!(event)).toThrow('Untrusted IPC sender');
  expect(handler).not.toHaveBeenCalled();
});

test('検証済み入力と既定値がハンドラへ届く', () => {
  const handler = vi.fn((_event: unknown, _data: unknown) => ({ ok: true }));
  ipcMain.handle('set-folders', handler);
  stub.handlers.get('set-folders')!(trustedIpcEvent(), { folders: [{ id: 'a', name: 'A' }] });
  expect(handler.mock.calls[0][1]).toMatchObject({ activeId: null, folders: [{ items: [], parentId: null }] });
});

test('応答しないイベントにも送信元と入力の検証が効く', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const handler = vi.fn();
  ipcMain.on('open-new-window', handler);
  stub.events.get('open-new-window')!(null);
  expect(handler).not.toHaveBeenCalled();
  stub.events.get('open-new-window')!(trustedIpcEvent());
  expect(handler).toHaveBeenCalledOnce();
});

test('close 前に admit 済みの async IPC は完了まで権限を保ち、close 後の新規 IPC は開始しない', async () => {
  let release!: () => void;
  const deferred = new Promise<void>((resolve) => {
    release = resolve;
  });
  const restore = vi.fn(async () => {
    await deferred;
    return { ok: isAdmittedLibraryIpc() };
  });
  const empty = vi.fn(() => ({ ok: true }));
  ipcMain.handle('restore-post', restore);
  ipcMain.handle('empty-trash', empty);

  const inFlight = stub.handlers.get('restore-post')!(trustedIpcEvent(), 'capture.jpg');
  closeLibraryIpcAdmission();
  expect(() => stub.handlers.get('empty-trash')!(trustedIpcEvent())).toThrow('library relocation is in progress');
  expect(empty).not.toHaveBeenCalled();

  let idle = false;
  libraryIpcActivity.whenIdle(() => {
    idle = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(idle).toBe(false);
  release();
  await expect(inFlight).resolves.toEqual({ ok: true });
  await vi.waitFor(() => expect(idle).toBe(true));
});

test('通常 picker は relocation の idle 待機に自分自身を登録しない', async () => {
  ipcMain.handle('pick-save-folder', async () => {
    closeLibraryIpcAdmission();
    await new Promise<void>((resolve) => libraryIpcActivity.whenIdle(resolve));
    return { ok: false, canceled: true };
  });
  await expect(stub.handlers.get('pick-save-folder')!(trustedIpcEvent())).resolves.toEqual({ ok: false, canceled: true });
});

test('移動中の new-window は再開後に生成され、startup IPC を正常に完了できる', async () => {
  const startup = vi.fn(() => ({ activeId: null, folders: [] }));
  ipcMain.handle('get-folders', startup);
  let startupResult: unknown = null;
  const createWindow = vi.fn(() => {
    startupResult = stub.handlers.get('get-folders')!(trustedIpcEvent());
  });

  closeLibraryIpcAdmission();
  runWhenLibraryAdmissionOpen(createWindow);
  expect(createWindow).not.toHaveBeenCalled();
  expect(startup).not.toHaveBeenCalled();

  openLibraryIpcAdmission();
  await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
  expect(startup).toHaveBeenCalledOnce();
  expect(startupResult).toEqual({ activeId: null, folders: [] });
});
