import { useSyncExternalStore } from 'react';
import type { LightboxItem, LightboxState } from './Lightbox.tsx';
import { Lightbox } from './Lightbox.tsx';

// React-owned image lightbox / gallery overlay (#lightbox) — lives under the single App
// root now. viewer.js still resolves which images make up a post's gallery
// (buildGalleryItems) and calls open(items, start); this island owns the open/index state,
// prev/next, the counter, the slide-in animation, video teardown, and the Esc / Arrow /
// backdrop close paths. open/close/step store into module state + notify; LightboxHost
// (portaled into #lightbox by App.tsx) subscribes. #lightbox itself is the portal TARGET
// (viewer-owned), so its show/multi classes (the CSS keys on them) are toggled
// imperatively here, not in JSX.

let LABELS: Record<string, string> = {};
let state: LightboxState = { items: [], index: 0, open: false };
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
const getSnapshot = () => state;
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

function open(items: LightboxItem[], start?: number) {
  if (!Array.isArray(items) || !items.length) return;
  const index = Math.max(0, Math.min(start || 0, items.length - 1));
  state = { items, index, open: true };
  paint();
}

function step(d: number) {
  if (!state.open || state.items.length < 2) return;
  const n = state.items.length;
  state = { items: state.items, index: (state.index + d + n) % n, open: true };
  paint();
}

function close() {
  if (!state.open) return;
  state = { items: [], index: 0, open: false };
  paint();
}

function setLabels(l: Record<string, string> | null | undefined) {
  LABELS = l || {};
}

window.corpusLightbox = { open, close, isOpen: () => state.open, setLabels };

// viewer.js may have pushed its nav-button labels before this module evaluated — apply the
// stashed labels now (defensive; the bridge is assigned before viewer.js runs).
if (window.__corpusLbLabels) setLabels(window.__corpusLbLabels);

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

export function LightboxHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Lightbox state={s} labels={LABELS} onPrev={() => step(-1)} onNext={() => step(1)} />;
}
