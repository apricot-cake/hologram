// Grid geometry registry — the one thing keyboard selection movement needs from the
// virtualized grid and cannot derive from the model: how many columns the layout
// actually settled on, and where an item sits so it can be scrolled into view.
//
// Both live inside masonic's positioner, which is a hook result local to
// VirtualGridHost. Rather than lift the whole positioner into app state (it is
// recreated on every itemsKey/width change), the host REGISTERS a tiny read-only
// handle here on mount and clears it on unmount — the same ref-registration shape as
// searchbox's focusSearchBox(). Callers outside React (selection-builder) ask through
// the functions below and get a safe default when no grid is mounted.
//
// Post grid only: selection — and therefore arrow movement — is post-grid territory
// (the poster grid has no selection), so there is one slot, not a keyed table.

export interface GridNavHandle {
  // Columns the positioner actually produced (masonic derives it from the container
  // width unless the model pins columnCount, e.g. list = 1).
  columnCount(): number;
  // Scroll the scroller the minimum amount that brings this item fully into view.
  // No-op when it is already visible.
  scrollIntoView(index: number): void;
}

let handle: GridNavHandle | null = null;

export function registerGridNav(h: GridNavHandle): () => void {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
}

export function gridColumnCount(): number {
  const n = handle?.columnCount() ?? 1;
  return n > 0 ? n : 1;
}

export function scrollGridIndexIntoView(index: number): void {
  handle?.scrollIntoView(index);
}
