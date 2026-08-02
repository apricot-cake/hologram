// Compare-view state (#82) — 2-4 selected posts shown side by side, each with its
// own independent zoom/pan. Same "pure store, React just subscribes" shape as
// lightbox.ts/panels.ts: nothing here touches the DOM, opening the overlay is one
// state write plus a notify. Kept separate from hologramStore for the same reason
// as menu.ts's context-menu model — this is view-local UI state, not application
// state that belongs in the serializable store.
//
// The caller (orchestrator.ts) resolves each selected post GROUP down to a single
// representative image (buildGroupGalleryItems(g)[0]) before calling open() — this
// module only ever holds flat, already-resolved items. It never re-derives anything
// from the library itself, so a post being deleted/edited mid-compare cannot leave
// this module holding something inconsistent; the overlay just keeps showing the
// last frame it was handed (same "hold the last item" rule the lightbox uses across
// its own close animation).

export interface CompareItem {
  src: string;
  alt: string;
  video: boolean;
}
export interface CompareState {
  items: CompareItem[];
  open: boolean;
}

// v1 grid layout is 2-4 panes (#82's accepted design: 2 = side by side, 3-4 = a
// 2x2 grid with the 4th cell left empty for 3). Below 2 there is nothing to
// compare; above 4 the trigger (orchestrator.ts) doesn't even offer the menu row,
// but the cap stays here too so this module can never be handed more than the
// layout it owns can show.
const MIN_ITEMS = 2;
const MAX_ITEMS = 4;

let state: CompareState = { items: [], open: false };
const subs = new Set<() => void>();

function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

export function open(items: CompareItem[] | null | undefined) {
  if (!items || items.length < MIN_ITEMS) return;
  state = { items: items.slice(0, MAX_ITEMS), open: true };
  notify();
}

export function close() {
  if (!state.open) return;
  state = { items: [], open: false };
  notify();
}

export function isOpen(): boolean {
  return state.open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function getSnapshot(): CompareState {
  return state;
}
