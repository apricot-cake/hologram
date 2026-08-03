'use strict';

// Pin (floating mini-viewer) windows (#79) — createPinWindow, the relay that
// decides which one a "send to pin" hits, and the one-shot initial-payload
// handoff a freshly created window pulls on its own first paint.
//
// Deliberately a SEPARATE registry from lib-window.ts's `windows[]`, not that
// array with a type tag: sendToWin/sendToOtherWins iterate `windows[]` for
// every #32 broadcast (org-changed, posts-changed, tabs, window-maximized-
// changed…), and a pin window subscribes to none of them — it holds no
// library state of its own, just a window-local item list. A plain second
// array keeps every one of those broadcasts pin-window-free by construction
// (nothing to filter, nothing a future broadcast call site could forget to
// exclude), at the cost of the two registries not literally being one — pin
// windows still show up in Electron's own BrowserWindow.getAllWindows() (quit-
// when-all-closed, window-all-closed) exactly like any other window, so no
// lifecycle wiring is lost by keeping them apart.
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_ICON, DEV_SERVER_URL, isDarkTheme, resolveTheme } from './lib-window.ts';
import { pinIndexUrl } from './renderer-files.ts';
import type { PinItem } from './ipc-payloads.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pinWindows: BrowserWindow[] = [];
/** The last pin window to receive OS focus — "send to pin" without newWindow
 * targets this one, so switching focus between several is what "an active
 * destination" means (no separate UI to pick one). */
let lastActiveId: number | null = null;
/** A freshly created pin window's own opening set, held until its renderer
 * asks for it (pin-get-initial) — see createPinWindow's loadURL comment below
 * for why this can't just ride the navigation instead. Keyed by webContents
 * id, same key lastActiveId uses. */
const pendingInitial = new Map<number, PinItem[]>();

function livePinWindows(): BrowserWindow[] {
  return pinWindows.filter((w) => !w.isDestroyed());
}

function activePinWindow(): BrowserWindow | null {
  const list = livePinWindows();
  if (!list.length) return null;
  return list.find((w) => w.webContents.id === lastActiveId) || list[list.length - 1];
}

function createPinWindow(initialItems: PinItem[]): BrowserWindow {
  const theme = resolveTheme();
  const dark = isDarkTheme(theme);
  const w = new BrowserWindow({
    width: 340,
    height: 400,
    minWidth: 220,
    minHeight: 220,
    frame: false,
    resizable: true,
    // HOLOGRAM_SMOKE=1: every window this run creates hidden — a verification
    // run must never take over the developer's screen (same guard
    // open-image-window and createWindow itself already apply).
    show: process.env.HOLOGRAM_SMOKE !== '1',
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Hologram',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  // 'floating' (not the default level): stays above OTHER APPS' windows, which
  // is the whole point (#79's "他アプリを前面化しても最前面を維持する") — the
  // plain always-on-top level only beats other windows in THIS app.
  w.setAlwaysOnTop(true, 'floating');
  w.removeMenu();
  pinWindows.push(w);
  pendingInitial.set(w.webContents.id, initialItems);
  lastActiveId = w.webContents.id;
  w.on('focus', () => {
    lastActiveId = w.webContents.id;
  });
  w.on('closed', () => {
    const i = pinWindows.indexOf(w);
    if (i >= 0) pinWindows.splice(i, 1);
    pendingInitial.delete(w.webContents.id);
    if (lastActiveId === w.webContents.id) {
      const remain = livePinWindows();
      lastActiveId = remain.length ? remain[remain.length - 1].webContents.id : null;
    }
  });
  const query = { theme };
  if (DEV_SERVER_URL) {
    // Dev: electron-vite's Vite dev server exposes every rollupOptions.input
    // entry at its own path off the same origin — pin.html sits next to
    // index.html there the same way it does in out/renderer/ once built.
    const devUrl = new URL(DEV_SERVER_URL);
    devUrl.pathname = '/pin.html';
    devUrl.search = new URLSearchParams(query).toString();
    w.loadURL(devUrl.href);
  } else {
    w.loadURL(pinIndexUrl(query));
  }
  return w;
}

/**
 * Relay `items` to the last-focused pin window, or open a fresh one when
 * `newWindow` is true (the folder "ピンで開く" entry point always wants its
 * own window rather than piling into whatever is currently active) or none
 * exists yet.
 */
function pinSend(items: PinItem[], newWindow: boolean): void {
  if (!items.length) return;
  const target = newWindow ? null : activePinWindow();
  if (target) {
    target.webContents.send('pin-items-added', items);
    return;
  }
  createPinWindow(items);
}

/** The calling pin window's own boot payload, consumed once — a second call
 * from the same window (there is no reason for one) answers empty. */
function takeInitial(webContentsId: number): PinItem[] {
  const items = pendingInitial.get(webContentsId) || [];
  pendingInitial.delete(webContentsId);
  return items;
}

/** Toggles the CALLING pin window's always-on-top; returns the new state, or
 * false if it isn't a live pin window (never happens through the IPC handler,
 * which resolves the caller from its own webContents). */
function toggleAlwaysOnTop(webContentsId: number): boolean {
  const w = livePinWindows().find((x) => x.webContents.id === webContentsId);
  if (!w) return false;
  const next = !w.isAlwaysOnTop();
  w.setAlwaysOnTop(next, 'floating');
  return next;
}

export { createPinWindow, pinSend, takeInitial, toggleAlwaysOnTop };
