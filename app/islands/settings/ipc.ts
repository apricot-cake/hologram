// Thin wrappers over the existing preload bridge (window.corpus.*) and the theme
// helper (window.corpusTheme). main.js / preload.js stay untouched — the island
// talks to the exact same IPC the vanilla settings did.

const bridge = (): CorpusPreload => window.corpus || ({} as CorpusPreload);

export const getPrefs = () => (bridge().getPrefs ? bridge().getPrefs() : Promise.resolve({}));
export const setPref = (key: string, value: unknown) => (bridge().setPref ? bridge().setPref(key, value) : Promise.resolve());
export const getAppInfo = () => (bridge().getAppInfo ? bridge().getAppInfo() : Promise.resolve(null));

// Theme is owned by theme.js (applies [data-theme], persists via setPref, caches
// to localStorage). We read/drive it through that module so the whole app stays
// in sync. The React select intentionally has no id, so theme.js never grabs it.
export const theme = {
  get: () => (window.corpusTheme ? window.corpusTheme.get() : 'auto'),
  set: (v: string) => {
    if (window.corpusTheme) window.corpusTheme.set(v);
  },
};

// Tile overlay also drives the (vanilla) post grid, so flipping it must reach
// viewer.js to update the grid class immediately. viewer.js exposes the
// apply-and-persist bridge; fall back to a plain setPref if it isn't present.
export const setTileOverlay = (v: boolean) => {
  if (window.corpusViewer && window.corpusViewer.setTileOverlay) window.corpusViewer.setTileOverlay(v);
  else setPref('tileOverlay', v);
};
