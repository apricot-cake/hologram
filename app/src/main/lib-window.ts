'use strict';

// The main window (#227): its icon, its persisted bounds, the navigation
// lockdown every web-contents gets, and the creation itself — index.ts's
// `// --- Window size/position persistence ---`, the navigation-guard block and
// `// --- Window ---` sections, moved out whole.
//
// This module OWNS the `win` binding. It has to: createWindow assigns it, and an
// importer cannot assign to an imported binding. Everything else reads it
// through getWin() / sendToWin(), which is what index.ts's ctx already handed the
// IPC handlers — so the window stopped being a file-scoped variable the whole
// main process could touch and became one module's state.
//
// The dev-server URL lives here too (it is what createWindow loads and what the
// navigation guard's allow-list is derived from), but the warning about a
// REJECTED value stays at the call site in index.ts: this module's body runs
// before index.ts configures electron-log's file path, so logging here would
// land the line somewhere other than the log it describes.

import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import log from 'electron-log/main';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { appIndexUrl, isAppRendererUrl } from './renderer-files.ts';
import { readConfig, writeConfig } from './lib-config.ts';
import { resolveDevServerUrl } from './dev-server-guard.ts';
import { isViewerImageName } from './library-files.ts';

const nodeRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Holographic app icon (iridescent square). Used for the taskbar/window icon at
// runtime; electron-builder converts the same PNG to .ico for the installed exe.
// out/main/index.js -> out -> app/, where assets/ sits alongside out/ (both dev
// and packaged: electron-builder's `files` ships out/** and assets/** at the same
// relative depth from the package root).
const APP_ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

let win: BrowserWindow | null = null;

/** The main window, or null before it is created / after it is gone. */
function getWin(): BrowserWindow | null {
  return win;
}

/** Pushes to the main window's renderer; a no-op when the window is gone. */
function sendToWin(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// --- Window size/position persistence ---
// The window was fixed at 1100x820 every launch. Save bounds to config.json
// (`windowBounds`) and restore them, clamped to a visible display so a
// disconnected monitor can't reopen the window off-screen.
let _boundsSaveTimer: any = null;
function persistWindowBounds() {
  clearTimeout(_boundsSaveTimer);
  _boundsSaveTimer = setTimeout(saveWindowBoundsNow, 400);
}
function saveWindowBoundsNow() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    const cfg = readConfig();
    cfg.windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: win.isMaximized() };
    writeConfig(cfg);
  } catch {
    /* best-effort */
  }
}
function savedWindowBounds() {
  const b = readConfig().windowBounds;
  if (!b || !Number.isFinite(b.width) || !Number.isFinite(b.height) || b.width < 400 || b.height < 300) return null;
  try {
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
    // Off-screen (e.g. monitor unplugged) → keep the size, drop x/y so the OS centers it.
    if (!onScreen || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
      return { width: b.width, height: b.height, isMaximized: !!b.isMaximized };
    }
  } catch {
    /* screen module unavailable before ready — fall through to use as-is */
  }
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized: !!b.isMaximized };
}

// electron-vite's dev server (HMR + React Fast Refresh for the renderer). Set
// automatically by `electron-vite dev`; absent under `electron-vite build` (and
// under Claude's own build→relaunch verification loop, which never runs
// `electron-vite dev` — see docs/build.md). null in prod, where the renderer
// is served from app:// instead (#7).
//
// The value is an environment variable and this window's preload hands out
// destructive IPC, so it goes through dev-server-guard rather than straight into
// loadURL: a packaged build ignores it outright, and in dev only an http: loopback
// address survives. Everything the guard rejects loads the bundled renderer (#381).
// `devServer.rejected` is reported by index.ts — see this module's header.
const devServer = resolveDevServerUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
const DEV_SERVER_URL = devServer.url;
// Derived from the guard's OUTPUT, never from the raw environment variable, so
// a rejected value cannot widen what the navigation guard accepts, nor what the
// dev-only CSP is pinned to (#381). null in prod, which makes both a no-op there.
const DEV_ORIGIN = DEV_SERVER_URL ? new URL(DEV_SERVER_URL).origin : null;

// Navigation lockdown for every web-contents the app creates. Without it, a file
// (e.g. a local .html) dropped onto a window would make the top frame navigate to
// file://…, which inherits the same preload and could call destructive IPC
// (clear-all / import-complete / …). We:
//   - deny will-navigate to anything other than our own renderer
//     (app://bundle/index.html) or a raster image on the asset:// viewer scheme.
//     The initial loadURL does NOT fire will-navigate, so this never blocks
//     startup — a reload of the image window is what actually passes through here.
//   - deny window.open / target=_blank entirely; external links are funneled
//     through the open-external IPC (shell.openExternal), which this leaves intact.
function installNavigationGuards() {
  const isAllowedNavigation = (rawUrl) => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return false;
    }
    // The standalone image window lives on the app-controlled asset:// scheme —
    // but only for the raster formats it is meant to show (#215). A blanket
    // asset: pass would let anything that can steer a top-level navigation put a
    // scripted SVG on the library's own origin; the same allow-list gates
    // open-image-window, so both ways in agree on what may become a document.
    if (u.protocol === 'asset:') {
      try {
        return isViewerImageName(path.basename(decodeURIComponent(u.pathname)));
      } catch {
        return false;
      }
    }
    // Dev only: allow navigations within the Vite dev server — its HMR client does
    // a full location.reload() on non-Fast-Refreshable edits, which would otherwise
    // be blocked here. DEV_ORIGIN is null in prod, so this is a no-op there.
    if (DEV_ORIGIN && u.origin === DEV_ORIGIN) return true;
    // Our own renderer — its ENTRY document only, query/hash ignored. The
    // scheme is not waved through wholesale: app://bundle/anything-else would
    // be a second document on the origin that carries the preload bridge,
    // which is the same blanket-pass mistake ADR 0012 records for asset://.
    if (u.protocol === 'app:') return isAppRendererUrl(u);
    return false;
  };
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });
    // Deny all renderer-initiated new windows/tabs. External navigation is meant
    // to go through the open-external IPC, not a popup that inherits our preload.
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

