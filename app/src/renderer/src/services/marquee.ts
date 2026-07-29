// Marquee (rubber-band) range selection geometry — the pure half of the grid's
// drag-select gesture (#484). Deliberately split from the React host: the hit
// test runs against masonic's LAYOUT MODEL (positioner cells), never against DOM
// rects, because the virtualized grid absolutely-positions its cells and
// mounts/unmounts them as the window moves — a DOM-based test would silently
// change what it is testing while the band is being dragged. Keeping the math
// here means it is unit-testable with plain numbers (scripts/marquee.test.ts).
//
// Every coordinate in this module is CONTAINER space (masonic's grid container:
// origin at its top-left, unaffected by scrolling), which is the space
// positioner.get() reports cells in.

export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarqueeCell {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

// Pointer travel (px) before a press on empty space becomes a marquee. Below it
// the gesture stays a plain click and the selection is left completely alone —
// a stray click on the grid background must not wipe a selection the user built
// up card by card.
export const MARQUEE_THRESHOLD = 4;

// How close to the scroller's edge the pointer has to get before the grid starts
// scrolling under the band, and the fastest it goes (px per animation frame, so
// ≈ 60× this per second).
export const AUTOSCROLL_EDGE = 48;
export const AUTOSCROLL_MAX = 24;

// The band between the press point and the current pointer, normalized so width
// and height are never negative (dragging up/left is the same rectangle).
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): MarqueeRect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

// 交差 (intersect), NOT 内包 (contain): a card the band merely touches is
// selected. Explorer と Finder はいずれも交差 (#484 本文) — requiring full
// containment makes tall masonry cards nearly unselectable, since one card can
// be taller than the visible band ever gets.
//
// Edges are exclusive: a band that stops exactly on a card's border leaves it
// alone, so a drag through a gutter selects nothing rather than both neighbours.
export function intersects(rect: MarqueeRect, cell: MarqueeCell): boolean {
  return rect.x < cell.left + cell.width && rect.x + rect.width > cell.left && rect.y < cell.top + cell.height && rect.y + rect.height > cell.top;
}

// Indices of every cell the band touches, ascending. The caller pre-filters by
// the band's vertical span (masonic's interval tree does that in O(log n)), so
// `cells` is a candidate set, not the whole grid.
export function hitIndices(rect: MarqueeRect, cells: readonly MarqueeCell[]): number[] {
  const hits: number[] = [];
  for (const cell of cells) if (intersects(rect, cell)) hits.push(cell.index);
  return hits.sort((a, b) => a - b);
}

// Signed scroll delta for one animation frame: negative pulls the grid up,
// positive down, 0 when the pointer sits away from both edges. Speed ramps with
// how far into the edge zone the pointer is (and keeps ramping once it leaves
// the scroller entirely, clamped at `max`), which is what makes a slow crawl and
// a fast sweep both possible without a modifier.
export function autoScrollStep(pointerY: number, viewTop: number, viewBottom: number, edge: number = AUTOSCROLL_EDGE, max: number = AUTOSCROLL_MAX): number {
  if (edge <= 0) return 0;
  if (pointerY < viewTop + edge) {
    const depth = Math.min(edge, viewTop + edge - pointerY);
    return -Math.ceil((depth / edge) * max);
  }
  if (pointerY > viewBottom - edge) {
    const depth = Math.min(edge, pointerY - (viewBottom - edge));
    return Math.ceil((depth / edge) * max);
  }
  return 0;
}
