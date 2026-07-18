// Search box wiring — extracted from viewer.ts as the viewer.ts decomposition's
// V3 slice (see memory corpus-react-purity-execution-map, Wave17/V3 "検索ボックス
// 連携"). The query-tree text-leaf state machine (search-editing.ts, Wave2) and
// the suggestion-pick bridge to the searchbox React island (searchbox.ts,
// Wave5) already exist as real ES modules — this module is the view-specific
// glue that used to live inline in viewer.ts: the corpusStore 'searchQuery'
// getter/setter (with the echo guard that tells typing apart from programmatic
// writes) and the debounced re-render on typing. postQB/browseMode and the
// render/sidebar callbacks are still owned by viewer.ts, so they're injected
// as deps — same ctx pattern as query-builder.ts/kind-menu-builder.ts.
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { makeSearchEditing } from './search-editing.ts';
import { focusSearchBox, init as initSearchBox } from './searchbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';

export interface SearchBoxDeps {
  storeGet(key: string): unknown;
  storeSet(key: string, value: unknown): void;
  getTree(): CorpusQueryGroup;
  addFilter(leaf: { type: string; [k: string]: any }): CorpusQueryLeaf | null;
  removeNode(node: CorpusQueryLeaf): void;
  treeLeaves(tree: CorpusQueryGroup): CorpusQueryLeaf[];
  getBrowseMode(): string;
  afterQueryChange(): void;
  renderPosts(): void;
  renderPosters(): void;
  updateSidebarState(): void;
  buildSuggest(q: string): any[];
}

export function makeSearchBox(deps: SearchBoxDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  // corpusStore 'searchQuery' IS the search value; the searchbox island renders it
  // as a controlled Base UI Autocomplete input. Typing: island → store → the
  // subscriber below runs the debounced heavy side effects. Programmatic writes
  // (resets / tab & history restore / leaf confirm): viewer → setSearchBoxValue →
  // store → island re-renders the input. _searchEcho tells the two apart — every
  // setSearchBoxValue caller triggers its own re-render, so feeding the echo into
  // the typing pipeline would double-render and churn the editing text leaf.
  function searchQuery() {
    return String(deps.storeGet('searchQuery') || '');
  }
  let _searchEcho = '';
  function setSearchBoxValue(v: string | null | undefined) {
    _searchEcho = String(v ?? '');
    deps.storeSet('searchQuery', _searchEcho);
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
    updateSidebarState: () => deps.updateSidebarState(),
  });
  function rebindEditingTextLeaf() {
    searchEditing.rebind();
  }

  // Typing arrives via the store (the searchbox island pushes every keystroke).
  // Debounced 150ms: filtering + re-rendering ~9k records on every keystroke
  // stutters; coalesce to the pause after typing. NOTE: renderPosts is called with
  // no args — a truthy arg would be taken as keepLimit and skip the history push.
  let _searchRenderTimer: any = null;
  function handleSearchQueryStoreChange() {
    const v = searchQuery();
    if (v === _searchEcho) return; // setSearchBoxValue echo — its caller re-renders itself
    _searchEcho = v;
    clearTimeout(_searchRenderTimer);
    _searchRenderTimer = setTimeout(() => {
      if (deps.getBrowseMode() === 'posters') {
        deps.renderPosters();
        return;
      }
      searchEditing.sync(); // posts: the box edits a 'text' leaf in the query tree
    }, 150);
  }

  // --- リアルタイム検索サジェスト -------------------------------------------
  // タイプのたびに、本文検索と並行してタグ/作者の候補を検索ボックス直下に表示。
  // クリック/Enter でそのままフィルタ化（タイプした文字は消す）。
  // The searchbox island (react-aria ComboBox) owns the input + dropdown UI:
  // rendering, keyboard nav, open/close, positioning. The suggestion DATA comes
  // from buildSuggest (users.ts); what a pick DOES is searchEditing.pick,
  // wired through the searchbox bridge registered below.
  // Register the island's data callbacks. onConfirmText replicates the old bare-
  // Enter behavior: only posts mode confirms a text leaf (posters/collections
  // filter live off the box value, Enter is a no-op there).
  initSearchBox({
    getSuggestions: (q) => deps.buildSuggest(q),
    onPick: (it) => searchEditing.pick(it),
    onConfirmText: () => {
      if (deps.getBrowseMode() === 'posts' && searchQuery().trim()) {
        clearTimeout(_searchRenderTimer); // beat the debounce so the leaf holds the latest value
        searchEditing.confirm();
      }
    },
  });

  // `/` or Ctrl/Cmd+K focuses the search box (standard library-app shortcut).
  // Same guards as Ctrl+A (selection-builder.ts): never steal keys from fields
  // or open overlays. Extracted from viewer.ts as the viewer.ts decomposition's
  // V14 slice (Wave28/corpus-react-purity-execution-map) — a scope correction:
  // the other 5 global shortcut handlers (nav/mouse-nav/undo/select-all/size)
  // had already been absorbed into their natural domain clusters by V8/V10/
  // V11/V12, leaving only this searchbox-focus handler unmoved. Registration
  // lives in the GlobalShortcuts component (app/islands/app/App.tsx).
  function handleShortcutSearchFocusKey(e: KeyboardEvent) {
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlK = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key || '').toLowerCase() === 'k';
    if (!slash && !ctrlK) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (confirmGet() || lightboxIsOpen()) return;
    if (settingsIsOpen()) return;
    if (!byId('ivFolderModal').hidden) return;
    e.preventDefault();
    focusSearchBox(); // the island's registered focus callback (no-op until it mounts) — the #searchBox id contract is gone (P2④)
  }

  return {
    searchQuery,
    setSearchBoxValue,
    handleSearchQueryStoreChange,
    rebindEditingTextLeaf,
    handleShortcutSearchFocusKey,
    searchEditing,
  };
}
