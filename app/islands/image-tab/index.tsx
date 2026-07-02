import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ImageTab } from './ImageTab.tsx';
import type { ImageTabModel } from './ImageTab.tsx';

// React-owned image-tab detail view (#imageTabView). viewer.js owns the tab
// object (type:'image'), resolves its records into gallery items and calls
// render(model); this island owns zoom/pan (react-zoom-pan-pinch), prev/next
// painting, and the ←/→ keys while an image tab is the active view.

let root: Root | null = null;
let model: ImageTabModel | null = null;

function ensureRoot() {
  if (root) return root;
  const el = document.getElementById('imageTabView');
  if (!el) return null;
  root = createRoot(el);
  return root;
}

function render(m: ImageTabModel | null | undefined) {
  model = m || null;
  const r = ensureRoot();
  if (r) r.render(model ? <ImageTab model={model} /> : null);
}

window.corpusImageTab = { render };

// Script order is viewer.js → islands: replay a model pushed before we loaded.
if (window.__corpusImageTabModel !== undefined) render(window.__corpusImageTabModel);

// ←/→ step through the group's images while an image tab is the active view.
// Yields to typing, overlays and the lightbox (mirrors the viewer's guards).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!model || !model.onIndexChange || model.items.length < 2) return;
  if (!document.body.classList.contains('image-tab-active')) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (window.corpusLightbox && window.corpusLightbox.isOpen()) return;
  if (window.corpusSettings && window.corpusSettings.isOpen()) return;
  if (document.querySelector('.confirm-overlay.show')) return;
  const n = model.items.length;
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  model.onIndexChange((Math.max(0, Math.min(model.idx, n - 1)) + d + n) % n);
});
