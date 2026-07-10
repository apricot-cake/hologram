// Thin wrappers over the existing preload bridge (window.corpus.*) and the theme
// runtime (renderer/theme-api.ts). main.js / preload.js stay untouched — the island
// talks to the exact same IPC the vanilla settings did.

import { get as themeGet, set as themeSet } from '../../renderer/theme-api.ts';

const bridge = (): CorpusPreload => window.corpus || ({} as CorpusPreload);

export const getPrefs = () => (bridge().getPrefs ? bridge().getPrefs() : Promise.resolve({}));
export const setPref = (key: string, value: unknown) => (bridge().setPref ? bridge().setPref(key, value) : Promise.resolve());
export const getAppInfo = () => (bridge().getAppInfo ? bridge().getAppInfo() : Promise.resolve(null));

// Theme runtime lives in renderer/theme-api.ts (applies [data-theme], persists via
// setPref, caches to localStorage, follows the OS). We read/drive it through that module
// so the whole app stays in sync.
export const theme = {
  get: themeGet,
  set: (v: string) => {
    themeSet(v);
  },
};

// Tile overlay also drives the (vanilla) post grid, so flipping it must reach
// viewer.js to update the grid class immediately. viewer.js exposes the
// apply-and-persist bridge; fall back to a plain setPref if it isn't present.
export const setTileOverlay = (v: boolean) => {
  if (window.corpusViewer && window.corpusViewer.setTileOverlay) window.corpusViewer.setTileOverlay(v);
  else setPref('tileOverlay', v);
};
