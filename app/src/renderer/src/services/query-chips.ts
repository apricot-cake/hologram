// The shared facet query builder (revision ④) —
// extracted from viewer.js's inline createQueryBuilder (the event half).
// One instance per view (posts / posters). Owns the tree state, the mutation
// helpers, and the flat leaf shadow. It has no view of its own: the chips on
// screen are the filterbar component (FilterChips), which derives them from
// orchestrator's activeFilters() over the tree this module mirrors into
// hologramStore under ctx.storeKey. viewer.js still owns orchestration around a
// change (ctx.onChange) — only the tree domain itself moved.
//
// This module used to render the bar too: it built a chip view-model, cached it
// per container id, and routed the component's click/contextmenu actions back
// through dispatch(). That whole path died with the query-chips component
// (#154 P2③) — the containers it kept writing to were `hidden` divs — and was
// removed in #230 along with the ctx fields only it read (container, barEl,
// labelOf, glyphOf, t, getSearchVal, onClearSearch, openLeafEditor,
// editableLeafTypes, isEditingLeaf, textInTree).
//
// ctx: { storeKey?, predOf, onChange, singleValueTypes?, noDupTypes?,
//        multiValueTypes?, standaloneTypes?, onLeafMutated? }
import { emptyTree, hasLeafValue, hasSameLeaf, removeCondsMatching as removeCondsMatchingQ, buildShadow, canonicalizeFacet, facetViewOf, facetAdd, cleanupTree, sameLeaf, detachNode, treeParentMap, evalNode } from './query.ts';
import { set as storeSet } from './store.ts';

// Local shape for the ctx contract documented in the file-top comment
// (createQueryBuilder's ctx: any stays loose — the renderer project doesn't see
// HologramQueryLeaf/HologramQueryGroup — so this is typed only for this module's
// own body).
interface QbCtx {
  storeKey?: string;
  predOf: (f: HologramQueryLeaf) => (item: any) => boolean;
  onChange: () => void;
  singleValueTypes?: string[];
  noDupTypes?: string[];
  multiValueTypes?: string[];
  standaloneTypes?: string[];
  onLeafMutated?: (node: HologramQueryLeaf) => void;
}

