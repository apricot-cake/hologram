// Practice mode's pure state (#103): a full-screen, timer-advanced queue of
// still images drawn from the current filter results — croquis/gesture-drawing
// practice, or a plain slideshow. Same shape as triage.ts/lightbox.ts: a real ES
// module holding module-scope state, no DOM, no IPC.
//
// The queue is a SNAPSHOT taken when practice opens (services/practice-builder.ts's
// startPractice), not a live query — the same reasoning triage.ts's own doc comment
// gives: re-deriving "what matches the filter right now" on every posts-data change
// would reshuffle the deck under the artist's eye mid-session. Advancing past the
// end wraps back to the front (setIdx mods by length) — a practice session loops
// rather than ending, since there is no "done" state to reach the way triage's
// queue empties by removal.

export type PracticeDurationMs = 30000 | 60000 | 120000 | 300000;

export interface PracticeItem {
  src: string;
  alt?: string;
}

export interface PracticeState {
  open: boolean;
  items: PracticeItem[];
  idx: number;
  /** Per-item timer length. Persists across opens (a re-opened session keeps the
   * last-picked pace) but resets to DEFAULT_DURATION on a fresh module load — no
   * pref round-trip for this v1, same altitude as the issue's own scope. */
  duration: PracticeDurationMs;
  /** ms left on the CURRENT item. Ticks down while running; a duration change or a
   * step (setIdx/next/prev) resets it to the full duration for the new item. */
  remaining: number;
  /** false while paused — tick() no-ops so the countdown holds still. */
  running: boolean;
}

const DEFAULT_DURATION: PracticeDurationMs = 60000;

let state: PracticeState = { open: false, items: [], idx: 0, duration: DEFAULT_DURATION, remaining: DEFAULT_DURATION, running: true };
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

export function get(): PracticeState {
  return state;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function isOpen(): boolean {
  return state.open;
}

/** The item on screen, or null while the queue is empty. */
export function current(): PracticeItem | null {
  return state.items[state.idx] || null;
}

function clampIdx(i: number, len: number): number {
  if (len <= 0) return 0;
  return ((i % len) + len) % len;
}

export function openWith(items: PracticeItem[]): void {
  state = { ...state, open: true, items, idx: 0, remaining: state.duration, running: true };
  notify();
}

export function close(): void {
  if (!state.open) return;
  // Drop the snapshot on close, same as triage.ts's own close(): the NEXT open
  // rebuilds fresh from whatever the filter shows then, rather than a stale array
  // sitting around between sessions.
  state = { ...state, open: false, items: [], idx: 0, remaining: state.duration, running: true };
  notify();
}

/** Change the per-item pace. Resets the CURRENT item's countdown to the new
 * length too — a mid-session pace change should feel like the picture just
 * came up, not carry over a remaining time computed for the old duration. */
export function setDuration(ms: PracticeDurationMs): void {
  state = { ...state, duration: ms, remaining: ms };
  notify();
}

export function setIdx(idx: number): void {
  state = { ...state, idx: clampIdx(idx, state.items.length), remaining: state.duration };
  notify();
}

export function next(): void {
  setIdx(state.idx + 1);
}

export function prev(): void {
  setIdx(state.idx - 1);
}

export function togglePause(): void {
  if (!state.open) return;
  state = { ...state, running: !state.running };
  notify();
}

/** Advance the countdown by deltaMs; steps to the next item at zero. Called from
 * the Host's interval loop for as long as practice is open — a no-op while
 * closed/paused/empty, so a stray tick from the loop's own teardown race costs
 * nothing (mirrors triage-builder.ts's handleTriageKey guarding on isOpen()
 * first rather than the mount effect racing to unregister in time). */
export function tick(deltaMs: number): void {
  if (!state.open || !state.running || !state.items.length) return;
  const remaining = state.remaining - deltaMs;
  if (remaining <= 0) next();
  else {
    state = { ...state, remaining };
    notify();
  }
}
