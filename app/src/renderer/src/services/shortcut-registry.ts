// The single source of truth for the app's rebindable global keyboard shortcuts (#246).
//
// BACKGROUND: before this module, each app-wide shortcut had its key baked in as a literal
// comparison at the top of its own handler (undo-builder.ts's `e.key.toLowerCase() === 'z'`,
// …) — there was no single place that knew "what keys does this app
// use", so the settings page #246 wants (a list + reassignment) could only be built by reading
// the key back OUT of every handler, which is exactly the double-bookkeeping #185 already showed
// the cost of. This module inverts that: a command's key lives HERE (default + optional
// override), and the owning handler asks this module "is this event bound to me right now"
// instead of comparing a literal. The guard chain and the action themselves are UNCHANGED —
// only the leading key-comparison line moved (per #246's design comment: "判定ロジック自体の
// 書き換えは伴わない").
//
// NOT the command palette's candidate registry (services/command-registry.ts, #28) — that one
// supplies the palette's ROWS (any candidate: settings / tabs / tags / posters / folders) and
// owns the palette's open/closed state. This one only tracks "which physical key combo runs
// which command", for the settings page's list + reassignment UI. #28's palette rows read a
// shortcut's current combo as their hint text (services/command-builder.ts), the same way this
// module is read by anyone else that needs to show a key.
//
// REJECTED: folding canExecute + perform into one callback with a flag argument (Obsidian's
// plugin-command shape) — see #246's rejected-design comment 2. This app has no third-party
// commands to accept through an API boundary, so keeping "is this runnable right now" and "run
// it" as two separate functions is more direct, and it's what lets dispatch() (below) decide
// not to preventDefault a key it isn't actually going to act on.
import { hologramIpc } from './ipc.ts';
import { t } from '../_shared/i18n.ts';

export interface ShortcutEntry {
  id: string;
  /**
   * i18n KEY for the settings list, not a resolved string — every module registering a
   * shortcut does so at its own module-top-level (so tryRun() has something to answer the
   * very first keydown with), which runs well before initI18n() resolves (root.tsx gates
   * MOUNTING on it, not module evaluation). Resolving eagerly would freeze the title as
   * whatever t() falls back to (the raw key) forever — list()/findConflict() below resolve
   * it lazily instead, by which point the settings page (or a live conflict check) is
   * always running long after boot has finished.
   */
  titleKey: string;
  /** Canonical combo string, e.g. "Ctrl+Z", "Ctrl+Shift+F", "P", "Alt+ArrowLeft". */
  defaultCombo: string;
  /**
   * True for the handful of commands whose ORIGINAL guard never looked at e.shiftKey at all
   * (select-all / copy / search-focus / the two content-size steps / new-tab /
   * close-tab) — holding Shift alongside them was always allowed through, generally because
   * Shift only changes the glyph a key produces or is needed on some layout to type it
   * (Numpad+ vs Shift+=), not because Shift means something different for that command. Combos
   * are still stored/compared with Shift stripped for these ids (both defaultCombo above and any
   * override) so pressing the key with or without Shift is the same combo. Everything else
   * treats Shift as a real, load-bearing part of the chord (undo Ctrl+Z vs redo Ctrl+Shift+Z;
   * plain Ctrl+B is the sidebar's own key, Ctrl+Shift+B is this app's).
   */
  ignoreShift?: boolean;
  /** The rest of the original guard chain (input focus, open overlays, "is there a UI to act on"). */
  canExecute(e: KeyboardEvent): boolean;
  /** The original action body. */
  perform(e: KeyboardEvent): void;
}

export interface ShortcutRow {
  id: string;
  title: string;
  defaultCombo: string;
  /** The default, unless overridden. */
  currentCombo: string;
  isCustom: boolean;
}

const entries = new Map<string, ShortcutEntry>();
let overrides: Record<string, string> = {};
const subs = new Set<() => void>();

