import { useEffect, useState } from 'react';
import { hologramImageTabSource } from '../services/image-tab.ts';
import { get as confirmGet } from '../services/confirm.ts';
import { isOpen as lightboxIsOpen } from '../services/lightbox.ts';
import { isOpen as settingsIsOpen } from '../services/settings.ts';
import { ImageTab } from './ImageTab.tsx';

// React-owned image-tab detail view. viewer.js owns the tab object
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
  // The stage's own container. It used to be a static `#imageTabView` div in AppShell that
  // two CSS rules (`#imageTabView{display:none}` + `body.image-tab-active #imageTabView`)
  // switched on, with a third rule hiding the content column — the body class was the
  // wiring between "there is a model" and "the browse chrome is gone". Now the component
  // that HAS the model draws the container, and the shell hides the content column from the
  // same predicate (services/image-tab.ts's isActive) — one React decision, no class to race
  // (P2⑫ / #153 ⑥).
  return model ? (
    <div data-slot="image-tab-view" className="flex min-h-0 min-w-0 flex-1">
      {/* key={model.tabId} (#80): switching straight from one image tab to another (both
          already showing their own image view) never unmounts THIS host — only `model`'s
          identity changes — so without this key React would reuse the same ImageTab
          instance and its overlay toggle state (services/image-overlay.ts) would leak from
          the old tab's picture into the new one's. The key forces a fresh mount, whose
          effect calls image-overlay.ts's reset(). */}
      <ImageTab key={model.tabId} model={model} />
    </div>
  ) : null;
}

// ←/→ step through the group's images while an image tab is the active view.
// Yields to typing, overlays and the lightbox (mirrors the viewer's guards).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
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
