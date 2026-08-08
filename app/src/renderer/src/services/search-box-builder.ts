// Search box wiring — extracted from the old viewer.ts monolith. The query-tree
// text-leaf state machine (search-editing.ts) and the suggestion-pick bridge to
// the searchbox React component (searchbox.ts) already exist as real ES modules —
// this module is the view-specific glue that used to live inline in viewer.ts:
// the store's `searchQuery` getter/setter (with the echo guard that tells typing
// apart from programmatic writes) and the debounced re-render on typing.
//
// The store is imported directly rather than injected (#1054): its two accessors
// were the only deps here typed against free-form string keys, and the typed
// store makes the injection pay for nothing — no test substitutes them.
// postQB/browseMode and the render/sidebar callbacks are still owned by
// viewer.ts, so they're injected as deps — same ctx pattern as
// query-builder.ts/kind-menu-builder.ts.
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { makeSearchEditing } from './search-editing.ts';
import { focusSearchBox, init as initSearchBox } from './searchbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';
import { store } from './store.ts';

export interface SearchBoxDeps {
  getTree(): HologramQueryGroup;
  addFilter(leaf: { type: string; [k: string]: any }): HologramQueryLeaf | null;
  removeNode(node: HologramQueryLeaf): void;
  treeLeaves(tree: HologramQueryGroup): HologramQueryLeaf[];
  getBrowseMode(): string;
  afterQueryChange(): void;
  renderPosts(): void;
  renderPosters(): void;
}

