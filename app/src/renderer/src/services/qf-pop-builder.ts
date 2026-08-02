// Value-pick routing for the redesign filter bar — the headless remnant of the
// retired qf-pop value flyout. The flyout UI (open/close/render/anchor highlight)
// was removed with its component (P2③ task 3); what survives is onQfPick, the
// add/remove routing that maps a picked value to the right query-builder mutation.
// The filterbar component (filterbar/ValueEditor) calls pickValue() from its
// own Popover, so this stays the single source of the "a value was picked → mutate
// the tree" logic for BOTH the post and poster trees. Extracted from viewer.ts
// during its decomposition; the flyout half retired 2026-07-18.

export interface QfPopDeps {
  postShadow(): { type: string; value?: string; tagId?: number }[];
  posterQHasValue(type: string, value: string): boolean;
  posterAddFilter(filter: { type: string; value: string }): void;
  posterRemoveByLeaf(type: string, value: string): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  removeFilter(index: number): void;
  buildUsers(): HologramUserAgg[];
}

export function makeQfPop(deps: QfPopDeps) {
  // Route a value pick to the right business action. Called headlessly by the
  // filterbar value editor (no open flyout) — the QB mutation's own refresh()
  // drives the re-render, so there is nothing to re-render here.
  function onQfPick(cat: string, it: HologramQfPopItem) {
    const v = it.v;
    // Poster flyouts toggle a top-level leaf in the poster query tree. Work/Character/Tag
    // all map to one tag leaf type (kind only scopes which the row offers).
    if (cat === 'poster-tag' || cat === 'poster-work' || cat === 'poster-character') {
      if (deps.posterQHasValue('tag', v)) deps.posterRemoveByLeaf('tag', v);
      else deps.posterAddFilter({ type: 'tag', value: v });
      return;
    }
    if (cat === 'poster-platform') {
      if (deps.posterQHasValue('platform', v)) deps.posterRemoveByLeaf('platform', v);
      else deps.posterAddFilter({ type: 'platform', value: v });
      return;
    }
    if (cat === 'poster-instance') {
      if (deps.posterQHasValue('instance', v)) deps.posterRemoveByLeaf('instance', v);
      else deps.posterAddFilter({ type: 'instance', value: v });
      return;
    }
    if (cat === 'poster-folder') {
      // folder is single-valued (singleValueTypes): addFilter replaces any existing folder leaf.
      if (deps.posterQHasValue('folder', v)) deps.posterRemoveByLeaf('folder', v);
      else deps.posterAddFilter({ type: 'folder', value: v });
      return;
    }
    const vtype = it.type || cat; // sub-rows (instances) override the type
    // #774: a tag row stands for one tags-table row, and two of them can share a
    // name — so both halves of this toggle key off the id when the row carries
    // one. Without it, picking the second "alice" would toggle the first one's
    // leaf, and the id would never reach the leaf that query.ts matches with.
    const isEntityTag = vtype === 'tag' && it.tagId != null;
    const i = deps.postShadow().findIndex((f) => (isEntityTag ? f.type === 'tag' && f.tagId === it.tagId : f.type === vtype && f.value === v));
    if (i >= 0) {
      deps.removeFilter(i);
    } else if (isEntityTag) {
      deps.addFilter({ type: 'tag', value: v, tagId: it.tagId });
    } else if (vtype === 'tag' || vtype === 'hashtag') {
      deps.addFilter({ type: vtype, value: v });
    } else if (vtype === 'user') {
      const u = deps.buildUsers().find((x) => x.key === v);
      deps.addFilter({ type: 'user', value: v, label: u ? u.displayName || u.screenName : v });
    } else {
      deps.addFilter({ type: vtype, value: v });
    }
  }

  // pickValue = onQfPick exposed for the redesign filter bar (filterbar/):
  // it drives the SAME add/remove routing from its Popover value editor, with no
  // flyout involved.
  return { pickValue: onQfPick };
}
