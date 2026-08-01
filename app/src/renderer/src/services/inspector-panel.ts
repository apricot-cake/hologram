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
// Lightroom / VS Code extend to a dismissed panel. A command that only makes sense
// INSIDE the panel ("Edit tags", the image view's inspector toggle) is not a selection and
// does open it — see setOpen's callers.
//
// This module also owns "is the panel on screen right now" (isVisible), which is not the
// same question as isOpen: the stored preference says the panel SHOULD be there, while
// the width mode, #245's bulk hide and — at narrow widths — whether anything is selected
// all get a say in whether it actually is. That formula used to live in AppShell alone,
// and the renderer modules outside React answered the same question by reading
// #postDetail.hidden off the DOM (P2⑦ / #153: no cross-boundary DOM sniffing). Both now
// read this one copy.
import { hologramIpc } from './ipc.ts';
import { isWide, subscribe as layoutSubscribe } from './layout-mode.ts';
import { isHidden as panelsAreHidden, subscribe as panelsSubscribe } from './panels.ts';
import { get as storeGet, subscribe as storeSubscribe } from './store.ts';

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

// === On screen right now ===

// The three extra inputs, and why each gets a say:
// - panels.ts's bulk hide (#245) masks both side panels without touching what they think.
// - At narrow widths the panel is an overlay riding on the selection (#259/#244): with
//   nothing inspected it would be a floating hole in the view, so it stays away. Docked
//   at wide widths it shows its placeholder instead.
export function isVisible(): boolean {
  return !panelsAreHidden() && open && (isWide() || storeGet('inspectedKey') != null);
}

// Fan-out subscription for React: any of the four inputs can flip the answer, so a
// consumer of isVisible() has to hear from all of them. Non-React callers only ask
// isVisible() at the moment they act and need none of this.
export function subscribeVisible(cb: () => void): () => void {
  const offs = [subscribe(cb), panelsSubscribe(cb), layoutSubscribe(cb), storeSubscribe('inspectedKey', cb)];
  return () => {
    for (const off of offs) off();
  };
}

// The panel's own element, handed over by the shell's ref rather than looked up by id
// (P2⑦ / #153 ④): the outside-click dismissal has to ask "did this press land inside the
// panel", which is a hit test no store can answer, and #postDetail was the last id
// contract holding the panel together. Same ref-registration shape as grid-nav.ts.
let el: HTMLElement | null = null;

export function registerPanelEl(node: HTMLElement | null): void {
  el = node;
}

export function panelContains(target: EventTarget | null): boolean {
  return !!el && target instanceof Node && el.contains(target);
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
