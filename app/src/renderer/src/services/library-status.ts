// Distinguishes "the library hasn't finished its first load yet" from "the
// library (or the current filter/search) genuinely has zero results" — the two
// library grids (posts/posters) used to collapse both into the same signal
// (postGroups/posterGroups going empty), which showed the "your library is
// empty" first-run message for a moment on every launch of a non-trivial
// library (#682). services/trash-view.ts already solved the same problem for
// the trash with its own `loaded` boolean; this mirrors that shape for the
// two grids that share the same underlying `allPosts` cache (post-grid-builder.ts).
//
// A plain function, not inlined in empty/EmptyState.tsx: this repo's `npm test`
// (vitest.config.ts) only picks up scripts/**/*.test.ts — renderer .tsx has no
// JSX rendering harness — so the decision has to live in a plain .ts module to
// be pinned by a test at all.
export function libraryEmptyVariant(input: {
  mode: string; // browseMode
  libraryLoaded: boolean;
  // postGroups: undefined before renderPosts() has ever run, explicit null once
  // it ran and found zero groups, an array otherwise (services/grid.ts).
  postGroups: unknown[] | null | undefined;
  // posterGroups has no null sentinel — always an array once renderPosters()
  // has run at all, undefined before that (services/poster-grid-builder.ts).
  posterGroups: unknown[] | undefined;
  allPostsCount: number;
  allUsersCount: number;
  query: string;
}): HologramEmptyVariant | null {
  // Never claim "empty" before the first load has actually landed — a grid
  // mid-load and a grid that finished loading empty are not the same state,
  // even though both leave postGroups/posterGroups looking "empty" today.
  if (!input.libraryLoaded) return null;
  if (input.mode === 'trash') return null;
  if (input.mode === 'posts') {
    if (input.postGroups === null) return input.allPostsCount === 0 && !input.query.trim() ? 'firstRun' : 'filtered';
    return null;
  }
  if (input.posterGroups !== undefined && input.posterGroups.length === 0) {
    return input.allUsersCount === 0 && !input.query.trim() ? 'posterFirstRun' : 'filtered';
  }
  return null;
}