// --- Window ---
function createWindow(show = true) {
  // Resolve the theme from config up front so the first paint (and the window's
  // backdrop) match it — no flash, and SMOKE captures reflect it. We pass the
  // PREF (auto/light/dark) to the page as a ?theme= query that theme.js reads
  // synchronously during <head>; 'auto' is resolved there via prefers-color-scheme
  // (which follows nativeTheme). For the backdrop we resolve 'auto' here too.
  const cfgTheme = readConfig().theme;
  const theme = ['auto', 'light', 'dark'].includes(cfgTheme) ? cfgTheme : 'auto';
  const dark = theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
  const smoke = process.env.HOLOGRAM_SMOKE === '1';
  const sb = smoke ? null : savedWindowBounds();
  win = new BrowserWindow({
    width: (sb && sb.width) || 1100,
    height: (sb && sb.height) || 820,
    ...(sb && Number.isFinite(sb.x) ? { x: sb.x, y: sb.y } : {}),
    minWidth: 720,
    minHeight: 480,
    show,
    backgroundColor: dark ? '#0c0e12' : '#f6f7f9',
    title: 'Hologram',
    icon: APP_ICON,
    paintWhenInitiallyHidden: true,
    // No titleBarOverlay: the min/max/close buttons are app-drawn in the tab bar. The OS
    // overlay draws its strip on the browser process' own compositor, so its color could
    // never be synchronized with a web-layer change (a modal scrim) — it could only be
    // approximated per frame, which showed as a flicker. App-drawn buttons live in the same
    // frame as the scrim, so the whole class of mismatch is gone. The cost is the Windows 11
    // Snap Layouts flyout, which only appears for a real caption button (the OS asks the
    // window "is this point the maximize button?" and only the native overlay can say yes);
    // Discord/Figma/Spotify/Obsidian all sit on this side of the trade. Snap itself still
    // works everywhere else: Win+arrow, drag-to-edge, Win+Z.
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  // The app-drawn maximize button mirrors the real window state, which also changes without
  // the button (snap, double-click on the drag strip, Win+arrow, the taskbar), so push every
  // change rather than have the renderer poll.
  const sendMaximized = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('window-maximized-changed', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  if (!smoke) {
    if (sb && sb.isMaximized) win.maximize();
    // Remember size/position across launches (debounced on resize/move; flushed on close).
    win.on('resize', persistWindowBounds);
    win.on('move', persistWindowBounds);
    win.on('maximize', persistWindowBounds);
    win.on('unmaximize', persistWindowBounds);
    win.on('close', saveWindowBoundsNow);
  }
  // Pass smoke=1 so the renderer disables the offscreen render optimizations
  // (content-visibility / lazy images) that leave the hidden capture window blank.
  if (DEV_SERVER_URL) {
    // Dev: load the renderer from electron-vite's Vite dev server (HMR + Fast Refresh).
    // Built through URL rather than string concatenation so the query lands in the
    // query slot whatever shape the (already validated) dev URL has.
    const devUrl = new URL(DEV_SERVER_URL);
    devUrl.search = new URLSearchParams({ theme, ...(smoke ? { smoke: '1' } : {}) }).toString();
    win.loadURL(devUrl.href);
  } else {
    win.loadURL(appIndexUrl({ theme, ...(smoke ? { smoke: '1' } : {}) }));
  }
  return win;
}

// Move a window to the bottom of the z-order without activating it. Only used by
// the HOLOGRAM_START_INACTIVE verify path below, so koffi is a devDependency and
// the require is deliberately lazy: a packaged build never reaches this line, and
// if it somehow does, the window just stays where it is instead of the app dying.
// HWND is passed as uintptr_t rather than void* — getNativeWindowHandle() returns
// a Buffer HOLDING the handle, and a void* parameter would pass the address of
// that buffer instead of the handle itself.
function sendWindowToBack(w: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  try {
    const koffi = nodeRequire('koffi');
    const user32 = koffi.load('user32.dll');
    const SetWindowPos = user32.func('__stdcall', 'SetWindowPos', 'bool', ['uintptr_t', 'uintptr_t', 'int', 'int', 'int', 'int', 'uint']);
    const hwnd = w.getNativeWindowHandle().readBigUInt64LE(0);
    const ok = SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    if (!ok) log.warn('SetWindowPos(HWND_BOTTOM) returned false');
  } catch (err) {
    log.warn('could not send window to back', { error: (err as Error).message });
  }
}

export { APP_ICON, DEV_ORIGIN, DEV_SERVER_URL, devServer, createWindow, getWin, sendToWin, installNavigationGuards, sendWindowToBack };
