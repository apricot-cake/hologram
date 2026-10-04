import { afterEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { trustedIpcEvent } from '../../../tests/helpers/test-ipc-event';

const stub = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({ app: { isPackaged: true }, ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => stub.handlers.set(channel, fn), on: (channel: string, fn: (...args: any[]) => any) => stub.events.set(channel, fn) } }));
import { closeLibraryIpcAdmission, ipcMain, isAdmittedLibraryIpc, libraryIpcActivity, openLibraryIpcAdmission, runWhenLibraryAdmissionOpen } from './activity-ipc';
import { runLibraryBackgroundTask, waitForLibraryBackgroundIdle } from './lib-library-background-activity';

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

test('移動中もライブラリ非依存 IPC は検証後に実行し、変更 IPC は拒否する', async () => {
  const external = vi.fn(() => undefined);
  const copyText = vi.fn(async () => true);
  const mutation = vi.fn(() => ({ ok: true }));
  ipcMain.handle('open-external', external);
  ipcMain.handle('copy-text', copyText);
  ipcMain.handle('empty-trash', mutation);
  closeLibraryIpcAdmission();
  expect(stub.handlers.get('open-external')!(trustedIpcEvent(), 'https://example.com')).toBeUndefined();
  await expect(stub.handlers.get('copy-text')!(trustedIpcEvent(), 'text')).resolves.toBe(true);
  expect(() => stub.handlers.get('empty-trash')!(trustedIpcEvent())).toThrow('library relocation is in progress');
  expect(external).toHaveBeenCalledOnce();
  expect(copyText).toHaveBeenCalledOnce();
  expect(mutation).not.toHaveBeenCalled();
});

test('close 後に到着した startup read は activity に入らず再開後に実行し、sender 破棄でも終了する', async () => {
  const restored = { id: 'restored', name: 'Restored', kind: 'static' as const, created: null, parentId: null, items: [] };
  const folders = vi.fn(() => ({ activeId: null, folders: [restored] }));
  ipcMain.handle('get-folders', folders);
  closeLibraryIpcAdmission();
  const makeEvent = (id: number) => {
    const sender = new EventEmitter() as EventEmitter & { id: number; mainFrame: { url: string } };
    sender.id = id;
    sender.mainFrame = { url: 'app://bundle/index.html' };
    return { sender, senderFrame: sender.mainFrame };
  };
  const event = makeEvent(50);
  const waiting = stub.handlers.get('get-folders')!(event);
  expect(folders).not.toHaveBeenCalled();
  openLibraryIpcAdmission();
  await expect(waiting).resolves.toMatchObject({ folders: [restored] });

  closeLibraryIpcAdmission();
  const destroyed = makeEvent(51);
  const abandoned = stub.handlers.get('get-folders')!(destroyed);
  destroyed.sender.emit('destroyed');
  await expect(abandoned).rejects.toThrow('sender was destroyed');
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
  // queued setImmediate より前に次の relocation が admission を再び閉じる。
  closeLibraryIpcAdmission();
  await new Promise((resolve) => setImmediate(resolve));
  expect(createWindow).not.toHaveBeenCalled();
  expect(startup).not.toHaveBeenCalled();

  openLibraryIpcAdmission();
  await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
  expect(startup).toHaveBeenCalledOnce();
  expect(startupResult).toEqual({ activeId: null, folders: [] });
});

test('移動中の second-instance は次の再開まで再保留され、生成後の startup が一度だけ成功する', async () => {
  const appEvents = new EventEmitter();
  const startup = vi.fn(() => ({ activeId: null, folders: [] }));
  ipcMain.handle('get-folders', startup);
  const createWindow = vi.fn(() => stub.handlers.get('get-folders')!(trustedIpcEvent()));
  // index.ts の通常 second-instance 分岐と同じ実イベント配線。activate/hidden/post-link 分岐は
  // それより前で return するため、この callback に到達する通常起動だけを fixture にする。
  appEvents.on('second-instance', () => runWhenLibraryAdmissionOpen(createWindow));

  closeLibraryIpcAdmission();
  appEvents.emit('second-instance');
  expect(createWindow).not.toHaveBeenCalled();

  openLibraryIpcAdmission();
  closeLibraryIpcAdmission();
  await new Promise((resolve) => setImmediate(resolve));
  expect(createWindow).not.toHaveBeenCalled();
  expect(startup).not.toHaveBeenCalled();

  openLibraryIpcAdmission();
  await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
  expect(startup).toHaveBeenCalledOnce();
});

