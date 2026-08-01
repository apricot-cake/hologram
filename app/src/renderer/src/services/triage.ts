// Triage mode's pure state (#46): a full-screen queue of untagged/no-folder posts,
// worked one at a time with single-key actions. Same shape as lightbox.ts/
// settings.ts — a real ES module holding module-scope state, no DOM, no IPC beyond
// the pinned-tag pref (self-contained load/persist, mirroring panels.ts's own pref
// restore rather than routing through orchestrator.ts's boot sequence).
//
// The queue is a SNAPSHOT taken when triage opens (services/triage-builder.ts's
// openTriage), not a live query: re-deriving "which posts still qualify" on every
// posts-data change would reshuffle the list under the user's cursor mid-session
// (the same reason the inspector holds a snapshot rather than a live-bound group,
// #633's doc comment on inspector-builder.ts). Advancing past the end (idx >=
// queue.length) is the "done" state a component renders from, not a separate flag.
import { hologramIpc } from './ipc.ts';

/** What the LAST triage action did, so a single Backspace can take exactly it back.
 * `undo` is the closure undo-builder.ts's pushUndo hands back for a data-changing
 * action (tag/folder) — absent for skip, which touched no data. `previousIndex` is
 * always set: stepping back to it is what "undo" means for all three kinds. */
export interface TriageLastAction {
  kind: 'tag' | 'folder' | 'skip';
  label: string;
  previousIndex: number;
  undo?: () => void;
}

export interface TriageState {
  open: boolean;
  queue: HologramPostGroup[];
  idx: number;
  lastAction: TriageLastAction | null;
  /** Up to 9 manually-pinned tags for the 1-9 quick-tag keys, in slot order (index 0 = key '1'). */
  pinnedTags: string[];
}

let state: TriageState = { open: false, queue: [], idx: 0, lastAction: null, pinnedTags: [] };
const subs = new Set<() => void>();

function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function get(): TriageState {
  return state;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function isOpen(): boolean {
  return state.open;
}

/** The item on screen, or null once the queue is exhausted (idx past the end) or empty. */
export function current(): HologramPostGroup | null {
  return state.queue[state.idx] || null;
}

export function openWith(queue: HologramPostGroup[]): void {
  state = { ...state, open: true, queue, idx: 0, lastAction: null };
  notify();
}

export function close(): void {
  if (!state.open) return;
  state = { ...state, open: false, queue: [], idx: 0, lastAction: null };
  notify();
}

export function setIdx(idx: number): void {
  state = { ...state, idx };
  notify();
}

export function setLastAction(action: TriageLastAction | null): void {
  state = { ...state, lastAction: action };
  notify();
}

// --- Pinned tags (1-9 quick-tag keys) — a self-contained pref, same idiom as
// panels.ts's own load()/config.json round-trip (a leaf module owns its own pref
// rather than orchestrator.ts's bootApp reaching in). Reconciled with config.json
// once, from the triage Host's mount effect: config.json is the durable copy, so an
// out-of-app edit (or a value set before this session started) wins.
export async function loadPinnedTags(): Promise<void> {
  try {
    const prefs = hologramIpc.getPrefs ? await hologramIpc.getPrefs() : null;
    const saved = prefs && Array.isArray(prefs.triagePinnedTags) ? prefs.triagePinnedTags.filter((t): t is string => typeof t === 'string').slice(0, 9) : [];
    state = { ...state, pinnedTags: saved };
    notify();
  } catch {
    /* ignore — pinned tags stay empty, the pin bar just offers empty slots */
  }
}

/** Pin (tag truthy) or clear (tag null/empty) one numbered slot (0-8 = keys 1-9). */
export function setPinnedTag(slot: number, tag: string | null): void {
  if (slot < 0 || slot > 8) return;
  const next = state.pinnedTags.slice();
  while (next.length <= slot) next.push('');
  next[slot] = (tag || '').trim();
  // Trailing empty slots are dropped so the persisted array doesn't grow forever
  // with holes; a hole in the MIDDLE stays (an earlier slot can be cleared without
  // shifting the ones after it — the number IS the key, so slot identity matters).
  while (next.length && !next[next.length - 1]) next.pop();
  state = { ...state, pinnedTags: next };
  notify();
  hologramIpc.setPref('triagePinnedTags', next).catch(() => {
    /* best-effort, same as every other pref write in this app */
  });
}
