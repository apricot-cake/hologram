// Inspector panel open/closed state (#243) — the panel is opened and closed by the user,
// and the choice survives a restart.
//
// Why this holds the STATE and not just the pref (sidebar-pref.ts only persists, and lets
// AppShell own the state): the inspector is closed from two sides. React drives the shell
// toggle and the panel's own ×, but inspector-builder.ts — plain renderer code, no React —
// also needs to close it. A module-level store both can reach keeps that from becoming a
// cross-boundary DOM poke at #postDetail.hidden, which is what the old code did.
//
// Persistence mirrors theme-api.ts / sidebar-pref.ts: config.json is the durable home
// (setPref over IPC) and localStorage is a synchronous cache, because AppShell needs an
// answer during React's FIRST render — an IPC round trip could only answer a tick later,
// painting an open panel and snapping it shut right after boot.
//
// NOTE: opening is a user action only. Selecting a card fills the panel's CONTENT
// (inspector.ts) but never re-opens a panel the user closed — the same courtesy Eagle /
// Lightroom / VS Code extend to a dismissed panel.
import { hologramIpc } from './ipc.ts';

const KEY = 'hologram-inspector-open';
const DEFAULT_OPEN = true;

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

let open = readCache() ?? DEFAULT_OPEN;
// Set by the first explicit toggle. load() resolves a tick after boot, and a user who has
// already reached for the panel by then must not have their choice snapped back by the
// reconcile — the same race AppShell's `toggled` ref keeps off the sidebar.
let chosen = false;
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

export function isOpen(): boolean {
  return open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// Every explicit open/close goes through here, so the pref and the subscribers can never
// drift. Idempotent: re-setting the current value is a no-op (no echo through React).
export function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  chosen = true;
  writeCache(next);
  try {
    hologramIpc.setPref('inspectorOpen', next);
  } catch {
    /* ignore */
  }
  notify();
}

export function toggle(): void {
  setOpen(!open);
}

// Reconcile the cache with config.json once at boot: config.json is the durable home, so
// it outranks the cached guess the first render was painted from and an out-of-app edit
// wins. Silent when the pref is unreadable, or null — null means the user has never
// toggled the panel, not "closed", so the cached guess (or DEFAULT_OPEN) stands.
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.inspectorOpen : null;
    if (chosen || typeof saved !== 'boolean' || saved === open) return;
    open = saved;
    writeCache(saved);
    notify();
  } catch {
    /* ignore */
  }
}
