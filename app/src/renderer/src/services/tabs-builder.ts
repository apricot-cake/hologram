// Nav history (browser-style back/forward) + window-tab CRUD/bar interaction —
// extracted from the old viewer.ts monolith. Mirrors undo-builder.ts /
// selection-builder.ts: the state machines (makeNavHistory / the
// tabs.json (de)serialization pair) stay in tab-state.ts untouched —
// this module is their consumer, replacing viewer.ts's inline wiring, plus
// the hologramStore-backed tabs/activeTabId accessors (former viewer.ts locals)
// and the tab actions the strip calls (switchTab/addTab/closeTab/pinTab/
// duplicateTab/showTabMenu). The strip itself owns its own DOM events now —
// nothing here listens on the bar (#621).
//
// The image view cluster (showImageView/hideImageView/openImageEntry/
// setImageTabIndex/toggleImageTabInspector/closeImageTab/addImageTab) lives in
// image-tab-builder.ts (#144 reworked the type:'image' TAB into an
// 'image' entry on the unified per-tab history). This module takes
// showImageView/hideImageView as deps (deferred forward references, same
// shape as undo-builder.ts's showToast/postGrid) and exports enough surface
// (getTabs/mutateTabs/getActiveTabId/setActiveTabId/activeTab/
// saveActiveTabState/nav/persistTabsDebounced/persistTabsNow/closeTab) for
// that still-local code — and for bootApp/postGrid's own deps, both declared
// elsewhere in viewer.ts — to keep calling into tab state.
import { genTabId, makeNavHistory, navEntryUrl, sanitizeSavedTabs, loadTabs, persistTabs } from './tab-state.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { cloneTree, facetTreeFrom } from './query.ts';
import { open as menuOpen } from './menu.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { get as storeGet, set as storeSet } from './store.ts';
import { hologramTabsSource } from './tabs.ts';

export interface TabsBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  tabTitleOf(state: HologramTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string };
  postQB: { getTree(): HologramQueryGroup; setTree(t: HologramQueryGroup | null | undefined): void; shadow(): HologramQueryLeaf[] };
  getSortValue(): string;
  setSortValue(v: string): void;
  getShuffleSeed(): string;
  setShuffleSeed(v: string): void;
  getMultiOnly(): boolean;
  setMultiOnly(v: boolean): void;
  searchQuery(): string;
  setSearchBoxValue(v: string | null | undefined): void;
  rebindEditingTextLeaf(): void;
  renderPosts(keepLimit?: boolean): void;
  setLastRenderedState(json: string): void;
  getAllPostsCount(): number;
  resetAllFilters(): void;
  getBrowseMode(): string;
  // Flip the mode WITHOUT rendering / recording (browseMode let + store mirror +
  // closeDetail only) — applyEntry runs the right render itself right after.
  setBrowseModeLite(mode: 'posts' | 'posters'): void;
  contentScrollTop(): number;
  scrollContentTo(y: number): void;
  // Poster-side view state for 'posters' entries (#144 pending decision 3 — mode is per-tab now,
  // so the poster filter tree / sort / live search ride the history entry).
  getPosterTree(): HologramQueryGroup;
  setPosterTree(t: HologramQueryGroup | null | undefined): void;
  getPosterSort(): string;
  setPosterSort(v: string): void;
  renderPosters(): void;
  // Image view (fit-to-screen detail) — an 'image' history entry, not a tab type
  // anymore (#144 pending decision 1: unifying the image tab).
  showImageView(recs: string[], idx: number): void;
  hideImageView(): void;
  // Coalescing hint for record(): a stable non-null key while one editing burst
  // is in progress (live search typing / an open facet editor session) makes
  // follow-up records replace instead of push — "1 session, 1 entry" (pending decision 2).
  navCoalesceKey(): unknown;
}

const NAV_CAP = 60;

