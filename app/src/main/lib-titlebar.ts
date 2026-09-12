import { type BrowserWindow, nativeTheme, systemPreferences } from 'electron';
import { readConfig } from './lib-config.ts';
import { TITLEBAR_COLORS, TITLEBAR_HEIGHT } from '../shared/window-chrome.ts';

export function titlebarOptions() {
  if (process.platform === 'win32' && nativeTheme.shouldUseHighContrastColors) {
    return { height: TITLEBAR_HEIGHT, color: systemPreferences.getColor('window'), symbolColor: systemPreferences.getColor('window-text') };
  }
  const theme = readConfig().theme;
  const dark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
  return { height: TITLEBAR_HEIGHT, ...TITLEBAR_COLORS[dark ? 'dark' : 'light'] };
}

const windows = new Set<BrowserWindow>();

export function updateTitlebars() {
  for (const win of windows) win.setTitleBarOverlay(titlebarOptions());
}

export function trackTitlebar(win: BrowserWindow) {
  windows.add(win);
  if (windows.size === 1) nativeTheme.on('updated', updateTitlebars);
  win.once('closed', () => {
    windows.delete(win);
    if (!windows.size) nativeTheme.removeListener('updated', updateTitlebars);
  });
}
