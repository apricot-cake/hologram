// Zoom anchor (#282) — "which item was the user looking at, and how far down the
// screen was it", as plain numbers, plus the tiny registry the zoom side asks
// through.
//
// Ctrl+wheel zoom (#141) changes the column width, which re-lays out the whole
// masonry. Keeping the view on the same item across that is a LAYOUT question:
// only the island that computed the layout knows where an item ended up. So the
// zoom side (grid-density-builder.ts) resolves an anchor at wheel time and hands
// it over, and the grid island (_shared/VirtualGrid.tsx) reads its own
// positioner and does the aligning — the same division of labour as TanStack
// Virtual's scrollToIndex(index, {align}), which masonic has no equivalent of.
//
// The math is split out of the React host for the same reason marquee.ts is: it
// runs against the LAYOUT MODEL (positioner cells), never against DOM rects, so
// it is unit-testable with plain numbers (scripts/zoom-anchor.test.ts).
//
// Two coordinate spaces, and mixing them is the whole trap:
//   - CONTAINER space — origin at the masonry container's top-left, unaffected
//     by scrolling. This is what positioner.get() reports, so `top`/`left` below
//     are in it.
//   - VIEWPORT space — px down from the top edge of the scroller's visible box.
//     `viewportOffset` is in it: "put this item back this far down the screen".
// `containerOffset` bridges them: how far the masonry container's top sits
// inside the scroller's CONTENT (the active-filter bar etc. live above it).
//
// Only the vertical axis is held. The horizontal one cannot be: a column-count
// change moves items sideways and there is no horizontal scroll to follow them
// with (#282's stated limit).

// What the zoom asks the grid to hold still. `index` is an index into the grid's
// item array — it survives a re-layout, which a pixel offset does not.
export interface ZoomAnchor {
  index: number;
  viewportOffset: number;
}

// One laid-out cell, in container space (mirrors masonic's PositionerItem plus
// the positioner's shared columnWidth).
export interface ZoomAnchorCell {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// Squared distance from a point to a cell's rectangle; 0 when the point is
// inside it. Squared because only the ordering is used — no sqrt needed.
function distanceSq(x: number, y: number, cell: ZoomAnchorCell): number {
  const dx = x < cell.left ? cell.left - x : x > cell.left + cell.width ? x - (cell.left + cell.width) : 0;
  const dy = y < cell.top ? cell.top - y : y > cell.top + cell.height ? y - (cell.top + cell.height) : 0;
  return dx * dx + dy * dy;
}

// The item a zoom centred at (x, y) should hold still, or null when nothing is
// laid out there at all.
//
// NEAREST, not strictly "under the cursor": the pointer lands in a gutter, or
// past the last row, often enough that a containment-only test would keep
// answering "nothing" — and the caller passes the cells of the VISIBLE window,
// so the nearest one is always something the user can see. A point inside a cell
// is at distance 0, so containment is just the exact case of the same rule.
// Ties (a point in a horizontal gutter is equidistant from both neighbours) go
// to the lower index, i.e. the one closer to the top-left, so the choice is
// stable rather than dependent on iteration order.
export function pickAnchorIndex(cells: readonly ZoomAnchorCell[], x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const d = distanceSq(x, y, cell);
    if (d < bestD || (d === bestD && best !== null && cell.index < best)) {
      best = cell.index;
      bestD = d;
    }
  }
  return best;
}

// Where a cell currently sits on screen — the second half of an anchor, captured
// before the re-layout.
export function anchorViewportOffset(cellTop: number, containerOffset: number, scrollTop: number): number {
  return containerOffset + cellTop - scrollTop;
}

// The exact inverse: the scrollTop that puts a cell back at `viewportOffset`
// once the re-layout has moved it to `cellTop`. Clamped to the scroller's real
// range, so an anchor near either end degrades to "as close as the content
// allows" instead of leaving a scrollTop the browser will silently correct.
export function anchorScrollTop(cellTop: number, containerOffset: number, viewportOffset: number, maxScrollTop: number): number {
  const top = containerOffset + cellTop - viewportOffset;
  if (!(maxScrollTop > 0)) return 0;
  return Math.max(0, Math.min(maxScrollTop, top));
}

// --- Registry ------------------------------------------------------------
// The zoom side lives outside React and has no positioner; the grid island has
// one but is a hook result local to VirtualGridHost. Same shape as
// services/grid-nav.ts: the island registers a read-only handle on mount and
// clears it on unmount, and the caller gets null when no grid is mounted.
//
// Post grid only — one slot, not a keyed table. The poster grid's Ctrl+wheel
// path commits on every tick and never anchors, so it registers nothing.

export interface ZoomAnchorHandle {
  // Resolve an anchor from a pointer position in CLIENT coordinates (what a
  // wheel event carries). Null when the grid has nothing laid out yet.
  resolve(clientX: number, clientY: number): ZoomAnchor | null;
}

let handle: ZoomAnchorHandle | null = null;

export function registerZoomAnchorSource(h: ZoomAnchorHandle): () => void {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
}

export function resolveZoomAnchor(clientX: number, clientY: number): ZoomAnchor | null {
  return handle?.resolve(clientX, clientY) ?? null;
}
