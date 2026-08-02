// Jump-rail registry (#47) — the one thing the year/month rail needs from the
// sectioned grid and cannot derive from the model: where a given month's
// header currently sits (masonic's positioners are hook results local to
// SectionedGridHost). Same shape as grid-nav.ts: the host registers a
// read-only handle on mount and clears it on unmount, and the caller (the rail
// component) gets a safe no-op when no sectioned grid is mounted (any other
// sort, or another browse mode).
//
// Deliberately separate from grid-nav.ts rather than folded into it: arrow-key
// navigation moves the SELECTION by a global item index, while the rail moves
// the SCROLL POSITION by section key — different callers, different units,
// and grid-nav.ts's contract is keyboard-selection territory only.

export interface SectionNavHandle {
  /** Scroll so this section's header sits at the top of the viewport. No-op for an unknown key. */
  scrollToTop(key: string): void;
}

let handle: SectionNavHandle | null = null;

export function registerSectionNav(h: SectionNavHandle): () => void {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
}

export function scrollSectionToTop(key: string): void {
  handle?.scrollToTop(key);
}

/** Whether a sectioned grid is currently mounted — the rail hides itself otherwise. */
export function hasSectionNav(): boolean {
  return handle !== null;
}