export function createQueryBuilder(ctx: QbCtx) {
  let tree = emptyTree();
  let shadow: any[] = []; // last computed flat (deduped) leaf shadow
  const singleValueTypes = ctx.singleValueTypes || [];
  const noDupTypes = ctx.noDupTypes || [];
  // Facet schema: which types may hold 2+ values with an "All"/"Any" choice
  // (multi-value attributes), and which stay standalone chips. Every other
  // type clusters as a silent "Any" — the schema answers the operator
  // question, so the UI never has to ask.
  const facetOpts = { multiValueTypes: ctx.multiValueTypes || [], standaloneTypes: ctx.standaloneTypes || [] };

  // --- Tree mutation domain lives in query.ts (imported above, 9th extraction slice); the
  // bindings below close over THIS instance's tree.
  const qHasValue = (type: string, value: unknown) => hasLeafValue(tree, type, value);
  // #774: the tag-leaf variant. A facet row stands for one tags-table row, so it
  // is lit by a leaf holding that ENTITY — sameLeaf compares ids when both sides
  // know one, and only falls back to the name when either doesn't.
  const qHasTag = (tagId: number | null | undefined, value: string) => hasSameLeaf(tree, { type: 'tag', value, tagId });
  const removeCondsMatching = (pred: (c: HologramQueryLeaf) => boolean) => removeCondsMatchingQ(tree, pred);
  // Rebuild the flat (deduped) leaf shadow that `.shadow()` exposes below.
  // Also mirror the tree into hologramStore under ctx.storeKey, a fresh deep
  // clone each time (tree is mutated in-place by the query.ts calls below, so a
  // same-reference push would never pass the store's identity-equality
  // guard — same issue as the selectedSet slice, same fix). This is THE
  // single choke point for "the tree changed" (every mutation path —
  // addFilter/removeFilter/removeNode/removeBy*, plus setTree/resetTree
  // — calls syncShadow), so one push here covers all of them.
  const syncShadow = () => {
    shadow = buildShadow(tree);
    if (ctx.storeKey) storeSet(ctx.storeKey, JSON.parse(JSON.stringify(tree)));
  };
  // One canonical refresh after any tree mutation: rebuild the shadow (which
  // pushes the tree into the store), then let the view re-render — the store
  // push is what makes FilterChips recompute.
  const refresh = () => {
    syncShadow();
    ctx.onChange();
  };

  // Sidebar entry points add a condition into its attribute cluster (revision ④):
  // the newcomer joins its type's group, or pairs with the existing bare leaf
  // (structure is DERIVED — the user never builds it). On a non-facet tree
  // (persisted revision ③ nesting) it lands at the top level (AND) instead.
  function addFilter(filter: { type: string; [k: string]: any }): HologramQueryLeaf | null {
    // Single-valued types (single choice): a new one replaces the existing anywhere.
    if (singleValueTypes.includes(filter.type)) removeCondsMatching((c) => c.type === filter.type);
    // Prevent exact duplicates (anywhere in the tree), except for multi types.
    // Identity is sameLeaf's, not bare type+value: a tag leaf carrying a tagId is
    // the ENTITY, so the second of two same-named tags is not a duplicate (#774).
    else if (!noDupTypes.includes(filter.type) && hasSameLeaf(tree, filter)) return null;
    const node = Object.assign({ kind: 'cond' as const }, filter);
    if (facetViewOf(tree, facetOpts)) facetAdd(tree, node, facetOpts);
    else tree.children.push(node);
    cleanupTree(tree);
    refresh();
    return node; // callers binding to the new leaf (e.g. the editing text leaf) need it
  }
  // Remove the condition(s) matching the shadow filter at `index` (the value
  // pick router findIndex-es into the shadow). Chip removal calls removeNode /
  // removeByType with the node itself.
  function removeFilter(index: number) {
    const f = shadow[index];
    if (!f) return;
    removeCondsMatching((c) => sameLeaf(c, f));
    refresh();
  }
  function removeNode(node: HologramQueryLeaf) {
    if (ctx.onLeafMutated) ctx.onLeafMutated(node); // let the view reconcile (e.g. unbind the editing text leaf)
    detachNode(node, treeParentMap(tree));
    cleanupTree(tree);
    refresh();
  }

  return {
    getTree: () => tree,
    // Replace the tree (clone + self-heal singleton groups + recompute shadow).
    // Facet-compatible persisted trees normalize into the canonical shape here —
    // the ONLY canonicalization point now that render() (which re-asserted it on
    // every draw) is gone. Every other mutation path preserves the shape:
    // facetAdd builds real group nodes, and detach/cleanup only shrink them.
    setTree: (t: HologramQueryGroup | null | undefined) => {
      tree = t ? JSON.parse(JSON.stringify(t)) : emptyTree();
      cleanupTree(tree);
      canonicalizeFacet(tree, facetOpts);
      syncShadow();
    },
    resetTree: () => {
      tree = emptyTree();
      // Every tree mutation must resync the flat shadow (the invariant refresh()
      // documents). resetTree was the lone mutator that skipped it, leaving the
      // shadow — and its consumers (.shadow() readers → sidebar row badges) —
      // stale until the next mutation. Post-side callers were masked by a
      // following afterQueryChange()→refresh(); the poster reset (renderPosters, no
      // refresh) exposed it as row badges that stayed lit after "Reset".
      syncShadow();
    },
    addFilter,
    removeFilter,
    removeNode,
    removeByLeaf: (type: string, value: unknown) => {
      if (removeCondsMatching((c) => c.type === type && c.value === value)) refresh();
    },
    removeByType: (type: string) => {
      if (removeCondsMatching((c) => c.type === type)) refresh();
    },
    removeCondsMatching,
    qHasValue,
    qHasTag,
    refresh,
    syncShadow,
    eval: (item: unknown) => evalNode(tree, item, ctx.predOf),
    hasQuery: () => tree.children.length > 0,
    shadow: () => shadow,
  };
}
