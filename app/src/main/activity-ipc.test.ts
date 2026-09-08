import { afterEach, expect, test, vi } from 'vitest';
import { trustedIpcEvent } from '../../../tests/helpers/test-ipc-event';

const stub = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(), events: new Map<string, (...args: any[]) => any>() }));
vi.mock('electron', () => ({ app: { isPackaged: true }, ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => stub.handlers.set(channel, fn), on: (channel: string, fn: (...args: any[]) => any) => stub.events.set(channel, fn) } }));
import { ipcMain } from './activity-ipc';

afterEach(() => vi.restoreAllMocks());

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
