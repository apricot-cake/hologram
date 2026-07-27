// Virtualized post grid — the post-specific cell on the shared VirtualGridHost
// (_shared/VirtualGrid.tsx owns the masonic + scroller plumbing; it was extracted
// 1:1 from here when the poster/collection grids joined the same foundation).
// The island owns cell rendering + windowing; viewer.js owns the data
// (model.items = viewGroups), the container classes, and every delegated
// #postGrid handler. Cells emit the long-standing .post-card DOM contract
// (shared PostCard component), so delegation + CSS work unchanged.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { SyntheticEvent } from 'react';
import { PostCard } from '../_shared/PostCard.tsx';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// One grid cell. modelOf() re-reads live viewer state on every
// render, so a bridge repaint() refreshes visible cells. The inspected ring
// and the selection checkmark are NOT part of that closure-read model —
// both are derived straight from hologramStore ('inspectedKey' / 'selectedSet',
// real subscriptions), so opening/closing the inspector or toggling a
// selection re-renders the right cell with no bridge repaint() needed.
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspected = () => (storeGet('inspectedKey') as string | null | undefined) ?? null;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const subSelected = (cb: () => void) => storeSubscribe('selectedSet', cb);
const getSelected = () => (storeGet('selectedSet') as ReadonlySet<string> | undefined) ?? EMPTY_SELECTION;

function Cell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const selectedSet = useSyncExternalStore(subSelected, getSelected);
  const ref = useRef<HTMLDivElement | null>(null);
  // Cells (re)mount as the window scrolls; whether .text overflows is only
  // knowable from layout, so re-check on every commit (the old path did this
  // once per render pass via rAF over the whole grid).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const t of el.querySelectorAll<HTMLElement>('.text')) {
      if (!t.classList.contains('expanded')) t.classList.toggle('truncated', t.scrollHeight > t.clientHeight);
    }
  });
  // Report the natural aspect of images that had NO reserved height (card view:
  // no shotW/H, no cached aspect) so viewer.js can cache it. The cell's own
  // size change is picked up by the resize observer — no explicit re-flow.
  const onImgLoad = model.onAspect
    ? (e: SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        if (img.style.aspectRatio && img.style.aspectRatio !== 'auto') return; // height was reserved — nothing to learn
        const cap = img.dataset.cap;
        if (cap && img.naturalWidth && img.naturalHeight) (model.onAspect as (cap: string, ar: string) => void)(cap, img.naturalWidth + '/' + img.naturalHeight);
      }
    : undefined;
  const m = model.modelOf(data, index);
  m.inspected = inspectedKey != null && !!model.keyOf && model.keyOf(data, index) === inspectedKey;
  m.selected = selectedSet.has(m.postKey);
  return <PostCard m={m} L={model.labels} cellRef={ref} onImgLoad={onImgLoad} />;
}

export function GridHost({ model }: { model: HologramGridModel }) {
  // nav: this is the grid selection moves through, so it publishes its column count
  // and scroll geometry to renderer/grid-nav.ts (the poster grid has no selection).
  return <VirtualGridHost model={model} cell={Cell} nav />;
}
