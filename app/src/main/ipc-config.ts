'use strict';

// Config / preferences / tabs IPC handlers, extracted from main.js (mechanical move —
// logic unchanged). These touch config.json (get-config/set-extension-id/get-prefs/
// set-pref), the tabs.json org file (get/set-tabs), the window title-bar overlay, and
// static build info (app-info). Core helpers arrive via ctx; the pref key
// allow-list lives here (used only by these handlers).
import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import type { HologramConfig, IpcContext } from './ipc-context.ts';
import type { AppInfo, AppPrefs, ConfigSummary, ExtensionIdResult, OkResult, TabsState } from './ipc-payloads.ts';

// --- Preferences (language / layoutMode / skipDeleteConfirm / …) ---
// Post sort is NOT here: it lives in the per-tab state (tabs-builder.ts's
// snapshotState), which is where it is persisted and restored from. The old
// 'sortBy' pref was the losing half of that double storage — the two raced on
// load — and the renderer stopped reading it when the tab state took over.
const PREF_KEYS = ['language', 'layoutMode', 'squareThumbs', 'showInfo', 'skipDeleteConfirm', 'gridSize', 'listThumb', 'theme', 'browseMode', 'posterLayoutMode', 'posterShowInfo', 'posterGridSize', 'sidebarOpen', 'sidebarWidth', 'inspectorOpen', 'inspectorWidth', 'panelsHidden'];

// --- One-off read of the retired 3-value densities (#618 posts / #630 posters) ---
// `viewMode` / `posterViewMode` (card/tile/list) and their per-density size keys are
// no longer written by anyone; these read a config.json left by an older build so the
// app opens on the display the user last chose. Pre-release scaffolding: delete these
// four, and their call sites in get-prefs, before 1.0 (CLAUDE.md「リリース前につき
// 『他人のライブラリ』は存在しない」).
const legacyDensity = (cfg: HologramConfig): string => (['card', 'tile', 'list'].includes(cfg.viewMode) ? cfg.viewMode : 'card');
const legacyGridSize = (cfg: HologramConfig): number | null => {
  const px = legacyDensity(cfg) === 'tile' ? cfg.imageTileSize : cfg.cardSize;
  return Number.isFinite(px) ? px : null;
};
const legacyPosterDensity = (cfg: HologramConfig): string => (['card', 'tile', 'list'].includes(cfg.posterViewMode) ? cfg.posterViewMode : 'card');
const legacyPosterGridSize = (cfg: HologramConfig): number | null => {
  const px = legacyPosterDensity(cfg) === 'tile' ? cfg.posterTileSize : cfg.posterCardSize;
  return Number.isFinite(px) ? px : null;
};

// Chrome extension ids are exactly 32 chars of a–p. The id crosses a trust
// boundary (IPC arg → native-messaging manifest allowed_origins), so anything
// else is coerced to '' — same handling as an empty id (see install.js).
const VALID_EXT_ID = /^[a-p]{32}$/;

