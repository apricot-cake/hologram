// Thin wrappers over hologramIpc (renderer/ipc.ts, the P4 IPC→service seam over the
// preload bridge) and the theme runtime (renderer/theme-api.ts). main.mts / preload.cts
// stay untouched — the component talks to the exact same IPC the vanilla settings did,
// just routed through the same seam every other renderer service uses now.

import { get as themeGet, set as themeSet } from '../services/theme-api.ts';
import { hologramIpc } from '../services/ipc.ts';
import { applyTileOverlay } from '../services/grid-density-builder.ts';

export const getPrefs = () => (hologramIpc.getPrefs ? hologramIpc.getPrefs() : Promise.resolve({}));
export const setPref = (key: string, value: unknown) => (hologramIpc.setPref ? hologramIpc.setPref(key, value) : Promise.resolve());
export const getAppInfo = () => (hologramIpc.getAppInfo ? hologramIpc.getAppInfo() : Promise.resolve(null));
export const openExternal = (url: string) => hologramIpc.openExternal(url);

// Theme runtime lives in renderer/theme-api.ts (applies [data-theme], persists via
// setPref, caches to localStorage, follows the OS). We read/drive it through that module
// so the whole app stays in sync.
export const theme = {
  get: themeGet,
  set: (v: string) => {
    themeSet(v);
  },
};

// Tile overlay also drives the post grid, so flipping it must reach
// grid-density-builder.ts to update the grid class immediately. That module
// exposes the apply-and-persist bridge as a live binding (bound at boot from
// viewer.ts); fall back to a plain setPref if it isn't bound yet.
export const setTileOverlay = (v: boolean) => {
  if (applyTileOverlay) applyTileOverlay(v);
  else setPref('tileOverlay', v);
};
