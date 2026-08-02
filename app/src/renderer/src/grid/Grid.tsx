// Virtualized post grid — the post-specific cell on the shared VirtualGridHost
// (_shared/VirtualGrid.tsx owns the masonic + scroller plumbing). The component owns
// cell rendering + windowing; orchestrator.ts owns the data (model.items = viewGroups)
// and the actions a cell calls back into.
//
// Which cell a row/card is comes from the model's display shape (#618) — one grid, two
// layouts, no second component tree and no container class deciding it in CSS.
import { useSyncExternalStore } from 'react';
import { FeedCard } from '../_shared/FeedCard.tsx';
import { ListRow } from '../_shared/ListRow.tsx';
import { PostCard } from '../_shared/PostCard.tsx';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { SectionedGridHost } from '../_shared/SectionedGrid.tsx';
import { selectionClickBackground, selectionMarquee } from '../services/orchestrator.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// modelOf() re-reads live viewer state on every render, so a source repaint refreshes
// visible cells. The inspected ring and the selection are NOT part of that closure-read
// model — both are derived straight from hologramStore ('inspectedKey' / 'selectedSet',
// real subscriptions), so opening the inspector or toggling a selection re-renders the
// right cell with no repaint needed.
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspected = () => (storeGet('inspectedKey') as string | null | undefined) ?? null;
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const subSelected = (cb: () => void) => storeSubscribe('selectedSet', cb);
const getSelected = () => (storeGet('selectedSet') as ReadonlySet<string> | undefined) ?? EMPTY_SELECTION;

export function PostCell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const selectedSet = useSyncExternalStore(subSelected, getSelected);
  const shape = model.shape as HologramGridModel['shape'];
  const m = model.modelOf(data, index);
  m.inspected = inspectedKey != null && !!model.keyOf && model.keyOf(data, index) === inspectedKey;
  m.selected = selectedSet.has(m.postKey);
  // #183: the timeline mode picks its own third cell ahead of the grid/list
  // check below — shape.list still carries whatever the POST mode's own layout
  // pref last was (the two axes are independent; see DisplayMenu.tsx's
  // TimelineControls), so it must not leak into this branch.
  if (model.mode === 'timeline') return <FeedCard m={m} shape={shape as NonNullable<typeof shape>} group={data} actions={model.cardActions} onAspect={model.onAspect} />;
  if (shape?.list) return <ListRow m={m} shape={shape} group={data} actions={model.cardActions} listThumb={model.listThumb} />;
  return <PostCard m={m} shape={shape as NonNullable<typeof shape>} overview={model.overview} group={data} actions={model.cardActions} onAspect={model.onAspect} />;
}

// Drag range selection (#484) — this grid is the only one with a selection, so it
// is the only one that arms the rubber band. Late-bound the same way FloatingBar
// calls its bulk actions: orchestrator assigns selectionMarquee during init, well
// after this module is imported. A stable identity matters here — the host tears
// its gesture down and re-arms whenever this prop changes.
const marqueeSink: HologramMarqueeSink = {
  begin: (additive) => selectionMarquee.begin(additive),
  update: (indices) => selectionMarquee.update(indices),
  end: () => selectionMarquee.end(),
  cancel: () => selectionMarquee.cancel(),
};

// The click half of the same press (#242) — background click clears the selection.
// Late-bound and hoisted out of the render for the same reason as the sink above.
const onBackgroundClick = () => selectionClickBackground();

export function GridHost({ model }: { model: HologramGridModel }) {
  // nav: this is the grid selection moves through, so it publishes its column count
  // and scroll geometry to services/grid-nav.ts (the poster grid has no selection).
  // anchor: and it is the grid Ctrl+wheel zoom holds a position in (#282) — the
  // poster grid's zoom path commits per tick and never anchors.
  //
  // #47: a date sort groups the grid into month sections (post-grid-builder.ts /
  // date-sections.ts) — model.sections carries that grouping when it applies.
  // Every other sort/browse mode leaves it null/absent and keeps rendering
  // through the single-instance VirtualGridHost completely unchanged.
  // #183: the timeline reads as body text first — a drag there is a text
  // selection, not a rubber-band pick (the 2026-08-02 design comment's accept
  // criteria 8). Omitting the sink (rather than passing a no-op) disables the
  // gesture at its source: VirtualGridHost/SectionedGridHost only arm the band
  // when `marquee` is present at all (see _shared/VirtualGrid.tsx). Click
  // selection, the inspector and the context menu are untouched — none of them
  // go through this prop.
  const marquee = model.mode === 'timeline' ? undefined : marqueeSink;
  if (model.sections && model.sections.length) {
    return <SectionedGridHost model={model} cell={PostCell} nav anchor marquee={marquee} onBackgroundClick={onBackgroundClick} />;
  }
  return <VirtualGridHost model={model} cell={PostCell} nav anchor marquee={marquee} onBackgroundClick={onBackgroundClick} />;
}
