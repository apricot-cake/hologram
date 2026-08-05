'use strict';

// The app's windows (#32 St1: single-window → 1 process / N windows): their icon,
// their persisted bounds, the navigation lockdown every web-contents gets, and the
// creation itself — index.ts's `// --- Window size/position persistence ---`, the
// navigation-guard block and `// --- Window ---` sections, moved out whole.
//
// This module OWNS the window collection. It has to: createWindow adds to it, and
// an importer cannot assign to an imported binding. Everything else reads it
// through getWin() / getWindows() / sendToWin(), which is what index.ts's ctx
// already handed the IPC handlers — so the window(s) stopped being a file-scoped
// variable the whole main process could touch and became one module's state.
//
// getWin() keeps meaning "the PRIMARY window" (the first one created this run) —
// every single-window-shaped concept that survives #32 (bounds persistence, tabs.json,
// the SMOKE/SANDBOX harnesses, which always run with exactly one window) reads it.
// A handler that has to act on WHICHEVER window called it (window-control, a file
// dialog's parent) reads BrowserWindow.fromWebContents(event.sender) at its own call
// site instead — see ipc-config.ts / ipc-transfer.ts / ipc-backup.ts / ipc-watch-import.ts.
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
import { SMOKE_WINDOW } from './smoke-window-size.ts';
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

// How long an operation that swaps the library out from under the windows
// (#176's switchLibrary, #233's generation rollback) waits before reloading
// them. The reload itself is deliberate — a partially re-synced organize-layer
// store is exactly the class of bug it avoids — but issuing it inside the
// handler tears the CALLING frame down before that call's own reply reaches it:
// the renderer's `await` then never settles (Electron gives it neither a value
// nor a rejection), so the toast reporting the outcome is lost and anything the
// caller does next is cut off mid-flight. This delay is the window in which the
// caller gets its answer. Long enough for that toast to be read, too.
const RELOAD_AFTER_LIBRARY_SWAP_MS = 2000;

// Every live BrowserWindow this process owns, insertion order (the primary window
// — the first one created this run — is always windows[0]). A Set would lose that
// order on nothing in particular; an array is simplest and this collection is never
// more than a handful of entries.
const windows: BrowserWindow[] = [];

/** The primary window (the first one created this run), or null before/after it. */
function getWin(): BrowserWindow | null {
  return windows[0] || null;
}

/** Every live window, oldest first. */
function getWindows(): BrowserWindow[] {
  return windows.filter((w) => !w.isDestroyed());
}

/** Pushes to EVERY window's renderer (#32 St1: single-window's sendToWin, broadcast). */
function sendToWin(channel: string, ...args: unknown[]) {
  for (const w of getWindows()) w.webContents.send(channel, ...args);
}

/**
 * Pushes to every window EXCEPT the one `exceptWebContentsId` names (#32 St2: an
 * organize-layer change is relayed to every OTHER window, not echoed back to the one
 * that just wrote it — that window's own store is already current, and re-applying
 * its own write as an external change would be, at best, a wasted round trip and at
 * worst a reset of in-progress local UI state the write itself did not touch).
 */
function sendToOtherWins(exceptWebContentsId: number, channel: string, ...args: unknown[]) {
  for (const w of getWindows()) {
    if (w.webContents.id === exceptWebContentsId) continue;
    w.webContents.send(channel, ...args);
  }
}

