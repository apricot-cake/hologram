// Bulk panel visibility (#245) — Ctrl+Shift+B hides the sidebar AND the inspector at
// once, and a second press brings back exactly the pair that was showing. The toolbar and
// the query chip row stay: they are how you operate the grid, so hiding them would trade a
// wider view for a view you cannot drive (#245 design comment).
//
// "Shift widens what the key applies to" is Lightroom Classic's pairing (Tab = the side
// panels, Shift+Tab = all of them). The key itself is not borrowed — see #245 for why Tab,
// backtick and Ctrl+\ were all rejected — only the shape of the pair.
//
// WHAT THIS STATE IS: a MASK, not a mutation of the two panels' own state. While it is on,
// sidebar-pref.ts's saved choice and inspector-panel.ts's state are left exactly as they
// were and the shell simply paints both panels closed. That IS the restore mechanism, and
// it is why there is no snapshot object anywhere: the pair to come back to is still sitting
// in the two panels' own state. It also lets the mask itself persist to config.json — a
// snapshot held only in memory could not survive a restart, so a persisted mask paired
// with one would come back unable to say what it was covering.
//
// THE INVARIANT THAT MAKES IT WORK: nothing writes a panel's own state while the mask is
// on. Every explicit individual action — Ctrl+B, the sidebar trigger, the inspector's
// toggle — calls reveal() FIRST and then applies itself, so the mask drops and the user's
// action lands on a panel they can see. Hiding two panels and then silently rearranging
// them behind the mask is the one behavior #245 ruled out ("隠れたまま内部状態だけ変わる
// 挙動は作らない"), and it is ruled out here rather than at each call site by giving them
// nothing else to call.
//
// Since #244 declined to give the inspector a shortcut of its own, Ctrl+Shift+B is also
// the only keyboard route to the inspector.
//
// Persistence is the two-tier shape sidebar-pref.ts / inspector-panel.ts already use:
// config.json is the durable home (setPref over IPC) and localStorage is a synchronous
// cache, because the shell needs an answer during React's FIRST render — an IPC round trip
// could only answer a tick later, painting both panels and snapping them away right after
// boot. The state lives in this module rather than in a component for the same reason
// inspector-panel.ts's does: the keyboard handler is registered from App.tsx and the
// command palette entry is built in services/, neither of which can reach into AppShell.
import { get as confirmGet } from './confirm.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { hologramIpc } from './ipc.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';

const KEY = 'hologram-panels-hidden';
const DEFAULT_HIDDEN = false;

function readCache(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? null : v === 'true';
  } catch {
    return null;
  }
}

function writeCache(hidden: boolean): void {
  try {
    localStorage.setItem(KEY, String(hidden));
  } catch {
    /* ignore */
  }
}

let hidden = readCache() ?? DEFAULT_HIDDEN;
// Set by the first explicit toggle. load() resolves a tick after boot, and a user who has
// already reached for the key by then must not have their choice snapped back by the
// reconcile — the same race inspector-panel.ts's `chosen` keeps off the panel.
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

export function isHidden(): boolean {
  return hidden;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// Every change goes through here, so the pref and the subscribers can never drift.
// Idempotent: re-setting the current value is a no-op (no echo through React).
export function setHidden(next: boolean): void {
  if (hidden === next) return;
  hidden = next;
  chosen = true;
  writeCache(next);
  try {
    hologramIpc.setPref('panelsHidden', next);
  } catch {
    /* ignore */
  }
  notify();
}

export function toggle(): void {
  setHidden(!hidden);
}

/**
 * Drop the mask because the user reached for one panel specifically. Call this BEFORE
 * applying that action — the panel's own state is only ever written while it is visible,
 * which is what keeps the pair this mask covers restorable (see the file header).
 * A no-op when nothing is masked, so call sites never have to ask.
 */
export function reveal(): void {
  setHidden(false);
}

// Reconcile the cache with config.json once at boot: config.json is the durable home, so it
// outranks the cached guess the first render was painted from and an out-of-app edit wins.
// Silent when the pref is unreadable, or null — null means the user has never used the key,
// not "shown", so the cached guess (or DEFAULT_HIDDEN) stands.
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.panelsHidden : null;
    if (chosen || typeof saved !== 'boolean' || saved === hidden) return;
    hidden = saved;
    writeCache(saved);
    notify();
  } catch {
    /* ignore */
  }
}

// Ctrl/Cmd+Shift+B. Registration lives in the GlobalShortcuts component (app/App.tsx),
// alongside the other document-level shortcuts; the guard + action stay here, next to the
// state they read. Guard shape is the house convention (selection-builder.ts's Ctrl+A):
// leave the key alone while typing, and while a modal owns the screen — there is nothing
// to widen behind a dialog.
//
// Ctrl+B without Shift belongs to the sidebar alone and is handled by SidebarProvider's own
// listener (components/ui/sidebar.tsx), which turns Shift away for this one.
export function handleShortcutPanelsKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
  if ((e.key || '').toLowerCase() !== 'b') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (confirmGet() || lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (paletteIsOpen()) return;
  const folderModal = typeof document === 'undefined' ? null : document.getElementById('ivFolderModal');
  if (folderModal && !folderModal.hidden) return;
  e.preventDefault();
  toggle();
}
