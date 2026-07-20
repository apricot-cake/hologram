// Sidebar / inspector column widths (#30) — a dragged width survives a restart.
//
// Two tiers, the same split sidebar-pref.ts uses for `sidebarOpen`: config.json is the
// durable home (setPref over IPC) and localStorage is a synchronous cache. The cache is
// what makes this work at all — the width has to be known during React's FIRST render,
// and an IPC round trip can only answer a tick later, which would paint the default
// width and snap to the saved one right after boot. config.json stays authoritative:
// load() reconciles the cache with it once, so an out-of-app edit still wins.
//
// Only a finished gesture (pointerup / a key press / a double-click reset) reaches
// persist(). Nothing during a drag does: setPref lands in config.json through a
// fsync'd atomic write, and calling that per pointermove would stall the drag.
// Separate keys from `sidebarOpen` — "collapsed" and "how wide when expanded" are
// independent answers, and collapsing must not write a width back.
import { hologramIpc } from './ipc.ts';

export type PanelKey = 'sidebarWidth' | 'inspectorWidth';

const CACHE_KEY: Record<PanelKey, string> = {
  sidebarWidth: 'hologram-sidebar-width',
  inspectorWidth: 'hologram-inspector-width',
};

// Absolute limits, in px. Lower bounds keep a panel readable rather than letting it
// shrink into a sliver that has to be dragged back out (the sidebar's own "narrow"
// answer is the icon rail, which the collapse toggle owns). Upper bounds keep the
// content column usable at the window's 720px minWidth — hence the viewport cap in
// clampWidth on top of these, which is what actually bites on a small window.
export const LIMITS: Record<PanelKey, { min: number; max: number }> = {
  sidebarWidth: { min: 200, max: 400 },
  inspectorWidth: { min: 260, max: 560 },
};

// Share of the window a single panel may take. Both panels can be open at once, so
// this is deliberately under half.
const VIEWPORT_CAP = 0.45;

/** Round to whole px and hold inside both the absolute limits and the viewport cap. */
export function clampWidth(key: PanelKey, px: number, viewportW: number): number {
  const { min, max } = LIMITS[key];
  // The cap never pushes below `min`: on a narrow window a floor of "readable" beats a
  // panel squeezed to nothing, and the panel is collapsible anyway.
  const cap = Math.max(min, Math.min(max, Math.round(viewportW * VIEWPORT_CAP)));
  return Math.min(cap, Math.max(min, Math.round(px)));
}

function readCache(key: PanelKey): number | null {
  try {
    const v = localStorage.getItem(CACHE_KEY[key]);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeCache(key: PanelKey, px: number): void {
  try {
    localStorage.setItem(CACHE_KEY[key], String(px));
  } catch {
    /* ignore */
  }
}

// The saved width, or null if the user has never dragged this panel (the caller owns
// the default — it comes from the component's own width token, not a literal here).
// Synchronous by design: first-render safe.
export function cachedWidth(key: PanelKey): number | null {
  return readCache(key);
}

export function persistWidth(key: PanelKey, px: number): void {
  writeCache(key, px);
  try {
    hologramIpc.setPref(key, px);
  } catch {
    /* ignore */
  }
}

// Reconcile the cache with config.json once at boot. Resolves to the durable value, or
// null when it is unset/unreadable — in which case the cached guess already in use stands.
export async function loadWidth(key: PanelKey): Promise<number | null> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const px = prefs ? prefs[key] : null;
    if (typeof px !== 'number' || !Number.isFinite(px)) return null;
    writeCache(key, px);
    return px;
  } catch {
    return null;
  }
}
