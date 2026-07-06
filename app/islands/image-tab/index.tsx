import { useSyncExternalStore } from 'react';
import { ImageTab } from './ImageTab.tsx';
import type { ImageTabModel } from './ImageTab.tsx';

// React-owned image-tab detail view (#imageTabView). viewer.js owns the tab
// object (type:'image'), resolves its records into gallery items and calls
// render(model); this island owns zoom/pan (react-zoom-pan-pinch), prev/next
// painting, and the ←/→ keys while an image tab is the active view. It lives under
// the single App root now: render() stores the model + notifies, and ImageTabHost
// (portaled into #imageTabView by App.tsx) subscribes. The bridge is assigned when
// this module loads (before viewer.js runs), so the old stash-replay is gone.

let model: ImageTabModel | null = null;
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
const getSnapshot = () => model;

function render(m: ImageTabModel | null | undefined) {
  model = m || null;
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

window.corpusImageTab = { render };

export function ImageTabHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  return m ? <ImageTab model={m} /> : null;
}

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
