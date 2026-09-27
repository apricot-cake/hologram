import { EventEmitter } from 'node:events';
import { type BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readConfig } from './lib-config';
import { setTitlebarSymbolDim, titlebarOptions, trackTitlebar, updateTitlebars } from './lib-titlebar';

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    nativeTheme: Object.assign(new EventEmitter(), { shouldUseHighContrastColors: false, shouldUseDarkColors: false }),
    systemPreferences: { getColor: vi.fn(() => '#ffff00') },
  };
});
vi.mock('./lib-config.ts', () => ({ readConfig: vi.fn(() => ({ theme: 'light' })) }));

const windows: EventEmitter[] = [];

function createWindow() {
  const win = Object.assign(new EventEmitter(), {
    setTitleBarOverlay: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: new EventEmitter(),
  });
  windows.push(win);
  const native = win as unknown as BrowserWindow;
  trackTitlebar(native);
  return { win, native };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readConfig).mockReturnValue({ theme: 'light' });
  Object.assign(nativeTheme, { shouldUseHighContrastColors: false, shouldUseDarkColors: false });
});
afterEach(() => {
  for (const win of windows.splice(0)) win.emit('closed');
});

describe('透明なネイティブ操作領域', () => {
  test.each(['light', 'dark', 'auto'] as const)('%s の初期背景も透明にする', (theme) => {
    vi.mocked(readConfig).mockReturnValue({ theme });
    expect(titlebarOptions().color).toBe('#00000000');
  });

  test.runIf(process.platform === 'win32')('ハイコントラストでも背景は DOM の Canvas に任せる', () => {
    Object.assign(nativeTheme, { shouldUseHighContrastColors: true });
    expect(titlebarOptions()).toEqual({ height: 44, color: '#00000000', symbolColor: '#ffff00' });
    expect(systemPreferences.getColor).toHaveBeenCalledExactlyOnceWith('window-text');
  });

  test('モーダルの開閉や重なりで背景色を書き換えない', () => {
    const { win, native } = createWindow();
    for (const amount of [0.5, 0.75, 0.5, 0, 0.8, 0]) setTitlebarSymbolDim(native, amount);
    expect(win.setTitleBarOverlay.mock.calls.map(([options]) => options)).toEqual([{ symbolColor: '#101112' }, { symbolColor: '#080809' }, { symbolColor: '#101112' }, { symbolColor: '#202124' }, { symbolColor: '#060707' }, { symbolColor: '#202124' }]);
  });

  test('モーダル中のテーマ変更でも透明な背景を維持する', () => {
    const { win, native } = createWindow();
    setTitlebarSymbolDim(native, 0.5);
    vi.mocked(readConfig).mockReturnValue({ theme: 'dark' });
    updateTitlebars();
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ height: 44, color: '#00000000', symbolColor: '#737477' });
    setTitlebarSymbolDim(native, 0);
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ symbolColor: '#e6e8ed' });
  });

  test('システムテーマ変更でも背景は透明のままにする', () => {
    const { win } = createWindow();
    vi.mocked(readConfig).mockReturnValue({ theme: 'auto' });
    Object.assign(nativeTheme, { shouldUseDarkColors: true });
    nativeTheme.emit('updated');
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ height: 44, color: '#00000000', symbolColor: '#e6e8ed' });
  });

  test('ページの破棄では記号色だけを復元する', () => {
    const { win, native } = createWindow();
    setTitlebarSymbolDim(native, 0.5);
    win.webContents.emit('did-start-navigation', {}, 'app://bundle/index.html', false, true);
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ symbolColor: '#202124' });
    setTitlebarSymbolDim(native, 0.8);
    win.webContents.emit('render-process-gone');
    expect(win.setTitleBarOverlay).toHaveBeenLastCalledWith({ symbolColor: '#202124' });
  });

  test('閉じたウィンドウへ暗転を送らない', () => {
    const { win, native } = createWindow();
    win.emit('closed');
    setTitlebarSymbolDim(native, 0.5);
    nativeTheme.emit('updated');
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