export function makeSearchBox(deps: SearchBoxDeps) {
  // hologramStore 'searchQuery' IS the search value; the searchbox component renders it
  // as a controlled Base UI Autocomplete input. Typing: component → store → the
  // subscriber below runs the debounced heavy side effects. Programmatic writes
  // (resets / tab & history restore / leaf confirm): viewer → setSearchBoxValue →
  // store → component re-renders the input. _searchEcho tells the two apart — every
  // setSearchBoxValue caller triggers its own re-render, so feeding the echo into
  // the typing pipeline would double-render and churn the editing text leaf.
  function searchQuery() {
    return store.getState().searchQuery;
  }
  let _searchEcho = '';
  function setSearchBoxValue(v: string | null | undefined) {
    _searchEcho = String(v ?? '');
    store.setState({ searchQuery: _searchEcho });
  }

  const searchEditing = makeSearchEditing({
    getTree: deps.getTree,
    addFilter: deps.addFilter,
    removeNode: deps.removeNode,
    treeLeaves: deps.treeLeaves,
    searchQuery,
    setSearchBoxValue,
    afterQueryChange: () => deps.afterQueryChange(),
    renderPosts: () => deps.renderPosts(),
  });
  function rebindEditingTextLeaf() {
    searchEditing.rebind();
  }

  // Typing arrives via the store (the searchbox component pushes every keystroke).
  // Debounced 150ms: filtering + re-rendering ~9k records on every keystroke
  // stutters; coalesce to the pause after typing. NOTE: renderPosts is called with
  // no args — a truthy arg would be taken as keepLimit and skip the history record.
  //
  // _liveToken brackets every search-editing render (typing sync / Enter confirm /
  // suggestion pick): while a render runs, tabs-builder's navCoalesceKey reads the
  // burst's token, so one typing burst collapses into ONE history entry (#144
  // the now-resolved pending decision 2 — the confirm/pick lands as a rewrite of that same entry and ENDS
  // the burst; the next burst gets a fresh token = a fresh entry).
  let _liveToken: object | null = null;
  let _liveSearch = false;
  const liveSearchKey = (): unknown => (_liveSearch ? _liveToken : null);
  function asLiveSearch(fn: () => void, end?: boolean) {
    if (!_liveToken) _liveToken = {};
    _liveSearch = true;
    try {
      fn();
    } finally {
      _liveSearch = false;
      if (end) _liveToken = null;
    }
  }
  let _searchRenderTimer: any = null;
  function handleSearchQueryStoreChange() {
    const v = searchQuery();
    if (v === _searchEcho) return; // setSearchBoxValue echo — its caller re-renders itself
    _searchEcho = v;
    clearTimeout(_searchRenderTimer);
    _searchRenderTimer = setTimeout(() => {
      asLiveSearch(() => {
        if (deps.getBrowseMode() === 'posters') {
          deps.renderPosters();
          return;
        }
        searchEditing.sync(); // posts: the box edits a 'text' leaf in the query tree
      });
    }, 150);
  }

  // Search the library for a term that came from OUTSIDE the box — today the
  // selected-text context menu (#167). Deliberately pushed into the store WITHOUT
  // the echo marker, so it travels the pipeline a KEYSTROKE travels: the component
  // re-renders the input from the store, and handleSearchQueryStoreChange above
  // runs the debounced filter+render for whichever browse mode is showing. The
  // term is left in the box (not confirmed into a leaf) for the same reason —
  // "put it in the search box" is a state the user can see, edit and clear, which
  // a confirmed filter row is not.
  function searchFor(text: string) {
    const v = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!v) return;
    store.setState({ searchQuery: v });
    focusSearchBox(); // show WHERE the term landed, and leave the caret in it
  }

  // --- Real-time search suggestions -------------------------------------------
  // On every keystroke, tag/author candidates are shown just below the search box,
  // alongside the full-text search. A click/Enter turns it directly into a filter
  // (the typed text is cleared).
  // The searchbox component (Base UI Autocomplete) owns the input + dropdown UI:
  // rendering, keyboard nav, open/close, positioning. The suggestion DATA is the
  // command registry's now (#28) — the component reads queryEntries() directly, so
  // the rows are the same ones the palette shows; the old buildSuggest is gone.
  // What a pick DOES is still searchEditing.pick, and it stays on this bridge
  // because the registry's jump entries call it too — one pick, both faces.
  // onConfirmText replicates the old bare-Enter behavior: only posts mode confirms
  // a text leaf (posters/collections filter live off the box value, Enter is a
  // no-op there).
  initSearchBox({
    // pick/confirm run as live-search too: their renders REWRITE the typing
    // burst's history entry (the typed text was for finding the filter — the
    // confirmed/picked state is what the entry should hold), then END the burst.
    onPick: (it) => asLiveSearch(() => searchEditing.pick(it), true),
    onConfirmText: () => {
      if (deps.getBrowseMode() === 'posts' && searchQuery().trim()) {
        clearTimeout(_searchRenderTimer); // beat the debounce so the leaf holds the latest value
        asLiveSearch(() => searchEditing.confirm(), true);
      }
    },
  });

  // `/` focuses the search box (standard library-app shortcut).
  // Same guards as Ctrl+A (selection-builder.ts): never steal keys from fields
  // or open overlays. Extracted from the old viewer.ts monolith late — the other
  // 5 global shortcut handlers (nav/mouse-nav/undo/select-all/size) had already
  // been absorbed into their natural domain clusters, leaving only this
  // searchbox-focus handler unmoved. Registration lives in the GlobalShortcuts
  // component (app/App.tsx).
  //
  // Ctrl/Cmd+K used to land here too; it is the command palette's now (#28,
  // services/command-registry.ts). The split is deliberate and fixed: `/` = focus
  // this field, Ctrl+K = open the palette. The field's right-edge badge is what
  // teaches it.
  // #246: the chord (/, Shift ignored — the original didn't check e.shiftKey either, see
  // shortcut-registry.ts's ignoreShift doc) now lives in the registry; this keeps the
  // guard chain and the action.
  function canExecuteSearchFocus(e: KeyboardEvent) {
    if (isTypingTarget(e)) return false;
    if (confirmGet() || lightboxIsOpen()) return false;
    if (settingsIsOpen()) return false;
    return true;
  }
  registerShortcut({
    id: 'search.focus',
    titleKey: 'shortcutSearchFocus',
    defaultCombo: '/',
    ignoreShift: true,
    canExecute: canExecuteSearchFocus,
    // the component's registered focus callback (no-op until it mounts) — the #searchBox id contract is gone (P2④)
    perform: focusSearchBox,
  });

  function handleShortcutSearchFocusKey(e: KeyboardEvent) {
    tryRun('search.focus', e);
  }

  return {
    searchQuery,
    setSearchBoxValue,
    searchFor,
    handleSearchQueryStoreChange,
    rebindEditingTextLeaf,
    handleShortcutSearchFocusKey,
    searchEditing,
    liveSearchKey,
  };
}
