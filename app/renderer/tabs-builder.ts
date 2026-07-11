// Nav history (browser-style back/forward) + window-tab CRUD/bar interaction —
// extracted from viewer.ts as the viewer.ts decomposition's V12 slice (see
// memory corpus-react-purity-execution-map, Wave26/V12 "ナビ履歴・タブ状態
// スナップショット＋タブバー操作・タブ管理"). Mirrors undo-builder.ts (V11)/
// selection-builder.ts (V8): the state machines (makeNavHistory / the
// tabs.json (de)serialization pair) stay in tab-state.ts (Wave7) untouched —
// this module is their consumer, replacing viewer.ts's inline wiring, plus
// the corpusStore-backed tabs/activeTabId/tabEditingId accessors (former
// viewer.ts locals, P4-B slice⑯) and the tab-bar DOM event handlers.
//
// Image tabs (addImageTab/showImageTab/hideImageTabView/setImageTabIndex/
// toggleImageTabInspector/closeImageTab/resolveImageTabGroup) stay in
// viewer.ts — that cluster was V13's (Wave27) scope, which also finished
// image-tab.ts's DI off the old shared bridge (image-tab-builder.ts). This module takes
// showImageTab/hideImageTabView as deps (deferred forward references, same
// shape as undo-builder.ts's showToast/postGrid) and exports enough surface
// (getTabs/mutateTabs/getActiveTabId/setActiveTabId/isImageTab/activeTab/
// saveActiveTabState/nav/persistTabsDebounced/persistTabsNow/closeTab) for
// that still-local code — and for bootApp/postGrid's own deps, both declared
// elsewhere in viewer.ts — to keep calling into tab state.
import { genTabId, makeNavHistory, sanitizeSavedTabs, loadTabs, persistTabs } from './tab-state.ts';
import { cloneTree } from './listing.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { facetTreeFrom } from './query.ts';
import { open as menuOpen } from './menu.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { get as storeGet, set as storeSet } from './store.ts';
import { corpusTabsSource } from './tabs.ts';

export interface TabsBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  tabTitleOf(state: CorpusTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string };
  postQB: { getTree(): CorpusQueryGroup; setTree(t: CorpusQueryGroup | null | undefined): void; shadow(): CorpusQueryLeaf[] };
  getSortValue(): string;
  setSortValue(v: string): void;
  getMultiOnly(): boolean;
  setMultiOnly(v: boolean): void;
  searchQuery(): string;
  setSearchBoxValue(v: string | null | undefined): void;
  rebindEditingTextLeaf(): void;
  renderQueryChips(): void;
  renderPosts(keepLimit?: boolean): void;
  setLastRenderedState(json: string): void;
  getAllPostsCount(): number;
  resetAllFilters(): void;
  getBrowseMode(): string;
  contentScrollTop(): number;
  scrollContentTo(y: number): void;
  showImageTab(t: CorpusTab): void;
  hideImageTabView(): void;
}

const NAV_CAP = 60;

