import { useEffect, useLayoutEffect, useState } from 'react';
import { ImageTab } from './ImageTab.tsx';

// React-owned image-tab detail view (#imageTabView). viewer.js owns the tab object
// (type:'image') and its recs/idx; this island PULLS its model from renderer/image-tab.ts
// (window.corpusImageTabSource) instead of being pushed one — P4-B slice⑮ converted this
// off the old render(model) push (viewer called it from ~8 call sites), the same shape as
// the grid sources (⑩/⑫). This island still owns zoom/pan (react-zoom-pan-pinch), prev/next
// painting, and the ←/→ keys while an image tab is the active view.

// Not useSyncExternalStore: get() recomputes a fresh object on every notify (like the grid
// sources), which would trip React's "cached snapshot" tearing check — a plain subscribe→
// setState effect (same shape as GridMount's sync()) sidesteps that.
export function ImageTabHost() {
  const [model, setModel] = useState(() => window.corpusImageTabSource.get());
  useEffect(() => {
    const sync = () => setModel(window.corpusImageTabSource.get());
    const unsub = window.corpusImageTabSource.subscribe(sync);
    sync(); // catch anything that changed before this effect ran
    return unsub;
  }, []);
  // body.image-tab-active ⟺ an image tab is showing. useLayoutEffect = toggled before
  // paint, in the same commit that renders the view → no flash.
  useLayoutEffect(() => {
    document.body.classList.toggle('image-tab-active', !!model);
  }, [model]);
  return model ? <ImageTab model={model} /> : null;
}

// ←/→ step through the group's images while an image tab is the active view.
// Yields to typing, overlays and the lightbox (mirrors the viewer's guards).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!document.body.classList.contains('image-tab-active')) return;
  const model = window.corpusImageTabSource.get();
  if (!model || !model.onIndexChange || model.items.length < 2) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (window.corpusLightbox && window.corpusLightbox.isOpen()) return;
  if (window.corpusSettings && window.corpusSettings.isOpen()) return;
  if (document.querySelector('.confirm-overlay.show')) return;
  const n = model.items.length;
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  model.onIndexChange((Math.max(0, Math.min(model.idx, n - 1)) + d + n) % n);
});