// --- Window size/position persistence ---
// The PRIMARY window only (#32 St1 design: "新窓の bounds は +24px カスケード" — a
// secondary window is positioned FROM the primary's bounds, not persisted itself;
// there is one windowBounds key in config.json, same as before #32). Save bounds to
// config.json (`windowBounds`) and restore them, clamped to a visible display so a
// disconnected monitor can't reopen the window off-screen.
let _boundsSaveTimer: any = null;
function persistWindowBounds(win: BrowserWindow) {
  clearTimeout(_boundsSaveTimer);
  _boundsSaveTimer = setTimeout(() => saveWindowBoundsNow(win), 400);
}
function saveWindowBoundsNow(win: BrowserWindow) {
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

// Navigation lockdown for every web-contents the app creates (every window, #32
// St1 — this listens on 'web-contents-created', which fires for each new
// BrowserWindow the same way it always fired for the one). Without it, a file
// (e.g. a local .html) dropped onto a window would make the top frame navigate to
// file://…, which inherits the same preload and could call destructive IPC
// (clear-all / import-complete / …). We:
//   - deny will-navigate to anything other than our own renderer
//     (app://bundle/index.html) or a raster image on the asset:// viewer scheme.
//     The initial loadURL does NOT fire will-navigate, so this never blocks
//     startup — a reload of the image window is what actually passes through here.
//     ADR 0012 (#215): asset:// may become a top-level document for raster formats
//     ONLY — isViewerImageName is the one predicate every entry point that can turn
//     a library file into a document (this guard's asset: branch, and
//     ipc-window.ts's open-image-window) shares, so a new window never grows a
//     second, looser allow-list of its own.
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
// show — same meaning as before #32 (create hidden, then show without activating —
//   SMOKE/HOLOGRAM_START_MINIMIZED/HOLOGRAM_START_INACTIVE, all single-window paths).
// opts.secondary — #32 St1: a window opened from Ctrl+Shift+N, the second-launch
//   entry point, or the "open a new window" menu action, as opposed to the app's own
//   first window this run (index.ts's boot call, always the primary). A secondary
//   window:
//     - is cascaded +24px from the LAST window's bounds instead of reading/writing
//       the single `windowBounds` config key (there is one persisted position, the
//       primary's — see the size/position persistence comment above).
//     - never persists its own bounds (same reason).
//     - is otherwise an identical window: same preload, same nav guards (installed
//       once, app-wide, above), same renderer bundle. What makes it "secondary" is
//       state the RENDERER reads back off its own boot query (`secondary=1`, the
//       same channel `theme` already travels through) — ipc-config.ts's tabs guard
//       reads the window's identity from the main-process side instead (its
//       webContents.id against the primary's), so the renderer-side flag is
//       advisory only and never a security boundary.
// Resolve the theme from config up front so a window's first paint (and its
// backdrop) match it — no flash, and SMOKE captures reflect it. Shared by
// createWindow and lib-pin-window.ts's createPinWindow (#79): both pass the
// PREF (auto/light/dark) to their page as a ?theme= query that theme.js reads
// synchronously during <head>; 'auto' is resolved there via prefers-color-scheme
// (which follows nativeTheme). For the BrowserWindow backdrop, 'auto' is
// resolved here too (isDarkTheme), before the page has painted anything.
function resolveTheme(): 'auto' | 'light' | 'dark' {
  const cfgTheme = readConfig().theme;
  return ['auto', 'light', 'dark'].includes(cfgTheme) ? cfgTheme : 'auto';
}
function isDarkTheme(theme: 'auto' | 'light' | 'dark'): boolean {
  return theme === 'dark' || (theme === 'auto' && nativeTheme.shouldUseDarkColors);
}

function createWindow(show = true, opts?: { secondary?: boolean }) {
  const secondary = !!(opts && opts.secondary);
  const theme = resolveTheme();
  const dark = isDarkTheme(theme);
  const smoke = process.env.HOLOGRAM_SMOKE === '1';
  // A secondary window never reads the persisted primary bounds — it cascades off
  // whichever window opened it instead (below), so `sb` here is primary-only.
  const sb = smoke || secondary ? null : savedWindowBounds();
  const opener = secondary ? windows[windows.length - 1] : null;
  let cascadeBounds: { x: number; y: number } | null = null;
  if (opener && !opener.isDestroyed()) {
    try {
      const ob = opener.getBounds();
      // Clamp onto the opener's own display so a long chain of Ctrl+Shift+N never
      // walks a window off-screen — cascade within that display, then wrap.
      const display = screen.getDisplayMatching(ob);
      const area = display.workArea;
      const cascaded = { x: ob.x + 24, y: ob.y + 24 };
      cascadeBounds = {
        x: cascaded.x + 1100 <= area.x + area.width ? cascaded.x : area.x + 24,
        y: cascaded.y + 820 <= area.y + area.height ? cascaded.y : area.y + 24,
      };
    } catch {
      /* primary display APIs unavailable this early — fall back to OS placement */
    }
  }
  const win = new BrowserWindow({
    // A harness run gets a wide window rather than the ordinary default — see
    // smoke-window-size.ts for why the size is part of the test contract.
    width: (sb && sb.width) || (smoke ? SMOKE_WINDOW.width : 1100),
    height: (sb && sb.height) || (smoke ? SMOKE_WINDOW.height : 820),
    ...(sb && Number.isFinite(sb.x) ? { x: sb.x, y: sb.y } : {}),
    ...(cascadeBounds ? cascadeBounds : {}),
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
  windows.push(win);
  // A harness window is sized AFTER creation, not by the constructor above: Electron clamps
  // the constructor's size to the display's work area, and CI runners are 1024x768 — the
  // requested width silently arrives narrow, which is the layout none of the harness cases
  // are written against (measured on CI: 1440 asked, 1024 given). setContentSize is not
  // clamped that way, which is the same route e2e/lib/harness.ts already takes.
  if (smoke) win.setContentSize(SMOKE_WINDOW.width, SMOKE_WINDOW.height);
  win.on('closed', () => {
    const i = windows.indexOf(win);
    if (i >= 0) windows.splice(i, 1);
  });
  win.removeMenu();
  // The app-drawn maximize button mirrors the real window state, which also changes without
  // the button (snap, double-click on the drag strip, Win+arrow, the taskbar), so push every
  // change rather than have the renderer poll. Closes over THIS window (not the shared
  // primary binding — #32 St1: every window pushes its own maximize state to itself only).
  const sendMaximized = () => {
    if (win.isDestroyed()) return;
    win.webContents.send('window-maximized-changed', win.isMaximized());
  };
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  if (!smoke && !secondary) {
    if (sb && sb.isMaximized) win.maximize();
    // Remember size/position across launches (debounced on resize/move; flushed on close).
    // Primary only — see the size/position persistence comment above.
    win.on('resize', () => persistWindowBounds(win));
    win.on('move', () => persistWindowBounds(win));
    win.on('maximize', () => persistWindowBounds(win));
    win.on('unmaximize', () => persistWindowBounds(win));
    win.on('close', () => saveWindowBoundsNow(win));
  }
  // Pass smoke=1 so the renderer disables the offscreen render optimizations
  // (content-visibility / lazy images) that leave the hidden capture window blank.
  // secondary=1 (#32 St1) is read by the renderer the same way theme/smoke are
  // (a boot-time query param — services/window-role.ts reads it); the tabs.json
  // guard itself is enforced main-side (ipc-config.ts), not by this flag.
  const query = { theme, ...(smoke ? { smoke: '1' } : {}), ...(secondary ? { secondary: '1' } : {}) };
  if (DEV_SERVER_URL) {
    // Dev: load the renderer from electron-vite's Vite dev server (HMR + Fast Refresh).
    // Built through URL rather than string concatenation so the query lands in the
    // query slot whatever shape the (already validated) dev URL has.
    const devUrl = new URL(DEV_SERVER_URL);
    devUrl.search = new URLSearchParams(query).toString();
    win.loadURL(devUrl.href);
  } else {
    win.loadURL(appIndexUrl(query));
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

export { APP_ICON, DEV_ORIGIN, DEV_SERVER_URL, RELOAD_AFTER_LIBRARY_SWAP_MS, devServer, createWindow, getWin, getWindows, installNavigationGuards, isDarkTheme, resolveTheme, sendToOtherWins, sendToWin, sendWindowToBack };
