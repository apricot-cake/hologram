import { useEffect, useLayoutEffect, useState } from 'react';
import { hologramImageTabSource } from '../services/image-tab.ts';
import { get as confirmGet } from '../services/confirm.ts';
import { isOpen as lightboxIsOpen } from '../services/lightbox.ts';
import { isOpen as settingsIsOpen } from '../services/settings.ts';
import { ImageTab } from './ImageTab.tsx';

// React-owned image-tab detail view (#imageTabView). viewer.js owns the tab object
// (type:'image') and its recs/idx; this component PULLS its model from services/image-tab.ts
// instead of being pushed one — this was converted off the old render(model) push
// (viewer called it from ~8 call sites), the same shape as the two grid sources.
// This component still owns zoom/pan (react-zoom-pan-pinch), prev/next painting, and the
// ←/→ keys while an image tab is the active view.

// Not useSyncExternalStore: get() recomputes a fresh object on every notify (like the grid
// sources), which would trip React's "cached snapshot" tearing check — a plain subscribe→
// setState effect (same shape as GridMount's sync()) sidesteps that.
export function ImageTabHost() {
  const [model, setModel] = useState(() => hologramImageTabSource.get());
  useEffect(() => {
    const sync = () => setModel(hologramImageTabSource.get());
    const unsub = hologramImageTabSource.subscribe(sync);
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
  const model = hologramImageTabSource.get();
  if (!model || !model.onIndexChange || model.items.length < 2) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (confirmGet()) return;
  const n = model.items.length;
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  model.onIndexChange((Math.max(0, Math.min(model.idx, n - 1)) + d + n) % n);
});
