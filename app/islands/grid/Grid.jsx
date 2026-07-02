// Virtualized post grid — the post-specific cell on the shared VirtualGridHost
// (_shared/VirtualGrid.jsx owns the masonic + scroller plumbing; it was extracted
// 1:1 from here when the poster/collection grids joined the same foundation).
// The island owns cell rendering + windowing; viewer.js owns the data
// (model.items = viewGroups), the container classes, and every delegated
// #postGrid handler. Cells emit the long-standing .post-card DOM contract
// (shared PostCard component), so delegation + CSS work unchanged.
import { useLayoutEffect, useRef } from 'react';
import { PostCard } from '../_shared/PostCard.jsx';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.jsx';

// One grid cell. modelOf() re-reads live viewer state (selection / clip /
// inspected) on every render, so a bridge repaint() refreshes visible cells.
function Cell({ index, data }) {
  const model = useGridModel();
  const ref = useRef(null);
  // Cells (re)mount as the window scrolls; whether .text overflows is only
  // knowable from layout, so re-check on every commit (the old path did this
  // once per render pass via rAF over the whole grid).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const t of el.querySelectorAll('.text')) {
      if (!t.classList.contains('expanded')) t.classList.toggle('truncated', t.scrollHeight > t.clientHeight);
    }
  });
  // Report the natural aspect of images that had NO reserved height (card view:
  // no shotW/H, no cached aspect) so viewer.js can cache it. The cell's own
  // size change is picked up by the resize observer — no explicit re-flow.
  const onImgLoad = model.onAspect
    ? (e) => {
        const img = e.currentTarget;
        if (img.style.aspectRatio && img.style.aspectRatio !== 'auto') return; // height was reserved — nothing to learn
        const cap = img.dataset.cap;
        if (cap && img.naturalWidth && img.naturalHeight) model.onAspect(cap, img.naturalWidth + '/' + img.naturalHeight);
      }
    : undefined;
  return <PostCard m={model.modelOf(data, index)} L={model.labels} cellRef={ref} onImgLoad={onImgLoad} />;
}

export function GridHost({ model }) {
  return <VirtualGridHost model={model} cell={Cell} />;
}