export function makeTabsController(deps: TabsBuilderDeps) {
  // --- hologramStore-backed tab list (tabs/activeTabId) ---
  const getTabs = (): HologramTab[] => storeGet('tabs') || [];
  const setTabs = (arr: HologramTab[]) => storeSet('tabs', arr);
  function mutateTabs(fn: (arr: HologramTab[]) => HologramTab[] | undefined) {
    const copy = getTabs().slice();
    const result = fn(copy);
    setTabs(result || copy);
  }
  const getActiveTabId = (): string | null => storeGet('activeTabId') ?? null;
  const setActiveTabId = (id: string | null) => storeSet('activeTabId', id);
  const activeTab = () => getTabs().find((t) => t.id === getActiveTabId());
  let appBooted = false; // gate history until initTabs has applied the saved view (avoids a spurious empty entry from the early prefs render)
  function markBooted() {
    appBooted = true;
  }
  let _tabPersistTimer: any = null;
  let restoringState = false;

  function snapshotState(): HologramTabSnapshot {
    return {
      // queryTree is the source of truth; f (the shadow) is kept for the tab title
      // (tabTitleOf reads state.f) and for migrating older persisted states.
      f: JSON.parse(JSON.stringify(deps.postQB.shadow())),
      tree: cloneTree(deps.postQB.getTree()),
      search: deps.searchQuery(),
      sort: deps.getSortValue(),
      // Rides along with the sort key so a restored tab reproduces its shuffle (#118).
      shuffleSeed: deps.getShuffleSeed(),
      multi: deps.getMultiOnly(),
    };
  }
  // Poster-side view state — the 'posters' entry payload (mirror of snapshotState).
  function snapshotPosterState() {
    return { tree: cloneTree(deps.getPosterTree()), sort: deps.getPosterSort(), search: deps.searchQuery() };
  }
  const entryOf = (kind: HologramNavEntry['kind'], state: any): HologramNavEntry => ({ u: navEntryUrl(kind, state), kind, state });
  // Current view as a history entry — image beats mode (the image view overlays
  // whichever grid the tab was browsing); used to seed fresh histories on adopt.
  function snapshotEntry(): HologramNavEntry {
    const iv = storeGet('activeImageTab');
    if (iv) return entryOf('image', { recs: iv.recs, idx: iv.idx });
    if (deps.getBrowseMode() === 'posters') return entryOf('posters', snapshotPosterState());
    return entryOf('posts', snapshotState());
  }
  // push/replace router around nav.record: a one-shot replace flag (sort changes —
  // the now-resolved pending decision 2's replace list) beats the coalesce key (live typing / facet editor).
  let _navReplaceNext = false;
  function setNavReplaceNext() {
    _navReplaceNext = true;
  }
  function recordEntry(e: HologramNavEntry) {
    if (_navReplaceNext) {
      _navReplaceNext = false;
      nav.replace(e);
      return;
    }
    nav.record(e, deps.navCoalesceKey());
  }
  // Called from every fresh renderPosts(): keep the tab title + persistence in sync
  // with the current state, record it for the stickyRecs change-detection below,
  // and record it onto the per-tab back/forward history (see recordEntry).
  function syncTitleAndPersist() {
    if (storeGet('activeImageTab')) return; // grid renders under the image view are background refreshes
    if (deps.getBrowseMode() !== 'posts') return; // hidden-grid render while browsing posters
    const snap = snapshotState();
    deps.setLastRenderedState(JSON.stringify(snap));
    if (restoringState) return;
    recordEntry(entryOf('posts', snap));
    clearAutoTitle();
    document.title = deps.tabTitleOf(snap, { allCount: deps.getAllPostsCount() }).text + ' — Hologram';
    persistTabsDebounced();
  }
  // The poster-grid mirror (deps.onPosterRendered of poster-grid-builder): every
  // fresh renderPosters() records a 'posters' entry — poster filters/sort/search
  // are history now that mode is per-tab (#144 pending decision 3).
  function syncPosterTitleAndPersist() {
    if (storeGet('activeImageTab')) return;
    if (deps.getBrowseMode() !== 'posters') return;
    if (restoringState) return;
    recordEntry(entryOf('posters', snapshotPosterState()));
    clearAutoTitle();
    document.title = deps.t('browsePosters') + ' — Hologram';
    persistTabsDebounced();
  }
  function applyState(s: HologramTabSnapshot) {
    restoringState = true;
    // Restore the tree (truth); migrate older states (f + ops, no tree) if needed.
    deps.postQB.setTree(s.tree ? s.tree : facetTreeFrom(s.f || [], s.ops || {}));
    deps.setSearchBoxValue(s.search);
    deps.rebindEditingTextLeaf(); // resume editing the restored term instead of duplicating it
    deps.setSortValue(s.sort);
    deps.setShuffleSeed(s.shuffleSeed || ''); // pre-#118 states have none — random then re-seeds on pick
    deps.setMultiOnly(!!s.multi);
    deps.renderPosts();
    restoringState = false;
    document.title = deps.tabTitleOf(s, { allCount: deps.getAllPostsCount() }).text + ' — Hologram';
  }
  // The kind dispatch (#144 core): restore whichever view an entry describes.
  // posts/posters swap the browse mode without the setBrowseMode render debounce
  // (the entry's own render below is THE render); image overlays the grid as-is.
  function applyEntry(e: HologramNavEntry) {
    _navReplaceNext = false; // a restore consumes no pending replace hint
    if (e.kind === 'image') {
      const st = e.state as { recs: string[]; idx: number };
      deps.showImageView(st.recs, st.idx);
      return;
    }
    deps.hideImageView();
    deps.setBrowseModeLite(e.kind === 'posters' ? 'posters' : 'posts');
    if (e.kind === 'posters') {
      const st = e.state as { tree?: any; sort?: string; search?: string };
      restoringState = true;
      deps.setPosterTree(st.tree || null);
      deps.setPosterSort(st.sort || 'count');
      deps.setSearchBoxValue(st.search || '');
      deps.renderPosters();
      restoringState = false;
      clearAutoTitle();
      document.title = deps.t('browsePosters') + ' — Hologram';
      return;
    }
    clearAutoTitle();
    applyState(e.state as HologramTabSnapshot);
  }
  // An image entry stamps its title onto the tab (auto-title); leaving the image
  // entry clears it back to the derived grid title. Since manual renaming was
  // dropped, an auto title is the ONLY kind a tab can carry — the _autoTitle flag
  // stays as the "this title is stale once the tab leaves the image" marker.
  function clearAutoTitle() {
    const id = getActiveTabId();
    const t = getTabs().find((x) => x.id === id);
    if (!t || !t._autoTitle) return;
    mutateTabs((arr) => {
      const tt = arr.find((x) => x.id === id);
      if (tt) {
        tt.title = null;
        tt._autoTitle = false;
      }
    });
  }

  // --- View history (browser-style back/forward) ---
  // The state machine (hist/idx/cap/dedupe/forward-branch drop/adopt/replace/
  // coalescing) lives in tab-state.ts (makeNavHistory); this module keeps the
  // entry construction, the kind dispatch, the store button sync and the
  // persistence hooks. applyState's restoringState guards the re-push.
  const nav = makeNavHistory({
    cap: NAV_CAP,
    enabled: () => appBooted,
    snapshot: snapshotEntry,
    apply: applyEntry,
    onChange: updateNavButtons,
  });
  // The nav Back/Forward disabled state used to be part of a pushed activebar model; the
  // activebar component now self-derives everything else from hologramStore, but
  // nav's canBack/canForward live in a closure (the history stack), not the store — so this
  // is the one remaining mirror-on-change (same shape as multiOnly/qfCat elsewhere).
  function updateNavButtons() {
    storeSet('navCanBack', nav.canBack());
    storeSet('navCanForward', nav.canForward());
  }
  function navBack() {
    if (nav.back()) persistTabsDebounced();
  }
  function navForward() {
    if (nav.forward()) persistTabsDebounced();
  }
  // Nav yields to typing / open overlays only — posters and the image view are
  // ON the history now (#144), so mode no longer gates back/forward.
  function navAllowed() {
    if (confirmGet() || lightboxIsOpen()) return false;
    if (settingsIsOpen()) return false;
    if (paletteIsOpen()) return false;
    return true;
  }
  // Back/forward through the per-tab view history: Alt+←/→ + mouse side buttons (the bar
  // buttons themselves route through the component callbacks). Guarded so they never fire
  // while typing, with an overlay open, or in poster mode (mirrors the Ctrl+A guard convention).
  // Registration lives in the GlobalShortcuts component (app/App.tsx); this
  // stays the handler + guard logic (viewer keeps the orchestration, React owns the wiring).
  function handleShortcutNavKey(e: KeyboardEvent) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') navBack();
    else navForward();
  }
  // Mouse back/forward (buttons 3/4). DOM events fire in the renderer on most
  // platforms; preventDefault stops any stray in-page navigation.
  function handleShortcutMouseNav(e: MouseEvent) {
    if (e.button !== 3 && e.button !== 4) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.button === 3) navBack();
    else navForward();
  }

  // --- Window tabs ---
  const TAB_ICONS = {
    all: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    hashtag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    platform: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    instance:
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    postType: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    media: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    date: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    engagement: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
    kind: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    // Trash (#268) — lucide's trash-2, the same glyph the sidebar entry wears.
    trash:
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  };
  function persistTabsNow() {
    clearTimeout(_tabPersistTimer);
    saveActiveTabState(); // snapshot + carry the live history (it persists now — #144 pending decision 5)
    persistTabs(getTabs(), getActiveTabId());
  }
  function persistTabsDebounced() {
    clearTimeout(_tabPersistTimer);
    _tabPersistTimer = setTimeout(persistTabsNow, 800);
  }
  function saveActiveTabState() {
    const t = getTabs().find((t) => t.id === getActiveTabId());
    if (!t) return;
    const cur = nav.current();
    // t.state stays the posts-side snapshot (title fallback + pre-#144 shape);
    // under a posters/image entry the grid state isn't the current view — keep
    // the last posts snapshot instead of overwriting it with a stale read.
    if (!cur || cur.kind === 'posts') {
      t.state = snapshotState();
      t._scrollTop = deps.contentScrollTop(); // remember content scroll per tab (persisted too)
    }
    nav.saveInto(t); // carry the back/forward history with the tab
  }
  // Restore a tab's remembered content scroll. rAF×2 so the freshly rendered
  // grid has laid out; the virtualized grid derives its window from scrollTop
  // alone (its estimated container height already spans all items).
  function restoreTabView(t: HologramTab | null | undefined) {
    if (!t) return;
    const y = typeof t._scrollTop === 'number' ? t._scrollTop : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => deps.scrollContentTo(y)));
  }
  // Model derivation (title/icon) lives in services/tabs.ts's
  // hologramTabsSource — it pulls from the SAME hologramStore keys
  // every mutation below writes (tabs/activeTabId, plus
  // postQueryTree/searchQuery/sortPost/multiOnly/allPostsCount for the active
  // tab's derived title), so nothing here builds a model or pushes one. The
  // pin glyph + close/new i18n strings it needs are handed over once below.
  const TAB_PIN_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
  hologramTabsSource.configure({ tabTitleOf: deps.tabTitleOf, tabIcons: TAB_ICONS, pinSvg: TAB_PIN_SVG, closeTitle: deps.t('tabClose'), newTitle: deps.t('tabNew'), postersTitle: deps.t('browsePosters'), trashTitle: deps.t('trashTitle'), imageFallbackTitle: deps.t('imgTabFallback') });
  // Activate a tab object: adopt its history and re-apply its current entry
  // (the stack knows which view — posts/posters/image — the tab was on). Tabs
  // without a usable stack (fresh tab, or every persisted nav row dropped as
  // invalid) fall back to the plain state path, then seed a fresh history from
  // the applied view.
  function activateTab(t: HologramTab) {
    if (Array.isArray(t._navHist) && t._navHist.length) {
      nav.adopt(t);
      nav.applyCurrent();
    } else {
      deps.hideImageView();
      deps.setBrowseModeLite('posts');
      if (t.state) applyState(t.state);
      else deps.renderPosts();
      nav.adopt(t);
    }
  }
  function switchTab(id: string) {
    if (id === getActiveTabId()) return;
    saveActiveTabState();
    setActiveTabId(id);
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    activateTab(t);
    restoreTabView(t);
    persistTabsDebounced();
  }
  function addTab() {
    saveActiveTabState();
    deps.hideImageView(); // Ctrl+T from the image view lands on a fresh grid tab
    deps.setBrowseModeLite('posts'); // a new tab always opens the posts grid (fresh view)
    const id = genTabId();
    mutateTabs((arr) => {
      arr.push({ id, pinned: false, title: null, state: { f: [], ops: {}, tree: null, search: '', sort: 'date-desc', multi: false } });
    });
    setActiveTabId(id);
    applyState({ f: [], ops: {}, search: '', sort: deps.getSortValue(), shuffleSeed: deps.getShuffleSeed(), multi: false });
    nav.adopt(getTabs().find((t) => t.id === id)); // fresh tab → fresh history (seeded with the empty view)
    requestAnimationFrame(() => deps.scrollContentTo(0)); // new tab starts at the top
    persistTabsDebounced();
  }
  // #29: opens a NEW tab whose only condition is a text leaf for `query` — the
  // full-text search palette's "jump" action. Deliberately does not touch the
  // active tab (the whole point of a library-wide full-text search is that it
  // must not disturb whatever the user was narrowed to) — same shape as
  // addTab(), swapping the empty state for one text leaf. Passing `tree: null`
  // and letting applyState derive it via facetTreeFrom(s.f, …) reuses the same
  // path a pre-#5-migration restored tab already takes, rather than
  // hand-building the group/leaf nodes here too.
  function openTextSearchTab(query: string) {
    saveActiveTabState();
    deps.hideImageView();
    deps.setBrowseModeLite('posts');
    const id = genTabId();
    const state: HologramTabSnapshot = { f: [{ type: 'text', value: query }], ops: {}, tree: null, search: query, sort: 'date-desc', multi: false };
    mutateTabs((arr) => {
      arr.push({ id, pinned: false, title: null, state });
    });
    setActiveTabId(id);
    applyState(state);
    nav.adopt(getTabs().find((t) => t.id === id));
    requestAnimationFrame(() => deps.scrollContentTo(0));
    persistTabsDebounced();
  }
  function closeTab(id: string | null | undefined) {
    if (getTabs().length <= 1) {
      // Last tab: a window always keeps one tab — whatever view it was on
      // (grid or image entry), it resets to the fresh posts grid. The history
      // stays adopted, so the pre-close views remain one back-step away.
      deps.hideImageView();
      deps.setBrowseModeLite('posts');
      deps.resetAllFilters();
      persistTabsDebounced();
      return;
    }
    const idx = getTabs().findIndex((t) => t.id === id);
    if (idx < 0) return;
    const wasActive = getActiveTabId() === id;
    mutateTabs((arr) => {
      arr.splice(idx, 1);
    });
    const nextActive = wasActive ? getTabs()[Math.min(idx, getTabs().length - 1)] : null;
    if (nextActive) {
      setActiveTabId(nextActive.id);
      activateTab(nextActive);
      restoreTabView(nextActive);
    }
    persistTabsDebounced();
  }
  function pinTab(id: string) {
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    mutateTabs((arr) => {
      const tt = arr.find((x) => x.id === id);
      if (tt) tt.pinned = !tt.pinned;
      return [...arr.filter((x) => x.pinned), ...arr.filter((x) => !x.pinned)];
    });
    persistTabsDebounced();
  }
  function duplicateTab(id: string) {
    saveActiveTabState(); // flushes the live history into src if src is active
    const src = getTabs().find((t) => t.id === id);
    if (!src) return;
    const idx = getTabs().indexOf(src);
    const nt: HologramTab = {
      id: genTabId(),
      pinned: false,
      title: src.title,
      _autoTitle: src._autoTitle,
      state: JSON.parse(JSON.stringify(src.state || {})),
      // Chrome-style: the duplicate carries the full back/forward stack.
      _navHist: Array.isArray(src._navHist) ? src._navHist.slice() : undefined,
      _navIdx: src._navIdx,
    };
    mutateTabs((arr) => {
      arr.splice(idx + 1, 0, nt);
    });
    setActiveTabId(nt.id);
    if (Array.isArray(nt._navHist) && nt._navHist.length) {
      nav.adopt(nt);
      nav.applyCurrent();
    } else {
      deps.hideImageView();
      deps.setBrowseModeLite('posts');
      if (nt.state && Object.keys(nt.state).length) applyState(nt.state);
      else deps.renderPosts();
      nav.adopt(nt);
    }
    persistTabsDebounced();
  }

  async function initTabs() {
    try {
      const saved = await loadTabs();
      const st = sanitizeSavedTabs(saved, genTabId); // null when nothing usable was saved
      if (st) {
        setTabs(st.tabs);
        setActiveTabId(st.activeTabId);
      } else {
        const id = genTabId();
        setTabs([{ id, pinned: false, title: null, state: null }]);
        setActiveTabId(id);
      }
      const at = getTabs().find((t) => t.id === getActiveTabId());
      // Restore the active tab's view state WITHOUT rendering (bootApp's
      // loadPosts runs the first render). The current history entry decides the
      // view (#144 mode per-tab): posters restores the poster tree + mode; an
      // image entry restores the posts fields underneath (back-from-image lands
      // there) and bootApp opens the image view once the library is loaded.
      const cur = at && Array.isArray(at._navHist) && at._navHist.length ? (JSON.parse(at._navHist[Math.max(0, Math.min(at._navIdx ?? at._navHist.length - 1, at._navHist.length - 1))]) as HologramNavEntry) : null;
      if (cur && cur.kind === 'posters') {
        const st = cur.state as { tree?: any; sort?: string; search?: string };
        restoringState = true; // the sortPoster store write must not read as a user sort change
        deps.setPosterTree(st.tree || null);
        deps.setPosterSort(st.sort || 'count');
        deps.setSearchBoxValue(st.search || '');
        restoringState = false;
        deps.setBrowseModeLite('posters');
      } else if (at && at.state) {
        // queryTree is the truth; migrate older states (f + ops, no tree).
        deps.postQB.setTree(at.state.tree ? at.state.tree : facetTreeFrom(at.state.f || [], at.state.ops || {}));
        deps.setSearchBoxValue(at.state.search || '');
        deps.rebindEditingTextLeaf();
        deps.setSortValue(at.state.sort || 'date-desc');
        deps.setShuffleSeed(at.state.shuffleSeed || ''); // #118 — restore the shuffle order with its sort
        deps.setMultiOnly(!!at.state.multi);
      }
      nav.adopt(at); // adopt the persisted stack (or seed from the restored view)
    } catch (err) {
      console.error('initTabs error:', err);
      const id = genTabId();
      setTabs([{ id, pinned: false, title: null, state: null }]);
      setActiveTabId(id);
      nav.adopt(getTabs()[0]);
    }
  }
  // Tab context menu (right-click a tab): pin / duplicate / close / close-others.
  // React-owned glass menu (menu.ts); this module owns the items + actions. The
  // strip calls it straight from its own onContextMenu — there is no delegated
  // listener on the bar any more (#621).
  //
  // No "Rename" row: manual tab renaming was dropped in the redesign (2026-07-13),
  // the way Chrome and VS Code have no rename either — a tab's name is derived from
  // what it shows (tabTitleOf).
  function showTabMenu(id: string, e: { clientX: number; clientY: number }) {
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    const items: any[] = [
      { label: t.pinned ? deps.t('tabUnpin') : deps.t('tabPin'), act: 'pin' },
      { label: deps.t('tabDuplicate'), act: 'duplicate' },
    ];
    if (getTabs().length > 1) {
      items.push({ label: deps.t('tabClose'), act: 'close' });
      items.push({ label: deps.t('tabCloseOthers'), act: 'close-others', danger: true });
    }
    menuOpen({ items, x: e.clientX, y: e.clientY + 4 }, (item) => {
      const tid = id;
      const act = item.act;
      if (act === 'pin') pinTab(tid);
      else if (act === 'duplicate') duplicateTab(tid);
      else if (act === 'close') closeTab(tid);
      else if (act === 'close-others') {
        mutateTabs((arr) => arr.filter((t) => t.id === tid));
        setActiveTabId(tid);
        const tt = getTabs()[0];
        if (tt.state) applyState(tt.state);
        else deps.renderPosts();
        persistTabsDebounced();
      }
    });
  }
  // Middle-click (wheel) closes a tab, on the same rule as the ✕ button: pinned tabs
  // and the last remaining tab stay put. The strip decides WHICH tab was hit (it
  // renders them); this is the rule.
  function closeTabByGesture(id: string) {
    const t = getTabs().find((x) => x.id === id);
    if (t && !t.pinned && getTabs().length > 1) closeTab(t.id);
  }
  function handleGlobalTabShortcut(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey) return;
    // Don't let these pass through while the palette is open (#28's acceptance criteria).
    // Unlike other global shortcuts, Ctrl+T/W/Tab don't check whether the target is an
    // input field — meaning tabs would keep getting added or closed even while typing
    // in the palette's input field.
    if (paletteIsOpen()) return;
    if (e.key === 't') {
      e.preventDefault();
      addTab();
    } else if (e.key === 'w') {
      e.preventDefault();
      closeTab(getActiveTabId());
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const tabsNow = getTabs();
      const idx = tabsNow.findIndex((t) => t.id === getActiveTabId());
      if (idx < 0) return;
      const n = e.shiftKey ? (idx - 1 + tabsNow.length) % tabsNow.length : (idx + 1) % tabsNow.length;
      switchTab(tabsNow[n].id);
    }
  }

  return {
    getTabs,
    setTabs,
    mutateTabs,
    getActiveTabId,
    setActiveTabId,
    activeTab,
    markBooted,
    nav,
    snapshotState,
    syncTitleAndPersist,
    syncPosterTitleAndPersist,
    setNavReplaceNext,
    isRestoring: () => restoringState,
    navBack,
    navForward,
    navAllowed,
    handleShortcutNavKey,
    handleShortcutMouseNav,
    persistTabsNow,
    persistTabsDebounced,
    saveActiveTabState,
    restoreTabView,
    switchTab,
    addTab,
    openTextSearchTab,
    closeTab,
    closeTabByGesture,
    pinTab,
    duplicateTab,
    showTabMenu,
    initTabs,
    handleGlobalTabShortcut,
  };
}
