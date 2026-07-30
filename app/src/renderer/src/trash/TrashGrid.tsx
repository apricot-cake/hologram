// Virtualized trash grid (#268) — the ゴミ箱 destination's cells, on the same
// foundation as the post grid (_shared/VirtualGrid's GridMount + VirtualGridHost)
// and rendering the same PostCard: a deleted post has to be recognizable as the
// post it was, so the card is the library's card, not a smaller stand-in.
//
// What it deliberately does NOT take from the post grid:
//  - nav / anchor: services/grid-nav.ts and services/zoom-anchor.ts are single
//    registries aimed at the library grid (arrow-key selection, Ctrl+wheel zoom).
//    A second grid registering over them would leave whichever mounted last owning
//    the keyboard.
//  - marquee: the rubber band arms services/selection.ts, which is the library's
//    selection. The trash keeps its own (services/trash-view.ts).
// Background click still clears, because that half needs no shared registry.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { PostCard } from '../_shared/PostCard.tsx';
import { GridMount, useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { hologramTrashGridSource } from '../services/grid.ts';
import { clearSelection, getSnapshot, subscribe } from '../services/trash-view.ts';

const EMPTY: ReadonlySet<string> = new Set();
const getSelected = () => getSnapshot().selected ?? EMPTY;

function Cell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const selected = useSyncExternalStore(subscribe, getSelected);
  const ref = useRef<HTMLDivElement | null>(null);
  // Same commit-time overflow check the post grid's cell does — cells (re)mount as
  // the window scrolls, and whether .text overflows is only knowable from layout.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const t of el.querySelectorAll<HTMLElement>('.text')) {
      if (!t.classList.contains('expanded')) t.classList.toggle('truncated', t.scrollHeight > t.clientHeight);
    }
  });
  const m = model.modelOf(data, index);
  m.selected = selected.has(m.postKey);
  return <PostCard m={m} L={model.labels} cellRef={ref} />;
}

const onBackgroundClick = () => clearSelection();

export function TrashGrid() {
  return <GridMount bridge={hologramTrashGridSource} containerId="trashGrid" hostId="trashGridReact" renderHost={(model) => <VirtualGridHost model={model} cell={Cell} onBackgroundClick={onBackgroundClick} />} />;
}
