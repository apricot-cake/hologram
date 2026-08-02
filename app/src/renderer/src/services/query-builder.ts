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
import { makePostPredOf, makePosterPredOf, hostOf } from './query.ts';
import { compile as searchCompile } from './search.ts';
import { postKeyOf } from './records.ts';
import * as folders from './folders.ts';
import { membersOf as aliasMembersOf } from './aliases.ts';
import { set as storeSet } from './store.ts';

// Facet type schemas (revision ④) — the "All"/"Any"-capable multi-value types and the
// standalone (never-clustered) types, per view. Exported so the redesign filter bar
// (orchestrator's activeFilters / filterCategories mode logic) reads the SAME schema
// facetViewOf is built with here, rather than re-declaring it and drifting.
export const POST_FACET_OPTS = { multiValueTypes: ['tag', 'hashtag', 'folder'], standaloneTypes: ['date', 'engagement', 'text', 'dimension'] };
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
  const basePredOf = makePostPredOf({
    isInFolder: (id, cap, only) => folders.hasDeep(id, cap, only),
    fuzzyCompile: (q) => searchCompile(q),
    postKeyOf,
    tagIdOf: deps.tagIdOf,
    // #23 St1: a saved 'user' leaf matches by name-merge group membership, not
    // exact posterKey equality — see query.ts's 'user' case for why this is a
    // fresh per-call lookup rather than a leaf-level compile-time memo.
    membersOf: (key) => aliasMembersOf(key),
  });
  // #253 "サイト" facet — the two leaf shapes facets.ts's unsupported-domain rows
  // add (see qfValues 'platform' case) are composed on TOP of query.ts's factory
  // here rather than inside it: this round's file split keeps #180 off
  // query.ts/extension/, and this wiring layer is where the post/poster predicate
  // construction already lives (see the module comment above).
  //   - 'domain': a platform-less post whose (www.-stripped) host matches.
  //   - 'platform'/'__none': narrowed from "no platform" to "no origin at all"
  //     (no resolvable host either) now that platform-less-but-domained posts
  //     get their own 'domain' leaf instead of falling into '__none'.
  const stripWww = (h: string) => h.replace(/^www\./, '');
  const predOf = (f: HologramQueryLeaf): ((p: HologramPost) => boolean) => {
    if (f.type === 'domain') return (p: HologramPost) => !p.platform && stripWww(hostOf(p.url)) === f.value;
    if (f.type === 'platform' && f.value === '__none') return (p: HologramPost) => !p.platform && !hostOf(p.url);
    return basePredOf(f);
  };
  const qb = createQueryBuilder({
    storeKey: 'postQueryTree',
    predOf,
    onChange: deps.onChange,
    onLeafMutated: deps.onLeafMutated,
    singleValueTypes: ['date', 'kind'],
    // #162: 'dimension' joins engagement/text here for the same reason
    // engagement does — addFilter's exact-duplicate guard keys on `value`
    // alone, which would misfire across axes (two different-axis leaves can
    // share a numeric value by coincidence); the dimension editor's apply()
    // instead replaces same-axis leaves itself (removeCondsMatching by axis).
    noDupTypes: ['engagement', 'text', 'dimension'],
    // Facet schema (revision ④): tags/hashtags/collections are multi-value per post
    // (both "All"/"Any" meaningful, default "All"); date/engagement/text
    // stay standalone chips. Everything else
    // (platform/user/instance/kind/media/postType) clusters as a silent "Any".
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
  posterTagEntriesOf: (key: string) => HologramTagEntry[];
  folderById: (id: string) => { items: string[] } | null | undefined;
}

// The poster-side builder instance: the SAME builder (createQueryBuilder),
// evaluated against poster (user) objects instead of posts. transient (no
// tabs / nav history for posters); onChange → renderPosters.
export function makePosterQueryBuilder(deps: PosterQueryBuilderDeps) {
  const predOf = makePosterPredOf({
    posterTagEntriesOf: deps.posterTagEntriesOf,
    folderById: deps.folderById,
  });
  const qb = createQueryBuilder({
    storeKey: 'posterQueryTree',
    predOf,
    onChange: deps.onChange,
    singleValueTypes: ['date', 'folder'], // single choice: picking one replaces the existing one
    noDupTypes: [],
    // Poster facet schema: a poster aggregates many tags ("All"/"Any" both
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
