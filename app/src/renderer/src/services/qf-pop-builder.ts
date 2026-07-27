// Value-pick routing for the redesign filter bar — the headless remnant of the
// retired qf-pop value flyout. The flyout UI (open/close/render/anchor highlight)
// was removed with its island (P2③ タスク3); what survives is onQfPick, the
// add/remove routing that maps a picked value to the right query-builder mutation.
// The filterbar island (islands/filterbar/ValueEditor) calls pickValue() from its
// own Popover, so this stays the single source of the "a value was picked → mutate
// the tree" logic for BOTH the post and poster trees. Extracted from viewer.ts
// during its decomposition; the flyout half retired 2026-07-18.

export interface QfPopDeps {
  postShadow(): { type: string; value?: string }[];
  posterQHasValue(type: string, value: string): boolean;
  posterAddFilter(filter: { type: string; value: string }): void;
  posterRemoveByLeaf(type: string, value: string): void;
  addFilter(filter: { type: string; [k: string]: any }): void;
  removeFilter(index: number): void;
  buildUsers(): HologramUserAgg[];
  updateSidebarState(): void;
}

export function makeQfPop(deps: QfPopDeps) {
  // Route a value pick to the right business action. Called headlessly by the
  // filterbar value editor (no open flyout) — the QB mutation's own refresh()
  // drives the re-render, so there is nothing to re-render here.
  function onQfPick(cat: string, it: HologramQfPopItem) {
    const v = it.v;
    // Poster flyouts toggle a top-level leaf in the poster query tree. 作品/キャラ/タグ
    // all map to one tag leaf type (種別 only scopes which the row offers).
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
    const i = deps.postShadow().findIndex((f) => f.type === vtype && f.value === v);
    if (i >= 0) {
      deps.removeFilter(i);
    } else if (vtype === 'tag' || vtype === 'hashtag') {
      deps.addFilter({ type: vtype, value: v });
    } else if (vtype === 'user') {
      const u = deps.buildUsers().find((x) => x.key === v);
      deps.addFilter({ type: 'user', value: v, label: u ? u.displayName || u.screenName : v });
    } else {
      deps.addFilter({ type: vtype, value: v });
    }
    deps.updateSidebarState();
  }

  // pickValue = onQfPick exposed for the redesign filter bar (islands/filterbar):
  // it drives the SAME add/remove routing from its Popover value editor, with no
  // flyout involved.
  return { pickValue: onQfPick };
}
