// Query-builder instance wiring — the postQB/posterQB construction extracted
// from the old viewer.ts monolith.
// createQueryBuilder itself (the shared drag-builder engine: tree state,
// cluster view-model, click/contextmenu dispatch) already lives in
// query-chips.ts — this module is the view-specific glue that used
// to live inline in viewer.ts: the leaf glyph table, the post/poster
// predicate construction (query.ts's makePostPredOf/makePosterPredOf, wired
// to the now-real folders.ts/search.ts/records.ts modules), and the two
// createQueryBuilder(ctx) call sites. Everything still owned by viewer.ts
// (t/i18n, DOM containers, the render/searchbox/tag callbacks) is injected
// as deps — the same ctx pattern createQueryBuilder itself uses.
import { createQueryBuilder } from './query-chips.ts';
import { makePostPredOf, makePosterPredOf } from './query.ts';
import { compile as searchCompile } from './search.ts';
import { postKeyOf } from './records.ts';
import * as folders from './folders.ts';
import { set as storeSet } from './store.ts';

// Leading type glyph for a query-builder chip — the SAME icons as the sidebar
// filter rows, so a chip's category reads at a glance (the monotone glass pill
// dropped per-type tints; the icon now carries the "which filter" cue).
const QC_GLYPH: Record<string, string> = {
  kind: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  platform: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  postType: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  media: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M21 7.5h-4"/><path d="M21 16.5h-4"/>',
  date: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  engagement: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="0.6" fill="currentColor"/>',
  hashtag: '<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  instance: '<rect x="3" y="4" width="18" height="8" rx="2"/><rect x="3" y="12" width="18" height="8" rx="2"/><line x1="7" y1="8" x2="7.01" y2="8"/><line x1="7" y1="16" x2="7.01" y2="16"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
};
export const qcGlyph = (type: string) => {
  const g = QC_GLYPH[type === 'text' ? 'search' : type]; // text leaf reuses the magnifier glyph
  return g ? `<svg class="qc-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g}</svg>` : '';
};

// Facet type schemas (改訂④) — the すべて/どれか-capable multi-value types and the
// standalone (never-clustered) types, per view. Exported so the redesign filter bar
// (orchestrator's activeFilters / filterCategories mode logic) reads the SAME schema
// facetViewOf is built with here, rather than re-declaring it and drifting.
export const POST_FACET_OPTS = { multiValueTypes: ['tag', 'hashtag', 'folder'], standaloneTypes: ['date', 'engagement', 'text'] };
export const POSTER_FACET_OPTS = { multiValueTypes: ['tag'], standaloneTypes: ['date'] };

// Callbacks/state still owned by viewer.ts (searchbox, render, popovers, tab
// restore) — injected the same way createQueryBuilder's own ctx is.
export interface PostQueryBuilderDeps {
  container: HTMLElement;
  barEl: HTMLElement | null;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  labelOf: (f: HologramQueryLeaf) => string;
  getSearchVal: () => string;
  onClearSearch: () => void;
  onChange: () => void;
  openLeafEditor: (n: HologramQueryLeaf) => void;
  onLeafMutated: (n: HologramQueryLeaf) => void;
  isEditingLeaf: (n: HologramQueryLeaf) => boolean;
  tagIdOf?: (name: string) => number | undefined;
}

// The post-side builder instance. predOf is also returned — viewer.ts's
// listing.ts wiring (getFilteredPosts) needs the same predicate function.
export function makePostQueryBuilder(deps: PostQueryBuilderDeps) {
  const predOf = makePostPredOf({
    isInFolder: (id, cap) => folders.has(id, cap),
    fuzzyCompile: (q) => searchCompile(q),
    postKeyOf,
    tagIdOf: deps.tagIdOf,
  });
  const qb = createQueryBuilder({
    t: deps.t,
    container: deps.container,
    storeKey: 'postQueryTree',
    barEl: deps.barEl, // reveal + --activebar-h measure (empty/reset are the island's)
    predOf,
    labelOf: deps.labelOf,
    glyphOf: qcGlyph,
    getSearchVal: deps.getSearchVal,
    onClearSearch: deps.onClearSearch,
    onChange: deps.onChange,
    openLeafEditor: deps.openLeafEditor,
    onLeafMutated: deps.onLeafMutated,
    isEditingLeaf: deps.isEditingLeaf,
    textInTree: true,
    editableLeafTypes: ['date', 'engagement'],
    singleValueTypes: ['date', 'kind'],
    noDupTypes: ['engagement', 'text'],
    // Facet schema (改訂④): tags/hashtags/collections are multi-value per post
    // (both すべて/どれか meaningful, default すべて); date/engagement/text
    // stay standalone chips. Everything else
    // (platform/user/instance/kind/media/postType) clusters as a silent どれか.
    multiValueTypes: POST_FACET_OPTS.multiValueTypes,
    standaloneTypes: POST_FACET_OPTS.standaloneTypes,
  });
  // Establish an initial value (emptyTree()) before any mutation, so a future
  // reader never sees undefined — setTree only runs on tab restore, which may
  // not happen before the first render of a brand-new tab.
  storeSet('postQueryTree', JSON.parse(JSON.stringify(qb.getTree())));
  return { qb, predOf };
}

export interface PosterQueryBuilderDeps {
  container: HTMLElement;
  barEl: HTMLElement | null;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  labelOf: (f: HologramQueryLeaf) => string;
  getSearchVal: () => string;
  onClearSearch: () => void;
  onChange: () => void;
  openLeafEditor: (n: HologramQueryLeaf) => void;
  posterTagsOf: (key: string) => string[];
  folderById: (id: string) => { items: string[] } | null | undefined;
}

// The poster-side builder instance: the SAME drag builder (createQueryBuilder),
// evaluated against poster (user) objects instead of posts. transient (no
// tabs / nav history for posters); onChange → renderPosters.
export function makePosterQueryBuilder(deps: PosterQueryBuilderDeps) {
  const predOf = makePosterPredOf({
    posterTagsOf: deps.posterTagsOf,
    folderById: deps.folderById,
  });
  const qb = createQueryBuilder({
    t: deps.t,
    container: deps.container,
    storeKey: 'posterQueryTree',
    barEl: deps.barEl, // reveal + --activebar-h measure (empty/reset are the island's)
    predOf,
    labelOf: deps.labelOf,
    glyphOf: qcGlyph,
    getSearchVal: deps.getSearchVal,
    onClearSearch: deps.onClearSearch,
    onChange: deps.onChange,
    openLeafEditor: deps.openLeafEditor,
    editableLeafTypes: ['date'],
    singleValueTypes: ['date', 'folder'], // 択一: 1つ選ぶと既存を置換
    noDupTypes: [],
    // Poster facet schema: a poster aggregates many tags (すべて/どれか both
    // meaningful); date stays a standalone chip.
    multiValueTypes: POSTER_FACET_OPTS.multiValueTypes,
    standaloneTypes: POSTER_FACET_OPTS.standaloneTypes,
  });
  // Establish an initial value (emptyTree()) before any mutation — posters have
  // no tabs/setTree restore path, so this is the ONLY populator until the first
  // filter interaction.
  storeSet('posterQueryTree', JSON.parse(JSON.stringify(qb.getTree())));
  return { qb };
}
