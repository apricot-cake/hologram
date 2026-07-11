// Image lightbox / gallery overlay (#lightbox) state — V18 §4: extracted out of
// islands/lightbox/index.tsx (the "true island-pinned globals" the execution map
// flagged, alongside settings.ts) so orchestrator.ts and the *-builder.ts modules
// can import it directly instead of reading a global bridge. A real ES
// module, imported by islands/lightbox/index.tsx (LightboxHost renders whatever
// this holds) and by orchestrator.ts / the builders that open it or guard on
// isOpen(). #lightbox itself is the portal TARGET (orchestrator-owned static
// container), so its show/multi classes are toggled imperatively here, not in JSX.

export interface LightboxItem {
  src: string;
  video?: boolean;
  alt?: string;
}
export interface LightboxState {
  items: LightboxItem[];
  index: number;
  open: boolean;
}

let LABELS: Record<string, string> = {};
let state: LightboxState = { items: [], index: 0, open: false };
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
  if (el) {
    el.classList.toggle('show', state.open);
    el.classList.toggle('multi', state.open && state.items.length > 1);
  }
  notify();
}

export function open(items: LightboxItem[], start?: number) {
  if (!Array.isArray(items) || !items.length) return;
  const index = Math.max(0, Math.min(start || 0, items.length - 1));
  state = { items, index, open: true };
  paint();
}

export function step(d: number) {
  if (!state.open || state.items.length < 2) return;
  const n = state.items.length;
  state = { items: state.items, index: (state.index + d + n) % n, open: true };
  paint();
}

export function close() {
  if (!state.open) return;
  state = { items: [], index: 0, open: false };
  paint();
}

export function isOpen(): boolean {
  return state.open;
}

export function setLabels(l: Record<string, string> | null | undefined) {
  LABELS = l || {};
}

export function getLabels(): Record<string, string> {
  return LABELS;
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function getSnapshot(): LightboxState {
  return state;
}

// Backdrop (and the image itself) closes; nav buttons + video controls don't. Attached
// once on the static #lightbox element (the portal target, not React-owned content).
(() => {
  const el = node();
  if (el) {
    el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.lb-nav') || (e.target as Element).closest('video')) return;
      close();
    });
  }
})();

// Esc / Arrow keys are document-level, gated on the open state.
document.addEventListener('keydown', (e) => {
  if (!state.open) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});
