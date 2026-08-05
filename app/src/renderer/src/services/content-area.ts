// Where the content area's elements are, for the modules that need to measure them.
//
// Both used to be `document.getElementById` lookups against ids the shell promised to
// keep (`#mode-post`, `#postGrid`, `#posterGrid`) — the "byte-for-byte DOM contract"
// #153 rules out. The shell renders these elements, so it hands them over instead: a
// ref callback on the React side, a getter on the reader's side.
//
// The scroll ROOT is not the window: the page never scrolls, the content column does.
// Anything that reads or writes a scroll position in the browse area goes through it.

/** The three destinations of the content area, each with its own grid slot. */
export type GridKind = 'post' | 'poster' | 'trash';

let scrollerEl: HTMLElement | null = null;
const gridEls: Partial<Record<GridKind, HTMLElement | null>> = {};

/** Ref callback for the content column (`<div ref={registerScroller}>`). */
export function registerScroller(el: HTMLElement | null): void {
  scrollerEl = el;
}

/**
 * The content area's scroll container. Null only before the shell has mounted —
 * every caller runs after that, but the type keeps the boot order honest.
 */
export function scroller(): HTMLElement | null {
  return scrollerEl;
}

/**
 * Ref callback for one grid's slot — the box the virtualized host attaches its
 * masonry into. Built once per kind at module scope by each caller, since a fresh
 * identity would make React detach and re-attach the ref on every render.
 */
export const registerGridSlot = (kind: GridKind) => (el: HTMLElement | null) => {
  gridEls[kind] = el;
};

/** The slot itself, for the host that mounts into it. */
export function gridSlot(kind: GridKind): HTMLElement | null {
  return gridEls[kind] ?? null;
}

/**
 * The floor of a grid's FRACTIONAL width — clientWidth rounds half-pixels up, which
 * makes an exact-fill column size 1px too wide and silently drops a column. Null when
 * the grid is not on screen (another destination is), so a size track computed from it
 * can say "no answer" instead of guessing.
 */
export function gridWidth(kind: GridKind): number | null {
  const el = gridEls[kind];
  if (!el) return null;
  const w = Math.floor(el.getBoundingClientRect().width);
  return w || null;
}