test('移動中もdeep link・ビルド情報・接触状態・環境設定を取得し、設定を保存できる', () => {
  const invoke = (channel: 'take-post-link' | 'app-info' | 'get-extension-contact' | 'get-prefs' | 'set-pref', ...args: unknown[]) => {
    const handler = vi.fn(() => (channel === 'set-pref' ? { ok: true } : null));
    ipcMain.handle(channel, handler as never);
    stub.handlers.get(channel)!(trustedIpcEvent(), ...args);
    expect(handler).toHaveBeenCalledOnce();
  };
  closeLibraryIpcAdmission();
  for (const channel of ['take-post-link', 'app-info', 'get-extension-contact', 'get-prefs'] as const) invoke(channel);
  invoke('set-pref', 'theme', 'dark');
});

test('主windowの検証済みタブ保存はsender破棄後も再開時に適用し、未認可入力は保持しない', async () => {
  const makeEvent = (id: number) => {
    const sender = Object.assign(new EventEmitter(), { id, mainFrame: { url: 'app://bundle/index.html' } });
    return { sender, senderFrame: sender.mainFrame };
  };
  const save = vi.fn(() => ({ ok: true }));
  const authorize = vi.fn((event) => event.sender.id === 1);
  ipcMain.handle('set-tabs', save, { retainAfterSenderDestroyed: authorize });
  closeLibraryIpcAdmission();
  const event = makeEvent(1);
  const saved = stub.handlers.get('set-tabs')!(event, { tabs: [] });
  event.sender.emit('destroyed');
  expect(save).not.toHaveBeenCalled();
  expect(() => stub.handlers.get('set-tabs')!(makeEvent(2), { tabs: [] })).toThrow('relocation');
  const authCalls = authorize.mock.calls.length;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => stub.handlers.get('set-tabs')!(makeEvent(1), { tabs: 'invalid' })).toThrow('Invalid IPC input');
  expect(authorize).toHaveBeenCalledTimes(authCalls);
  openLibraryIpcAdmission();
  await expect(saved).resolves.toEqual({ ok: true });
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]).toEqual([event, { tabs: [], activeTabId: null }]);
});

test('開始済みIPCが停止中に予約する背景処理も、接続を閉じる前に完了を待つ', async () => {
  let releaseIpc!: () => void;
  let releaseBackground!: () => void;
  const ipcWait = new Promise<void>((resolve) => {
    releaseIpc = resolve;
  });
  const backgroundWait = new Promise<void>((resolve) => {
    releaseBackground = resolve;
  });
  let background!: Promise<void>;
  ipcMain.handle('restore-post', async () => {
    await ipcWait;
    background = runLibraryBackgroundTask(() => backgroundWait);
    return { ok: true };
  });
  const ipc = stub.handlers.get('restore-post')!(trustedIpcEvent(), 'capture.jpg');
  closeLibraryIpcAdmission();
  let idle = false;
  const pause = (async () => {
    await new Promise<void>((resolve) => libraryIpcActivity.whenIdle(resolve));
    await waitForLibraryBackgroundIdle();
    idle = true;
  })();
  releaseIpc();
  await ipc;
  await new Promise((resolve) => setImmediate(resolve));
  expect(idle).toBe(false);
  releaseBackground();
  await background;
  await pause;
  expect(idle).toBe(true);
});

test('再開直後に受領した最新タブ保存を、保留していた古い保存で上書きしない', async () => {
  const sender = Object.assign(new EventEmitter(), { id: 1, mainFrame: { url: 'app://bundle/index.html' } });
  const event = { sender, senderFrame: sender.mainFrame };
  const save = vi.fn((_event: unknown, _data: { tabs: { id: string }[] }) => ({ ok: true }));
  ipcMain.handle('set-tabs', save, { retainAfterSenderDestroyed: () => true });
  closeLibraryIpcAdmission();
  const old = stub.handlers.get('set-tabs')!(event, { tabs: [{ id: 'old' }] });
  openLibraryIpcAdmission();
  stub.handlers.get('set-tabs')!(event, { tabs: [{ id: 'latest' }] });
  await old;
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][1].tabs[0].id).toBe('latest');
});
