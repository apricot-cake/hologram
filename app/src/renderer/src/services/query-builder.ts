// Query-builder instance wiring — the postQB/posterQB construction extracted
// from the old viewer.ts monolith.
// createQueryBuilder itself (the shared engine: tree state, mutation helpers,
// leaf shadow) already lives in query-chips.ts — this module is the
// view-specific glue that used to live inline in viewer.ts: the post/poster
// predicate construction (query.ts's makePostPredOf/makePosterPredOf, wired
// to the now-real folders.ts/search.ts/records.ts modules), and the two
// createQueryBuilder(ctx) call sites. Everything still owned by viewer.ts
// (the tag-id lookup, the render callback) is injected as deps — the same ctx
// pattern createQueryBuilder itself uses.
//
// It also used to carry the leaf glyph table (qcGlyph): inline SVG strings the
// retired query-chips component drew per chip. The live chips (filterbar/
// FilterChips) use lucide icons via filterbar's CatIcon, so the table went with
// the render path in #230.
import { createQueryBuilder } from './query-chips.ts';
import { makePostPredOf, makePosterPredOf } from './query.ts';
import { compile as searchCompile } from './search.ts';
import { postKeyOf } from './records.ts';
import * as folders from './folders.ts';
import { set as storeSet } from './store.ts';

// Facet type schemas (改訂④) — the すべて/どれか-capable multi-value types and the
// standalone (never-clustered) types, per view. Exported so the redesign filter bar
// (orchestrator's activeFilters / filterCategories mode logic) reads the SAME schema
// facetViewOf is built with here, rather than re-declaring it and drifting.
export const POST_FACET_OPTS = { multiValueTypes: ['tag', 'hashtag', 'folder'], standaloneTypes: ['date', 'engagement', 'text'] };
export const POSTER_FACET_OPTS = { multiValueTypes: ['tag'], standaloneTypes: ['date'] };

// Callbacks/state still owned by viewer.ts (render, tab restore) — injected the
// same way createQueryBuilder's own ctx is.
export interface PostQueryBuilderDeps {
  onChange: () => void;
  onLeafMutated: (n: HologramQueryLeaf) => void;
  tagIdOf?: (name: string) => number | undefined;
}

// The post-side builder instance. predOf is also returned — viewer.ts's
// listing.ts wiring (getFilteredPosts) needs the same predicate function.
export function makePostQueryBuilder(deps: PostQueryBuilderDeps) {
  const predOf = makePostPredOf({
    isInFolder: (id, cap, only) => folders.hasDeep(id, cap, only),
    fuzzyCompile: (q) => searchCompile(q),
    postKeyOf,
    tagIdOf: deps.tagIdOf,
  });
  const qb = createQueryBuilder({
    storeKey: 'postQueryTree',
    predOf,
    onChange: deps.onChange,
    onLeafMutated: deps.onLeafMutated,
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
  onChange: () => void;
  posterTagsOf: (key: string) => string[];
  folderById: (id: string) => { items: string[] } | null | undefined;
}

// The poster-side builder instance: the SAME builder (createQueryBuilder),
// evaluated against poster (user) objects instead of posts. transient (no
// tabs / nav history for posters); onChange → renderPosters.
export function makePosterQueryBuilder(deps: PosterQueryBuilderDeps) {
  const predOf = makePosterPredOf({
    posterTagsOf: deps.posterTagsOf,
    folderById: deps.folderById,
  });
  const qb = createQueryBuilder({
    storeKey: 'posterQueryTree',
    predOf,
    onChange: deps.onChange,
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
