// Privacy mode (#88) — one key (P, no modifier) blurs every image-bearing surface the
// library draws, so the app is safe to leave on screen while sharing/streaming/showing it
// to someone standing behind you. #178 already fetches a platform's OWN sensitive/CW
// signal per post; this is deliberately not that — v1 is a single blanket switch with no
// per-post scoping (#88 decision comment), same as X/Discord's own "show sensitive media"
// toggle before either ships per-post automation.
//
// STATE SHAPE: same two-tier pref as panels.ts (localStorage cache for a synchronous first
// read + config.json as the durable home via hologramIpc.setPref/getPrefs) — this module is
// the fourth copy of that shape (sidebar-pref / inspector-panel / panels), so it follows the
// same contract rather than inventing one: module-level state initialized synchronously from
// the cache at import time, `chosen` keeps an early user toggle from being clobbered by the
// config.json reconcile landing a tick later.
//
// HOW THE BLUR ACTUALLY REACHES THE DOM: a `data-privacy-mode` attribute set directly on
// <html> (document.documentElement), read by a `:root[data-privacy-mode='true'] [data-slot=…]`
// block in globals.css — the same mechanism theme.ts uses for `data-theme`, scaled down.
// Unlike theme.ts this does NOT get its own pre-paint <head> boot script: a theme flash is
// a full-page color flip on every load, so it needs a guarantee that runs before the
// stylesheet is even parsed, but privacy mode only risks one frame of an unblurred grid, and
// only for a user who quit the app WHILE it was on — setting the attribute here, at normal
// module-eval time (which still runs before this module's first paint, since ES module
// evaluation is synchronous and happens before the event loop yields to render), is a
// proportionate amount of machinery for that much smaller a window. Do not thread this
// through React state/props instead: this flag has to reach a card thumbnail, an inspector
// preview, the image-tab stage AND the lightbox at once, and none of those share a common
// React ancestor cheap to re-render on every toggle — the same reasoning that already put
// data-theme on <html> rather than a className prop drilled through every themed component.
import { hologramIpc } from './ipc.ts';

const KEY = 'hologram-privacy-mode';
const ATTR = 'data-privacy-mode';
const DEFAULT_ENABLED = false;

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeCache(v: boolean): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* ignore */
  }
}

// document is undefined under Vitest's node environment (this module is imported by unit
// tests for its pure state/guard logic, same as panels.ts) — guard rather than require jsdom.
function applyDom(v: boolean): void {
  try {
    if (v) document.documentElement.setAttribute(ATTR, 'true');
    else document.documentElement.removeAttribute(ATTR);
  } catch {
    /* ignore — no document (test environment) */
  }
}

let enabled = readCache() ?? DEFAULT_ENABLED;
applyDom(enabled);
// Same race guard as panels.ts's `chosen`: load() resolves a tick after boot, and a user who
// has already reached for the key by then must not have their choice snapped back.
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

export function isEnabled(): boolean {
  return enabled;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// Every change goes through here, so the DOM attribute, the pref and the subscribers can
// never drift. Idempotent: re-setting the current value is a no-op (no echo through React).
export function setEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  chosen = true;
  applyDom(next);
  writeCache(next);
  try {
    hologramIpc.setPref('privacyMode', next);
  } catch {
    /* ignore */
  }
  notify();
}

export function toggle(): void {
  setEnabled(!enabled);
}

// Reconcile the cache with config.json once at boot — config.json is the durable home, so
// it outranks the cached guess the first render was painted from. Silent when the pref is
// unreadable, or null (never toggled, not "off").
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.privacyMode : null;
    if (chosen || typeof saved !== 'boolean' || saved === enabled) return;
    enabled = saved;
    applyDom(saved);
    writeCache(saved);
    notify();
  } catch {
    /* ignore */
  }
}

// P — no modifier. Deliberately the loosest guard of any global shortcut in this app: every
// other one (Ctrl+K, Ctrl+Shift+B, `/`, …) also bails while a dialog/lightbox/palette/settings
// surface is open, because there is nothing of THEIRS to act on behind an overlay. This one is
// the opposite case — the whole point is a reflex key that reaches through whatever is on
// screen (the lightbox's enlarged image included: Lightbox.tsx's <img>/<video> carry
// data-slot="lightbox-media", the same selector this feature blurs everywhere else), because
// the moment you need it most is exactly the moment something is already open. The ONLY thing
// it must not do is eat a `p` a user is actually typing, so the sole guard is the same
// input/textarea/contentEditable check every other shortcut here starts with — a real dialog
// input (the command palette's search field, the "DELETE ALL" confirm keyword) is itself an
// INPUT, so it is already covered without a paletteIsOpen()/confirmGet() check.
export function handleShortcutPrivacyKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if ((e.key || '').toLowerCase() !== 'p') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  e.preventDefault();
  toggle();
}
