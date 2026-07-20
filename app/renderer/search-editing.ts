// Search box ↔ query-tree text-leaf state machine + suggestion-pick handling —
// the P4-B "search-editing service" slice (⑨), extracted 1:1 from viewer.js.
// The post-mode search box's typed value binds to a 'text' leaf in the query
// tree (free text becomes a real filter condition alongside tag/platform/etc)
// — this module owns WHICH leaf (if any) is
// currently "being typed" (editingTextNode, private state) and the state
// transitions: sync on typing, confirm on Enter, rebind after a tab/history
// restore, drop when a concrete suggestion is picked instead. Rendering/persistence side effects
// (afterQueryChange/renderPosts/updateSidebarState) stay injected callbacks —
// this module never touches the DOM (same shape as tab-state.js's
// makeNavHistory / undo.js's makeUndo: encapsulated mutable state + injected
// side-effect callbacks, not a pure function).

// deps contract:
//   getTree() / addFilter(leaf) / removeNode(node) — the post query-builder
//     instance's tree ops (postQB), passed as bound wrappers.
//   treeLeaves(tree) — query.js pure helper.
//   searchQuery() / setSearchBoxValue(v) — the search box's value getter/setter.
//   afterQueryChange() / renderPosts() / updateSidebarState() — viewer.js
//     re-render triggers, called after a state transition.
export interface SearchEditingDeps {
  getTree(): HologramQueryGroup;
  addFilter(leaf: { type: string; [k: string]: any }): HologramQueryLeaf | null;
  removeNode(node: HologramQueryLeaf): void;
  treeLeaves(tree: HologramQueryGroup): HologramQueryLeaf[];
  searchQuery(): string;
  setSearchBoxValue(v: string): void;
  afterQueryChange(): void;
  renderPosts(): void;
  updateSidebarState(): void;
}

export function makeSearchEditing(deps: SearchEditingDeps) {
  const { getTree, addFilter, removeNode, treeLeaves, searchQuery, setSearchBoxValue, afterQueryChange, renderPosts, updateSidebarState } = deps;
  let editingTextNode: HologramQueryLeaf | null = null;

  function isEditingLeaf(node: unknown) {
    return node === editingTextNode;
  }
  // The query-builder's onLeafMutated: the bound leaf was removed or dragged
  // elsewhere — detach so typing doesn't mutate an orphan node.
  function onLeafMutated(node: unknown) {
    if (node === editingTextNode) {
      editingTextNode = null;
      setSearchBoxValue('');
    }
  }
  // The tree was reset/replaced out from under us (e.g. resetAllFilters) —
  // forget the bound leaf without touching the search box.
  function clear() {
    editingTextNode = null;
  }
  // Mirror the search box into its bound 'text' leaf. Empty clears it;
  // otherwise update the editing leaf in place, or create one and bind to it.
  function sync() {
    // self-heal: if the bound leaf was reset / replaced out of the tree, forget
    // it (otherwise Object.assign below would mutate an orphan node).
    if (editingTextNode && !treeLeaves(getTree()).includes(editingTextNode)) editingTextNode = null;
    const val = (searchQuery() || '').trim();
    if (!val) {
      if (editingTextNode) {
        const n = editingTextNode;
        editingTextNode = null;
        removeNode(n);
      } else renderPosts();
      return;
    }
    if (editingTextNode) {
      editingTextNode.value = val;
      afterQueryChange();
    } else {
      editingTextNode = addFilter({ type: 'text', value: val }) || treeLeaves(getTree()).find((c) => c.type === 'text' && c.value === val) || null;
      if (!editingTextNode) renderPosts();
    }
  }
  // Enter confirms the editing leaf: flush the current box value into it, then
  // hand it off — the leaf stays in the tree, the box clears, the next term
  // starts fresh.
  function confirm() {
    sync();
    editingTextNode = null;
    setSearchBoxValue('');
    afterQueryChange();
  }
  // After restoring a tab / history state, re-bind the editing leaf to the tree
  // leaf matching the restored box value, so resuming typing edits it instead
  // of duplicating it.
  function rebind() {
    editingTextNode = null;
    const val = (searchQuery() || '').trim();
    if (val) editingTextNode = treeLeaves(getTree()).find((c) => c.type === 'text' && c.value === val) || null;
  }
  // A concrete suggestion pick (tag/user) wins over an in-progress free-text
  // term — the typed text was for FINDING the filter, not a body search to keep.
  function pick(it: { kind: string; value: string; label?: string } | null | undefined) {
    if (!it) return;
    setSearchBoxValue('');
    if (editingTextNode) {
      const n = editingTextNode;
      editingTextNode = null;
      removeNode(n);
    }
    if (it.kind === 'tag') addFilter({ type: 'tag', value: it.value });
    else if (it.kind === 'user') addFilter({ type: 'user', value: it.value, label: it.label });
    updateSidebarState();
  }

  return { isEditingLeaf, onLeafMutated, clear, sync, confirm, rebind, pick };
}
