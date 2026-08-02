'use strict';

// Config / preferences / tabs IPC handlers, extracted from main.js (mechanical move —
// logic unchanged). These touch config.json (get-config/get-prefs/set-pref), the
// tabs.json org file (get/set-tabs), the window title-bar overlay, and static build
// info (app-info). Core helpers arrive via ctx; the pref key allow-list lives here
// (used only by these handlers).
//
// get-extension-contact (#71) reads a marker OUTSIDE config.json (native-host/
// paths.cts's extensionContactPath, touched by the bridge — see that module's
// header) rather than going through ctx: it is a plain existence check with no
// dependency on any mutable main-process state, so it imports the path helper
// directly the same way lib-config.ts / lib-thumbnails.ts do.
import { ipcMain, app } from 'electron';
import fs from 'node:fs';
import { extensionContactPath } from './native-host.ts';
import type { HologramConfig, IpcContext } from './ipc-context.ts';
import type { AppInfo, AppPrefs, ConfigSummary, ExtensionContactStatus, LibraryStatus, OkResult, TabsState } from './ipc-payloads.ts';

// --- Preferences (language / layoutMode / skipDeleteConfirm / …) ---
// Post sort is NOT here: it lives in the per-tab state (tabs-builder.ts's
// snapshotState), which is where it is persisted and restored from. The old
// 'sortBy' pref was the losing half of that double storage — the two raced on
// load — and the renderer stopped reading it when the tab state took over.
const PREF_KEYS = [
  'language',
  'layoutMode',
  'squareThumbs',
  'showInfo',
  'showAvatar',
  'skipDeleteConfirm',
  'gridSize',
  'listThumb',
  'theme',
  'uiFontFamily',
  'browseMode',
  'posterLayoutMode',
  'posterShowInfo',
  'posterGridSize',
  'sidebarOpen',
  'sidebarWidth',
  'inspectorOpen',
  'inspectorWidth',
  'panelsHidden',
  'privacyMode',
  'triagePinnedTags',
  'webSearchChecked',
  'fediverseHomeHosts',
];

// --- One-off read of the retired 3-value densities (#618 posts / #630 posters) ---
// `viewMode` / `posterViewMode` (card/tile/list) and their per-density size keys are
// no longer written by anyone; these read a config.json left by an older build so the
// app opens on the display the user last chose. Pre-release scaffolding: delete these
// four, and their call sites in get-prefs, before 1.0 (CLAUDE.md "pre-release,
// there is no such thing as 'someone else's library'").
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

function register(ctx: IpcContext) {
  const { readConfig, writeConfig, getSaveFolder, getDbWriter, getWin, getLibraryStatus } = ctx;

  ipcMain.handle('get-config', (): ConfigSummary => {
    const cfg = readConfig();
    return { saveFolder: getSaveFolder(), extensionId: cfg.extensionId || null };
  });

  // #37: the renderer calls this on boot (and again after a retry/repoint) to
  // decide whether to show the normal library or the libraryMissing screen —
  // see empty/LibraryMissingState.tsx. Always a fresh check, not a cached push.
  ipcMain.handle('get-library-status', (): LibraryStatus => getLibraryStatus());

  // #71: whether the bridge has EVER touched its contact marker — see this
  // file's header and paths.cts's extensionContactPath. A fresh existence
  // check every call, same shape as get-library-status above; nothing writes
  // this file from the app side, so there is no cache to invalidate.
  ipcMain.handle('get-extension-contact', (): ExtensionContactStatus => ({ contacted: fs.existsSync(extensionContactPath()) }));

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
      // #658: no legacy density carried an avatar axis — just a plain boolean default.
      showAvatar: typeof cfg.showAvatar === 'boolean' ? cfg.showAvatar : true,
      skipDeleteConfirm: !!cfg.skipDeleteConfirm,
      gridSize: Number.isFinite(cfg.gridSize) ? cfg.gridSize : legacyGridSize(cfg), // grid: column width px
      listThumb: Number.isFinite(cfg.listThumb) ? cfg.listThumb : null, // list: thumbnail width px
      theme: ['auto', 'light', 'dark'].includes(cfg.theme) ? cfg.theme : 'auto', // System / Light / Dark
      uiFontFamily: typeof cfg.uiFontFamily === 'string' ? cfg.uiFontFamily : '', // #137: interface font override; '' = default stack
      browseMode: cfg.browseMode === 'posters' ? 'posters' : 'posts', // library / poster (restored at startup)
      // #630: the poster grid's own two axes. `legacyPoster*` reads the retired
      // 3-value density (card/tile/list) once, the same one-off the post side does.
      posterLayoutMode: ['grid', 'list'].includes(cfg.posterLayoutMode) ? cfg.posterLayoutMode : legacyPosterDensity(cfg) === 'list' ? 'list' : 'grid',
      posterShowInfo: typeof cfg.posterShowInfo === 'boolean' ? cfg.posterShowInfo : legacyPosterDensity(cfg) !== 'tile',
      posterGridSize: Number.isFinite(cfg.posterGridSize) ? cfg.posterGridSize : legacyPosterGridSize(cfg), // poster grid column width px
      sidebarOpen: typeof cfg.sidebarOpen === 'boolean' ? cfg.sidebarOpen : null, // sidebar expanded/collapsed; null = never toggled
      sidebarWidth: Number.isFinite(cfg.sidebarWidth) ? cfg.sidebarWidth : null, // dragged column width px; null = never resized
      inspectorOpen: typeof cfg.inspectorOpen === 'boolean' ? cfg.inspectorOpen : null, // inspector panel shown/hidden; null = never toggled
      inspectorWidth: Number.isFinite(cfg.inspectorWidth) ? cfg.inspectorWidth : null,
      panelsHidden: typeof cfg.panelsHidden === 'boolean' ? cfg.panelsHidden : null, // #245 bulk hide over the two panels above; null = never used
      privacyMode: typeof cfg.privacyMode === 'boolean' ? cfg.privacyMode : null, // #88 one-key blur; null = never toggled
      // #46: up to 9 manually-pinned tags for triage mode's number-key quick tagging.
      triagePinnedTags: Array.isArray(cfg.triagePinnedTags) ? cfg.triagePinnedTags.filter((v: unknown): v is string => typeof v === 'string').slice(0, 9) : [],
      // #207: web-search popover prefs - both null when never set (the popover itself supplies the default checked set / no home instance).
      webSearchChecked: Array.isArray(cfg.webSearchChecked) ? cfg.webSearchChecked.filter((v: unknown): v is string => typeof v === 'string') : null,
      fediverseHomeHosts: cfg.fediverseHomeHosts && typeof cfg.fediverseHomeHosts === 'object' ? { misskey: typeof cfg.fediverseHomeHosts.misskey === 'string' ? cfg.fediverseHomeHosts.misskey : null, mastodon: typeof cfg.fediverseHomeHosts.mastodon === 'string' ? cfg.fediverseHomeHosts.mastodon : null } : null,
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
