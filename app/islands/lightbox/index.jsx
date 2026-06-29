import { createRoot } from 'react-dom/client';
import { Lightbox } from './Lightbox.jsx';

// React-owned image lightbox / gallery overlay (#lightbox). viewer.js still
// resolves which images make up a post's gallery (buildGalleryItems) and calls
// open(items, start); this island owns the open/index state, prev/next, the
// counter, the slide-in animation, video teardown, and the Esc / Arrow / backdrop
// close paths. The #lightbox element itself is the React root, so its show/multi
// classes (which the CSS keys on) are toggled imperatively here rather than in JSX.

let root = null;
let LABELS = {};
let state = { items: [], index: 0, open: false };

function node() { return document.getElementById('lightbox'); }

function ensureRoot() {
  if (root) return root;
  const el = node();
  if (!el) return null;
  root = createRoot(el);
  // Backdrop (and the image itself) closes; nav buttons + video controls don't.
  el.addEventListener('click', (e) => {
    if (e.target.closest('.lb-nav') || e.target.closest('video')) return;
    close();
  });
  return root;
}

function paint() {
  const el = node();
  if (el) {
    el.classList.toggle('show', state.open);
    el.classList.toggle('multi', state.open && state.items.length > 1);
  }
  const r = ensureRoot();
  if (r) r.render(<Lightbox state={state} labels={LABELS} onPrev={() => step(-1)} onNext={() => step(1)} />);
}

function open(items, start) {
  if (!Array.isArray(items) || !items.length) return;
  const index = Math.max(0, Math.min(start || 0, items.length - 1));
  state = { items, index, open: true };
  paint();
}

function step(d) {
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

function setLabels(l) { LABELS = l || {}; }

window.corpusLightbox = { open, close, isOpen: () => state.open, setLabels };

// In dev this island loads (as a module) after viewer.js, which may have pushed
// its nav-button labels before we existed — apply the stashed labels now.
if (window.__corpusLbLabels) setLabels(window.__corpusLbLabels);

// Esc / Arrow keys are document-level, gated on the open state — mirrors the old
// viewer.js keydown handler this island replaces.
document.addEventListener('keydown', (e) => {
  if (!state.open) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
});
