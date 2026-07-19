// Single-image quick-view (peek) overlay (#lightbox) state — V18 §4: extracted out
// of islands/lightbox/index.tsx (the "true island-pinned globals" the execution map
// flagged, alongside settings.ts) so orchestrator.ts and the *-builder.ts modules
// can import it directly instead of reading a global bridge. A real ES module,
// imported by islands/lightbox/index.tsx (LightboxHost renders whatever this holds)
// and by orchestrator.ts / the builders that open it or guard on isOpen().
// #lightbox itself is the portal TARGET (orchestrator-owned static container), so
// its show class is toggled imperatively here, not in JSX.
//
// #143 reduced this to a SINGLE item: the lightbox is a quick-view peek now (full
// gallery paging moved to the image view), so it holds one item — the caller passes
// the thumbnail (the first gallery item) and there is no prev/next stepping.

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

function node() {
  return document.getElementById('lightbox');
}

function paint() {
  const el = node();
  if (el) el.classList.toggle('show', state.open);
  notify();
}

export function open(item: LightboxItem | null | undefined) {
  if (!item || !item.src) return;
  state = { item, open: true };
  paint();
}

export function close() {
  if (!state.open) return;
  state = { item: null, open: false };
  paint();
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

// Backdrop (and the image itself) closes; video controls don't. Attached once on the
// static #lightbox element (the portal target, not React-owned content).
(() => {
  const el = node();
  if (el) {
    el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('video')) return;
      close();
    });
  }
})();

// Esc closes the peek (Arrow keys no longer step — single item, #143). Document-level,
// gated on the open state.
document.addEventListener('keydown', (e) => {
  if (!state.open) return;
  if (e.key === 'Escape') close();
});
