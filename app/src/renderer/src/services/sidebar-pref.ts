// Sidebar expanded/collapsed state (#149) — the choice survives a restart.
//
// Two tiers, the same split theme-api.ts uses: config.json is the durable home (setPref
// over IPC) and localStorage is a synchronous cache. The cache is what makes this work
// at all — AppShell needs the state during React's FIRST render (a useState initializer),
// and an IPC round trip can only answer a tick later, which would paint an expanded
// sidebar and snap it to the icon rail right after boot. config.json stays authoritative:
// load() reconciles the cache with it once, so an out-of-app edit still wins.
//
// Only an explicit user toggle (SidebarTrigger / Ctrl+B) reaches persist() — AppShell's
// width discipline collapses the column below 1024px WITHOUT writing here, so resizing
// the window never clobbers what the user chose. Separate key from #30's sidebarWidth:
// "collapsed" and "how wide when expanded" are independent answers.
import { hologramIpc } from './ipc.ts';

const KEY = 'hologram-sidebar-open';

// A fresh profile (nothing in the cache yet) now starts on the labeled rail, not the
// expanded 256px column (#678). This only decides what someone who has NEVER touched
// the toggle sees first — an existing user's saved choice (cachedOpen()) is untouched.
export const DEFAULT_OPEN = false;

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeCache(open: boolean): void {
  try {
    localStorage.setItem(KEY, String(open));
  } catch {
    /* ignore */
  }
}

// The saved choice, or null if the user has never toggled the sidebar (the caller owns
// the default — see AppShell). Synchronous by design: first-render safe.
export function cachedOpen(): boolean | null {
  return readCache();
}

export function persistOpen(open: boolean): void {
  writeCache(open);
  try {
    hologramIpc.setPref('sidebarOpen', open);
  } catch {
    /* ignore */
  }
}

// Reconcile the cache with config.json once at boot. Resolves to the durable value, or
// null when it is unset/unreadable — in which case the cached guess already in use stands.
export async function loadOpen(): Promise<boolean | null> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const open = prefs ? prefs.sidebarOpen : null;
    if (typeof open !== 'boolean') return null;
    writeCache(open);
    return open;
  } catch {
    return null;
  }
}