function notify(): void {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** Registers one command. Returns an unregister (same convention as command-registry.ts's registerProvider). */
export function registerShortcut(entry: ShortcutEntry): () => void {
  entries.set(entry.id, entry);
  return () => {
    if (entries.get(entry.id) === entry) entries.delete(entry.id);
  };
}

/** For tests: drops every registration and override (never called from product code). */
export function resetShortcuts(): void {
  entries.clear();
  overrides = {};
}

/**
 * True while `e`'s target is a text field (or contentEditable) — the one guard every global
 * shortcut in this app starts with (a shortcut must never eat a key someone is actually typing).
 * Was duplicated verbatim at the top of every handleShortcutXKey; centralized here as this
 * module absorbs the rest of what those handlers had in common (#246).
 */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
}

// --- Combo helpers -----------------------------------------------------------------
// Fixed modifier order (Ctrl, Shift, Alt, then the key) so the same chord always produces the
// same string — comparison is plain string equality, never a per-field check.
const ARROW_LABELS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** e.key, canonicalized: letters case-folded (Caps Lock must not change a chord's identity), the
 * numpad/shifted-plus pair collapsed onto '=' (both mean "the size-up key" — see grid-density-builder.ts),
 * space spelled out for readability. Everything else (Tab, ArrowLeft, …) is already canonical. */
export function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  if (key === '+') return '=';
  return key.length === 1 ? key.toLowerCase() : key;
}

function stripShift(combo: string): string {
  return combo.replace('Shift+', '');
}

export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

/** US-layout display label (#246 design: key notation is always shown US-layout, matching Obsidian — see the Issue's design rationale). */
export function comboLabel(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop() as string;
  const keyLabel = ARROW_LABELS[key] || (key.length === 1 ? key.toUpperCase() : key);
  return [...parts, keyLabel].join('+');
}

function ownCombo(entry: ShortcutEntry): string {
  return overrides[entry.id] ?? entry.defaultCombo;
}

/** Does `combo` (as actually pressed, Shift included) currently belong to `entry`? */
function comboBelongsTo(entry: ShortcutEntry, combo: string): boolean {
  return entry.ignoreShift ? stripShift(combo) === ownCombo(entry) : combo === ownCombo(entry);
}

// --- Settings-page reads/writes -----------------------------------------------------
export function list(): ShortcutRow[] {
  return [...entries.values()].map((e) => ({
    id: e.id,
    title: t(e.titleKey),
    defaultCombo: e.defaultCombo,
    currentCombo: ownCombo(e),
    isCustom: e.id in overrides,
  }));
}

/** The chord currently bound to `id` (its override, or its default). Null if `id` isn't registered. */
export function currentCombo(id: string): string | null {
  const e = entries.get(id);
  return e ? ownCombo(e) : null;
}

/** The OTHER command already sitting on `combo`, if any (own id excluded). Shift-insensitive ids are checked the same way dispatch checks them, so a would-be override can't quietly collide with one of them either. */
export function findConflict(combo: string, excludeId?: string): { id: string; title: string } | null {
  for (const e of entries.values()) {
    if (e.id === excludeId) continue;
    if (comboBelongsTo(e, combo)) return { id: e.id, title: t(e.titleKey) };
  }
  return null;
}

export type SetComboResult = { ok: true } | { ok: false; conflict: { id: string; title: string } };

/** Assigns `combo` (as captured from a real keydown, via comboFromEvent) to `id`. Refuses — and
 * reports who has it — if another command already answers to that chord (#246 acceptance:
 * "衝突先のコマンド名とともに警告が出る"). Persists via the normal setPref round trip. */
export function setCustomCombo(id: string, combo: string): SetComboResult {
  const entry = entries.get(id);
  if (!entry) return { ok: false, conflict: { id: '', title: '' } };
  const stored = entry.ignoreShift ? stripShift(combo) : combo;
  const conflict = findConflict(stored, id);
  if (conflict) return { ok: false, conflict };
  overrides = { ...overrides, [id]: stored };
  persist();
  notify();
  return { ok: true };
}

export function resetToDefault(id: string): void {
  if (!(id in overrides)) return;
  const next = { ...overrides };
  delete next[id];
  overrides = next;
  persist();
  notify();
}

function persist(): void {
  try {
    hologramIpc.setPref('shortcutOverrides', overrides);
  } catch {
    /* ignore */
  }
}

/** Reconciles with config.json once at boot — same shape as panels.ts's load(),
 * minus the localStorage tier: unlike those, nothing needs an answer before React's first paint
 * (a rebind only matters the next time a key is actually pressed). */
export async function load(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs ? prefs.shortcutOverrides : null;
    if (saved && typeof saved === 'object') {
      overrides = { ...saved };
      notify();
    }
  } catch {
    /* ignore */
  }
}

/**
 * The dispatch primitive every owning module's handleShortcutXKey calls for each id it used to
 * hardcode a key for. Returns true the instant `e` is claimed by `id` (whether or not it actually
 * ran — canExecute()===false still claims it, so a caller checking several ids in sequence
 * doesn't fall through to a different id on the SAME physical key, matching the original
 * single-key-per-function shape). Returns false when `e` isn't this id's chord at all, so the
 * caller moves on to try its next id (see undo-builder.ts's undo/redo pair).
 */
export function tryRun(id: string, e: KeyboardEvent): boolean {
  const entry = entries.get(id);
  if (!entry) return false;
  if (!comboBelongsTo(entry, comboFromEvent(e))) return false;
  // A registered command whose depended-on UI isn't there right now (e.g. Ctrl+0 with no
  // zoomable slide mounted) resolves to false and does nothing further — no throw, no
  // preventDefault (#246 acceptance criterion) — the key falls through to whatever the browser/OS
  // would otherwise do with it, same as the original guard chain returning early.
  if (entry.canExecute(e)) {
    e.preventDefault();
    entry.perform(e);
  }
  return true;
}
