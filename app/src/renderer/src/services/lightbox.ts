// Single-image quick-view (peek) state — extracted out of islands/lightbox/index.tsx
// (one of the two "true island-pinned globals", alongside settings.ts) so
// orchestrator.ts and the *-builder.ts modules can import it directly instead of
// reading a global bridge. A real ES module, imported by islands/lightbox/index.tsx
// (QuickViewHost renders whatever this holds) and by orchestrator.ts / the builders
// that open it or guard on isOpen().
//
// #143 reduced this to a SINGLE item: the peek holds one item — the caller passes the
// thumbnail (the first gallery item) and there is no prev/next stepping (full gallery
// paging lives in the image view).
//
// P2⑦ made this a PURE store: the overlay element, its visibility, the backdrop click
// and the Esc key are all React's now (islands/lightbox). Nothing here touches the DOM,
// so opening the peek is one state write plus a notify — no getElementById, no class
// toggle, no module-load-time listeners.

export interface LightboxItem {
  src: string;
  video?: boolean;
  alt?: string;
}
export interface LightboxState {
  item: LightboxItem | null;
  open: boolean;
}

let state: LightboxState = { item: null, open: false };
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

export function open(item: LightboxItem | null | undefined) {
  if (!item || !item.src) return;
  state = { item, open: true };
  notify();
}

export function close() {
  if (!state.open) return;
  state = { item: null, open: false };
  notify();
}

export function isOpen(): boolean {
  return state.open;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function getSnapshot(): LightboxState {
  return state;
}