function register(ctx: IpcContext) {
  const { readConfig, writeConfig, invalidateConfigCache, getSaveFolder, getDbWriter, installer, getWin } = ctx;

  ipcMain.handle('get-config', (): ConfigSummary => {
    const cfg = readConfig();
    return { saveFolder: getSaveFolder(), extensionId: cfg.extensionId || null };
  });

  ipcMain.handle('set-extension-id', (_event, id): ExtensionIdResult => {
    const cfg = readConfig();
    const trimmed = typeof id === 'string' ? id.trim() : '';
    cfg.extensionId = VALID_EXT_ID.test(trimmed) ? trimmed : '';
    writeConfig(cfg);
    try {
      // Update only the manifest's allowed origin; keep the existing launcher.
      if (fs.existsSync(installer.manifestPath())) {
        installer.updateAllowedOrigin(cfg.extensionId);
      } else {
        installer.install({ exe: process.execPath, runAsNode: true, extensionId: cfg.extensionId });
      }
    } catch (err) {
      console.error('Failed to update native host origin:', err);
    } finally {
      // install() persists extensionId into config.json ITSELF (install.cts
      // persistExtensionId) instead of coming back through writeConfig, so the
      // config cache cannot know the file moved. Today it writes the same id we
      // just wrote and the file does not change — drop the cache anyway rather
      // than let that coincidence be what keeps the cache honest. In `finally`
      // because a throw partway through still leaves the file possibly rewritten.
      invalidateConfigCache();
    }
    return { extensionId: cfg.extensionId };
  });

  // Window controls. The min/max/close buttons are drawn by the app (renderer DOM), not by
  // the OS overlay, so the window commands they used to carry natively come over IPC now.
  // See the AppShell WindowControls component for why they are app-drawn.
  ipcMain.handle('window-control', (_e, action): boolean | null => {
    const win = getWin();
    if (!win) return null;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
    return win.isMaximized();
  });

  // The maximize button's glyph follows the real window state, which changes without us
  // (snap, double-click on the drag strip, Win+Up, the taskbar). Push it instead of making
  // the renderer poll.
  ipcMain.handle('window-is-maximized', () => {
    const win = getWin();
    return !!win && win.isMaximized();
  });

  ipcMain.handle('get-tabs', (): TabsState | null => {
    return getSaveFolder() ? getDbWriter().getTabs() : null;
  });
  ipcMain.handle('set-tabs', (_e, data): OkResult => {
    if (!getSaveFolder()) return { ok: false };
    try {
      getDbWriter().setTabs(data);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });

  // Build/version info for the settings "About" panel. app.getVersion() reads the
  // loaded app's package.json (1.1.0), so it is correct in dev and packaged alike.
  ipcMain.handle(
    'app-info',
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
    }),
  );

  ipcMain.handle('get-prefs', (): AppPrefs => {
    const cfg = readConfig();
    return {
      language: cfg.language || 'auto',
      // #618: layout + two independent grid switches. `legacy*` below reads the
      // retired 3-value density (card/tile/list) once, so a config written before
      // this split still opens on the display the user left. Pre-release scaffolding
      // — delete the legacy fallbacks (and this comment) before 1.0.
      layoutMode: ['grid', 'list'].includes(cfg.layoutMode) ? cfg.layoutMode : legacyDensity(cfg) === 'list' ? 'list' : 'grid',
      squareThumbs: typeof cfg.squareThumbs === 'boolean' ? cfg.squareThumbs : legacyDensity(cfg) === 'tile',
      showInfo: typeof cfg.showInfo === 'boolean' ? cfg.showInfo : legacyDensity(cfg) !== 'tile',
      skipDeleteConfirm: !!cfg.skipDeleteConfirm,
      gridSize: Number.isFinite(cfg.gridSize) ? cfg.gridSize : legacyGridSize(cfg), // grid: column width px
      listThumb: Number.isFinite(cfg.listThumb) ? cfg.listThumb : null, // list: thumbnail width px
      theme: ['auto', 'light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto', // システム / ライト / ダーク
      browseMode: cfg.browseMode === 'posters' ? 'posters' : 'posts', // ライブラリ / 投稿者（起動時に復元）
      // #630: the poster grid's own two axes. `legacyPoster*` reads the retired
      // 3-value density (card/tile/list) once, the same one-off the post side does.
      posterLayoutMode: ['grid', 'list'].includes(cfg.posterLayoutMode) ? cfg.posterLayoutMode : legacyPosterDensity(cfg) === 'list' ? 'list' : 'grid',
      posterShowInfo: typeof cfg.posterShowInfo === 'boolean' ? cfg.posterShowInfo : legacyPosterDensity(cfg) !== 'tile',
      posterGridSize: Number.isFinite(cfg.posterGridSize) ? cfg.posterGridSize : legacyPosterGridSize(cfg), // 投稿者グリッドの列幅px
      sidebarOpen: typeof cfg.sidebarOpen === 'boolean' ? cfg.sidebarOpen : null, // sidebar expanded/collapsed; null = never toggled
      sidebarWidth: Number.isFinite(cfg.sidebarWidth) ? cfg.sidebarWidth : null, // dragged column width px; null = never resized
      inspectorOpen: typeof cfg.inspectorOpen === 'boolean' ? cfg.inspectorOpen : null, // inspector panel shown/hidden; null = never toggled
      inspectorWidth: Number.isFinite(cfg.inspectorWidth) ? cfg.inspectorWidth : null,
      panelsHidden: typeof cfg.panelsHidden === 'boolean' ? cfg.panelsHidden : null, // #245 bulk hide over the two panels above; null = never used
    };
  });

  ipcMain.handle('set-pref', (_e, key, value): OkResult => {
    if (!PREF_KEYS.includes(key)) {
      // Refusing silently is how `inspectorOpen` stayed unwritten for months (#391):
      // every renderer caller drops the `{ok:false}`, so a key missing from the
      // allow-list looks exactly like a working pref until someone reads config.json.
      // Logged here rather than at the call sites because this is the one choke point
      // all of them pass through — a new caller is covered without remembering to.
      console.warn(`set-pref refused an unknown key: ${String(key)}`);
      return { ok: false };
    }
    const cfg = readConfig();
    cfg[key] = value;
    writeConfig(cfg);
    return { ok: true };
  });
}

export { register };
