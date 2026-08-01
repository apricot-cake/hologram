// Virtualized trash grid (#268) — the trash destination's cells, on the same
// foundation as the post grid (_shared/VirtualGrid's GridMount + VirtualGridHost)
// and rendering the same cells: a deleted post has to be recognizable as the
// post it was, so the card is the library's card, not a smaller stand-in — including
// its layout, which follows the same display axes (#618).
//
// What it deliberately does NOT take from the post grid:
//  - nav / anchor: services/grid-nav.ts and services/zoom-anchor.ts are single
//    registries aimed at the library grid (arrow-key selection, Ctrl+wheel zoom).
//    A second grid registering over them would leave whichever mounted last owning
//    the keyboard.
//  - marquee: the rubber band arms services/selection.ts, which is the library's
//    selection. The trash keeps its own (services/trash-view.ts).
//  - most card actions: a trashed post does not drag out (dragging out of a trash
//    means "restore it here" everywhere that teaches the gesture, and the browser's
//    own drag would carry an internal asset:// URL), and its verbs live in the
//    view's action row. Its cardActions carry a click and a double-click, and
//    nothing else.
// Background click still clears, because that half needs no shared registry.
import { useSyncExternalStore } from 'react';
import { ListRow } from '../_shared/ListRow.tsx';
import { PostCard } from '../_shared/PostCard.tsx';
import { GridMount, useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { gridSlot } from '../services/content-area.ts';
import { hologramTrashGridSource } from '../services/grid.ts';
import { clearSelection, getSnapshot, subscribe } from '../services/trash-view.ts';

const EMPTY: ReadonlySet<string> = new Set();
const getSelected = () => getSnapshot().selected ?? EMPTY;

function Cell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const selected = useSyncExternalStore(subscribe, getSelected);
  const shape = model.shape as HologramGridModel['shape'];
  const m = model.modelOf(data, index);
  m.selected = selected.has(m.postKey);
  if (shape?.list) return <ListRow m={m} shape={shape} group={data} actions={model.cardActions} listThumb={model.listThumb} />;
  return <PostCard m={m} shape={shape as NonNullable<typeof shape>} overview={model.overview} group={data} actions={model.cardActions} />;
}

const onBackgroundClick = () => clearSelection();
const container = () => gridSlot('trash');

export function TrashGrid() {
  return <GridMount bridge={hologramTrashGridSource} container={container} renderHost={(model) => <VirtualGridHost model={model} cell={Cell} onBackgroundClick={onBackgroundClick} />} />;
}
