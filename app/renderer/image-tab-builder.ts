// Image tabs (type:'image', Eagle-style fit-to-screen detail view) — extracted
// from viewer.ts as the viewer.ts decomposition's V13 slice (see memory
// corpus-react-purity-execution-map, Wave27/V13 "画像タブ"). Mirrors
// tabs-builder.ts (V12): the tab-list mutators (mutateTabs/getActiveTabId/…)
// and nav history stay in tabs-builder.ts's makeTabsController — this module
// is one of its consumers (showImageTab/hideImageTabView are deps.tabsCtl
// takes back, a "deferred forward reference" the same shape as tabsCtl's own
// snapshotState/syncTitleAndPersist wiring in viewer.ts).
//
// This wave also finishes the viewer.ts⇄image-tab.ts circular dependency's
// DI (memory corpus-react-purity-execution-map §5): image-tab.ts's
// dispatchIndex/dispatchToggleInspector/dispatchClose used to reach back into
// viewer.ts's old shared bridge (setImageTabIndex/toggleImageTabInspector/
// closeImageTab); they now call callbacks handed in via configure() (see
// viewer.ts's corpusImageTabSource.configure call), so the dependency is
// one-way (viewer.ts → image-tab.ts) same as every other renderer service.
import { imageTabGroup, imageTabTitleOf } from './records.ts';
import { genTabId } from './tab-state.ts';
import { set as storeSet } from './store.ts';

export interface ImageTabBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getPostById(id: string): CorpusPost | undefined;
  showDetail(g: CorpusPostGroup): void;
  closeDetail(): void;
  isImageTab(t: CorpusTab | null | undefined): boolean;
  activeTab(): CorpusTab | undefined;
  closeTab(id: string | null | undefined): void;
  getActiveTabId(): string | null;
  setActiveTabId(id: string | null): void;
  mutateTabs(fn: (arr: CorpusTab[]) => CorpusTab[] | undefined): void;
  saveActiveTabState(): void;
  nav: { adopt(t: CorpusTab | null | undefined): void };
  persistTabsDebounced(): void;
}

export function makeImageTabController(deps: ImageTabBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  // Persisted as { type:'image', img:{ recs:[captureId…], idx } }; recs resolve
  // against the live library on every activation (imageTabGroup, records.ts —
  // the _postsById lookup is injected), so deletions degrade to a "missing"
  // empty state instead of a broken image.
  const resolveImageTabGroup = (t: CorpusTab) => imageTabGroup(t, (id) => deps.getPostById(id));

  // Publish the tab's identity to corpusStore — renderer/image-tab.ts derives
  // the whole React model from this (crossed with posts-data.ts for library
  // changes, and 'inspectedKey' for the inspector state), so no model push
  // happens here.
  function publishActiveImageTab(t: CorpusTab | null) {
    storeSet('activeImageTab', t && t.img ? { id: t.id, recs: t.img.recs, idx: t.img.idx } : null);
  }

  // body.image-tab-active is React-owned (ImageTabHost toggles it from model
  // presence — the class ⟺ an image tab is showing). This closure keeps only
  // this local flag for the re-entrancy guard + the Esc check, so it no
  // longer touches document.body.classList.
  let imageTabShowing = false;
  function showImageTab(t: CorpusTab) {
    imageTabShowing = true;
    t._g = resolveImageTabGroup(t); // runtime resolution (inspector toggle re-uses it; never persisted)
    publishActiveImageTab(t); // → ImageTabHost derives the model, adds body.image-tab-active
    // The inspector opens with the view (Eagle-style detail screen).
    if (t._g) deps.showDetail(t._g);
    else deps.closeDetail();
    document.title = (t.title || deps.t('imgTabFallback')) + ' — Corpus';
  }
  function hideImageTabView() {
    if (!imageTabShowing) return;
    imageTabShowing = false;
    publishActiveImageTab(null); // → ImageTabHost removes the class
    deps.closeDetail(); // the open detail belonged to the image tab; grid tabs reopen it per card
  }

  // Index step / inspector toggle / close-tab commands — handed to
  // renderer/image-tab.ts's configure() as onIndexChange/onToggleInspector/
  // onCloseTab (this file computes the model, viewer keeps the logic).
  function setImageTabIndex(i: number) {
    const t = deps.activeTab();
    if (!t || !deps.isImageTab(t) || !t.img) return;
    t.img.idx = i;
    deps.persistTabsDebounced();
    publishActiveImageTab(t);
  }
  function toggleImageTabInspector() {
    const t = deps.activeTab();
    if (!t || !deps.isImageTab(t)) return;
    if (byId('postDetail').hidden) {
      if (t._g) deps.showDetail(t._g);
    } else deps.closeDetail();
    // inspectorOpen derives from corpusStore's 'inspectedKey' reactively — no repaint call needed.
  }
  function closeImageTab() {
    const t = deps.activeTab();
    if (t) deps.closeTab(t.id);
  }

  // Open a post group as its own tab. Background by default (browser-like:
  // middle-click / context menu leave you in the grid).
  function addImageTab(g: CorpusPostGroup, opts?: { activate?: boolean }) {
    const recs = g.records.map((r) => r.captureId).filter(Boolean);
    if (!recs.length) return;
    const id = genTabId();
    const t = { id, pinned: false, title: imageTabTitleOf(g, deps.t('imgTabFallback')), type: 'image', img: { recs, idx: 0 }, state: null } as CorpusTab;
    // Insert next to the current tab (browser-like), never inside the pinned run.
    deps.mutateTabs((arr) => {
      const ai = arr.findIndex((tt) => tt.id === deps.getActiveTabId());
      let pos = ai >= 0 ? ai + 1 : arr.length;
      const lastPinned = arr.reduce((acc, tt, i) => (tt.pinned ? i : acc), -1);
      if (pos <= lastPinned) pos = lastPinned + 1;
      arr.splice(pos, 0, t);
    });
    if (opts && opts.activate) {
      deps.saveActiveTabState();
      deps.setActiveTabId(id);
      showImageTab(t);
      deps.nav.adopt(t);
    }
    deps.persistTabsDebounced();
  }

  return {
    resolveImageTabGroup,
    showImageTab,
    hideImageTabView,
    setImageTabIndex,
    toggleImageTabInspector,
    closeImageTab,
    addImageTab,
    isShowing: () => imageTabShowing, // primitive read — live, not a snapshot
  };
}