export function makeTabsController(deps: TabsBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const closestOf = (e: Event, sel: string) => {
    const t = e.target as HTMLElement | null;
    return t instanceof Element ? (t.closest(sel) as HTMLElement | null) : null;
  };

  const isImageTab = (t: CorpusTab | null | undefined) => !!t && t.type === 'image';

  // --- corpusStore-backed tab list (tabs/activeTabId/tabEditingId — P4-B slice⑯) ---
  const getTabs = (): CorpusTab[] => storeGet('tabs') || [];
  const setTabs = (arr: CorpusTab[]) => storeSet('tabs', arr);
  function mutateTabs(fn: (arr: CorpusTab[]) => CorpusTab[] | undefined) {
    const copy = getTabs().slice();
    const result = fn(copy);
    setTabs(result || copy);
  }
  const getActiveTabId = (): string | null => storeGet('activeTabId') ?? null;
  const setActiveTabId = (id: string | null) => storeSet('activeTabId', id);
  const getTabEditingId = (): string | null => storeGet('tabEditingId') ?? null; // id of the tab being inline-renamed (React renders its input)
  const setTabEditingId = (id: string | null) => storeSet('tabEditingId', id);
  const activeTab = () => getTabs().find((t) => t.id === getActiveTabId());
  let appBooted = false; // gate history until initTabs has applied the saved view (avoids a spurious empty entry from the early prefs render)
  function markBooted() {
    appBooted = true;
  }
  let _tabPersistTimer: any = null;
  let restoringState = false;

  function snapshotState(): CorpusTabSnapshot {
    return {
      // queryTree is the source of truth; f (the shadow) is kept for the tab title
      // (tabTitleOf reads state.f) and for migrating older persisted states.
      f: JSON.parse(JSON.stringify(deps.postQB.shadow())),
      tree: cloneTree(deps.postQB.getTree()),
      search: deps.searchQuery(),
      sort: deps.getSortValue(),
      multi: deps.getMultiOnly(),
    };
  }
  // Called from every fresh renderPosts(): keep the tab title + persistence in sync
  // with the current state, record it for the stickyRecs change-detection below,
  // and push it onto the per-tab back/forward history (see nav.push).
  function syncTitleAndPersist() {
    if (isImageTab(activeTab())) return; // grid renders under an image tab are background refreshes — its title/persistence live on the image-tab path
    const snap = snapshotState();
    deps.setLastRenderedState(JSON.stringify(snap));
    if (restoringState) return;
    nav.push(snap); // record this view for back/forward (skipped while restoring)
    document.title = deps.tabTitleOf(snap, { allCount: deps.getAllPostsCount() }).text + ' — Corpus';
    persistTabsDebounced();
  }
  function applyState(s: CorpusTabSnapshot) {
    restoringState = true;
    // Restore the tree (truth); migrate older states (f + ops, no tree) if needed.
    deps.postQB.setTree(s.tree ? s.tree : facetTreeFrom(s.f || [], s.ops || {}));
    deps.setSearchBoxValue(s.search);
    deps.rebindEditingTextLeaf(); // resume editing the restored term instead of duplicating it
    deps.setSortValue(s.sort);
    deps.setMultiOnly(!!s.multi);
    deps.renderQueryChips();
    deps.renderPosts();
    restoringState = false;
    document.title = deps.tabTitleOf(s, { allCount: deps.getAllPostsCount() }).text + ' — Corpus';
  }

  // --- View history (browser-style back/forward) ---
  // The state machine (hist/idx/cap/dedupe/forward-branch drop/adopt) lives in
  // tab-state.ts (makeNavHistory); this module keeps the DOM button sync and the
  // persistence hooks. applyState's restoringState guards the re-push.
  const nav = makeNavHistory({
    cap: NAV_CAP,
    enabled: () => appBooted,
    snapshot: snapshotState,
    apply: applyState,
    onChange: updateNavButtons,
  });
  // The nav 戻る/進む disabled state used to be part of a pushed activebar model; the
  // activebar island now self-derives everything else from corpusStore (P4-B slice⑱), but
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
  // Nav is post-mode only and yields to typing / open overlays / poster mode.
  function navAllowed() {
    if (deps.getBrowseMode() !== 'posts') return false; // history nav is post-view only (posters/collections excluded)
    if (isImageTab(activeTab())) return false; // image tabs have no filter history
    if (document.querySelector('.confirm-overlay.show') || lightboxIsOpen()) return false;
    if (settingsIsOpen()) return false;
    if (!byId('ivFolderModal').hidden) return false;
    return true;
  }
  // Back/forward through the per-tab view history: Alt+←/→ + mouse side buttons (the bar
  // buttons themselves route through the island callbacks). Guarded so they never fire
  // while typing, with an overlay open, or in poster mode (mirrors the Ctrl+A guard convention).
  // Registration lives in the GlobalShortcuts component (app/islands/app/App.tsx); this
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
    clip: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  };
  function persistTabsNow() {
    clearTimeout(_tabPersistTimer);
    const at = getTabs().find((t) => t.id === getActiveTabId());
    if (at && !isImageTab(at)) {
      at.state = snapshotState();
      at._scrollTop = deps.contentScrollTop();
    }
    persistTabs(getTabs(), getActiveTabId());
  }
  function persistTabsDebounced() {
    clearTimeout(_tabPersistTimer);
    _tabPersistTimer = setTimeout(persistTabsNow, 800);
  }
  function saveActiveTabState() {
    const t = getTabs().find((t) => t.id === getActiveTabId());
    if (!t) return;
    if (isImageTab(t)) return; // img.idx is kept live by the island callback; there is no filter state to snapshot
    t.state = snapshotState();
    t._scrollTop = deps.contentScrollTop(); // remember content scroll per tab (persisted too)
    nav.saveInto(t); // carry the back/forward history with the tab
  }
  // Restore a tab's remembered content scroll. rAF×2 so the freshly rendered
  // grid has laid out; the virtualized grid derives its window from scrollTop
  // alone (its estimated container height already spans all items).
  function restoreTabView(t: CorpusTab | null | undefined) {
    if (!t || isImageTab(t)) return; // no grid scroll to restore under an image tab
    const y = typeof t._scrollTop === 'number' ? t._scrollTop : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => deps.scrollContentTo(y)));
  }
  // Model derivation (title/icon/editing state) lives in renderer/tabs.ts's
  // corpusTabsSource (P4-B slice⑯) — it pulls from the SAME corpusStore keys
  // every mutation below writes (tabs/activeTabId/tabEditingId, plus
  // postQueryTree/searchQuery/sortPost/multiOnly/allPostsCount for the active
  // tab's derived title), so nothing here builds a model or pushes one. The
  // pin glyph + close/new i18n strings it needs are handed over once below.
  const TAB_PIN_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';
  corpusTabsSource.configure({ tabTitleOf: deps.tabTitleOf, tabIcons: TAB_ICONS, pinSvg: TAB_PIN_SVG, closeTitle: deps.t('tabClose'), newTitle: deps.t('tabNew') });
  function switchTab(id: string) {
    if (id === getActiveTabId()) return;
    saveActiveTabState();
    setActiveTabId(id);
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    if (isImageTab(t)) {
      deps.showImageTab(t);
    } else {
      deps.hideImageTabView();
      if (t.state) applyState(t.state);
      else deps.renderPosts();
    }
    nav.adopt(t);
    restoreTabView(t);
    persistTabsDebounced();
  }
  function addTab() {
    saveActiveTabState();
    deps.hideImageTabView(); // Ctrl+T from an image tab lands on a fresh grid tab
    const id = genTabId();
    mutateTabs((arr) => {
      arr.push({ id, pinned: false, title: null, state: { f: [], ops: {}, tree: null, search: '', sort: 'date-desc', multi: false } });
    });
    setActiveTabId(id);
    applyState({ f: [], ops: {}, search: '', sort: deps.getSortValue(), multi: false });
    nav.adopt(getTabs().find((t) => t.id === id)); // fresh tab → fresh history (seeded with the empty view)
    requestAnimationFrame(() => deps.scrollContentTo(0)); // new tab starts at the top
    persistTabsDebounced();
  }
  function closeTab(id: string | null | undefined) {
    if (getTabs().length <= 1) {
      if (isImageTab(getTabs()[0])) {
        // Last tab: a window always keeps one grid tab, so the image tab
        // becomes a fresh filter tab instead of just resetting.
        deps.hideImageTabView();
        const nid = genTabId();
        mutateTabs(() => [{ id: nid, pinned: false, title: null, state: null }]);
        setActiveTabId(nid);
        deps.resetAllFilters();
        nav.adopt(getTabs()[0]);
        persistTabsDebounced();
        return;
      }
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
      if (isImageTab(nextActive)) {
        deps.showImageTab(nextActive);
      } else {
        deps.hideImageTabView();
        if (nextActive.state) applyState(nextActive.state);
        else deps.renderPosts();
      }
      nav.adopt(nextActive);
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
  function renameTab(id: string, name: string) {
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    mutateTabs((arr) => {
      const tt = arr.find((x) => x.id === id);
      if (tt) tt.title = name.trim() || null;
    });
    persistTabsDebounced();
  }
  function duplicateTab(id: string) {
    saveActiveTabState();
    const src = getTabs().find((t) => t.id === id);
    if (!src) return;
    const idx = getTabs().indexOf(src);
    const nt = { id: genTabId(), pinned: false, title: src.title ? src.title + ' (2)' : null, type: src.type, img: src.img ? JSON.parse(JSON.stringify(src.img)) : undefined, state: JSON.parse(JSON.stringify(src.state || {})) };
    mutateTabs((arr) => {
      arr.splice(idx + 1, 0, nt);
    });
    setActiveTabId(nt.id);
    if (isImageTab(nt)) {
      deps.showImageTab(nt);
    } else {
      deps.hideImageTabView();
      if (nt.state && Object.keys(nt.state).length) applyState(nt.state);
      else deps.renderPosts();
    }
    nav.adopt(nt); // duplicate starts its own history at the copied view
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
      if (at && at.state && !isImageTab(at)) {
        // queryTree is the truth; migrate older states (f + ops, no tree).
        deps.postQB.setTree(at.state.tree ? at.state.tree : facetTreeFrom(at.state.f || [], at.state.ops || {}));
        deps.setSearchBoxValue(at.state.search || '');
        deps.rebindEditingTextLeaf();
        deps.setSortValue(at.state.sort || 'date-desc');
        deps.setMultiOnly(!!at.state.multi);
      }
    } catch (err) {
      console.error('initTabs error:', err);
      const id = genTabId();
      setTabs([{ id, pinned: false, title: null, state: null }]);
      setActiveTabId(id);
    }
  }
  // Tab bar: rename-input commit/cancel, close/new/switch clicks, middle-click close,
  // autoscroll suppression, right-click context menu, double-click rename, and the
  // Ctrl+T/W/Tab document shortcuts. React owns the registration (TabBarEvents,
  // app/islands/app/App.tsx), importing these handlers' live bindings from viewer.ts
  // directly (assigned at this controller's construction site); this stays the guard
  // + action logic (viewer keeps the orchestration, React owns the wiring) — same
  // "cut out and rewire" as the global shortcuts / detail-dismiss slices.
  // Tab context menu (right-click a tab): pin / rename / duplicate / close /
  // close-others. React-owned glass menu (menu.ts); this module owns the
  // items + actions.
  function showTabMenu(id: string, e: MouseEvent) {
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    const items: any[] = [
      { label: t.pinned ? deps.t('tabUnpin') : deps.t('tabPin'), act: 'pin' },
      { label: deps.t('tabRename'), act: 'rename' },
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
      else if (act === 'rename') startTabRename(tid);
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
  // Inline rename: flag the tab as editing → React renders a .tab-rename-input in
  // place of its title span (it survives re-renders, unlike the old imperative
  // replaceWith on React-owned DOM). Commit/cancel are delegated on the bar below.
  // The store notify that follows setTabEditingId() may land the re-render either
  // synchronously or on the next frame (renderer/tabs.ts's pull source isn't
  // useSyncExternalStore-backed — see its island's comment) — rAF is the same
  // "wait for React to have painted" trick restoreTabView already relies on.
  function startTabRename(id: string) {
    if (!getTabs().find((t) => t.id === id)) return;
    setTabEditingId(id);
    requestAnimationFrame(() => {
      const input = byId('tabBarInner')?.querySelector('.tab-rename-input') as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }
  function commitTabRename() {
    if (!getTabEditingId()) return;
    const input = byId('tabBarInner')?.querySelector('.tab-rename-input') as HTMLInputElement | null;
    const id = getTabEditingId() as string;
    setTabEditingId(null);
    if (input) renameTab(id, input.value);
  }
  function cancelTabRename() {
    if (!getTabEditingId()) return;
    setTabEditingId(null); // discard the edit, restore the title
  }
  // Rename input commit (Enter / blur) + cancel (Escape), delegated on the bar so
  // they keep working across React re-renders of the strip.
  function handleTabBarKeydown(e: KeyboardEvent) {
    if (!getTabEditingId() || !closestOf(e, '.tab-rename-input')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTabRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelTabRename();
    }
  }
  function handleTabBarFocusout(e: FocusEvent) {
    if (getTabEditingId() && closestOf(e, '.tab-rename-input')) commitTabRename();
  }
  function handleTabBarClick(e: MouseEvent) {
    const closeBtn = closestOf(e, '[data-close]');
    if (closeBtn) {
      e.stopPropagation();
      closeTab(closeBtn.dataset.close);
      return;
    }
    const newBtn = closestOf(e, '.tab-new');
    if (newBtn) {
      addTab();
      return;
    }
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (tabBtn && !closestOf(e, '.tab-rename-input')) {
      switchTab(tabBtn.dataset.tab as string);
      return;
    }
  }
  // Middle-click (wheel) a tab to close it — matches the close-button rule
  // (pinned tabs and the last remaining tab stay protected).
  function handleTabBarAuxclick(e: MouseEvent) {
    if (e.button !== 1) return;
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (!tabBtn) return;
    e.preventDefault();
    const t = getTabs().find((x) => x.id === tabBtn.dataset.tab);
    if (t && !t.pinned && getTabs().length > 1) closeTab(t.id);
  }
  // Suppress the middle-click autoscroll cursor over the tab strip.
  function handleTabBarMousedown(e: MouseEvent) {
    if (e.button === 1 && closestOf(e, '.tab-item[data-tab]')) e.preventDefault();
  }
  function handleTabBarContextmenu(e: MouseEvent) {
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (!tabBtn) return;
    e.preventDefault();
    showTabMenu(tabBtn.dataset.tab as string, e);
  }
  function handleTabBarDblclick(e: MouseEvent) {
    const tabBtn = closestOf(e, '.tab-item[data-tab]');
    if (!tabBtn || closestOf(e, '[data-close]')) return;
    startTabRename(tabBtn.dataset.tab as string);
  }
  function handleGlobalTabShortcut(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey) return;
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
    isImageTab,
    activeTab,
    markBooted,
    nav,
    snapshotState,
    syncTitleAndPersist,
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
    closeTab,
    pinTab,
    renameTab,
    duplicateTab,
    initTabs,
    handleTabBarKeydown,
    handleTabBarFocusout,
    handleTabBarClick,
    handleTabBarAuxclick,
    handleTabBarMousedown,
    handleTabBarContextmenu,
    handleTabBarDblclick,
    handleGlobalTabShortcut,
  };
}
