import { type BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import { readConfig } from './lib-config.ts';
import { dimTitlebarSymbolColor, TITLEBAR_COLORS, TITLEBAR_HEIGHT, TITLEBAR_OVERLAY_BACKGROUND } from '../shared/window-chrome.ts';

export function titlebarOptions() {
  if (process.platform === 'win32' && nativeTheme.shouldUseHighContrastColors) {
    return { height: TITLEBAR_HEIGHT, color: TITLEBAR_OVERLAY_BACKGROUND, symbolColor: systemPreferences.getColor('window-text') };
  }
  const theme = readConfig().theme;
  const dark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
  return { height: TITLEBAR_HEIGHT, color: TITLEBAR_OVERLAY_BACKGROUND, symbolColor: TITLEBAR_COLORS[dark ? 'dark' : 'light'].symbolColor };
}

const windows = new Set<BrowserWindow>();
const symbolDimAmounts = new WeakMap<BrowserWindow, number>();

function updateTitlebar(win: BrowserWindow) {
  const options = titlebarOptions();
  const amount = symbolDimAmounts.get(win) ?? 0;
  win.setTitleBarOverlay({ ...options, symbolColor: dimTitlebarSymbolColor(options.symbolColor, amount) });
}

export function setTitlebarSymbolDim(win: BrowserWindow, amount: number): void {
  if (!windows.has(win) || win.isDestroyed()) return;
  symbolDimAmounts.set(win, amount);
  // 背景色を更新しない。DOM の暗幕が透明な操作領域の下まで覆うので、
  // 別プロセスで背景の開閉やフェードを再現する必要はない。
  win.setTitleBarOverlay({ symbolColor: dimTitlebarSymbolColor(titlebarOptions().symbolColor, amount) });
}

export function updateTitlebars() {
  for (const win of windows) updateTitlebar(win);
}

export function trackTitlebar(win: BrowserWindow) {
  windows.add(win);
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) setTitlebarSymbolDim(win, 0);
  });
  win.webContents.on('render-process-gone', () => setTitlebarSymbolDim(win, 0));
  if (windows.size === 1) nativeTheme.on('updated', updateTitlebars);
  win.once('closed', () => {
    windows.delete(win);
    if (!windows.size) nativeTheme.removeListener('updated', updateTitlebars);
  });
}
