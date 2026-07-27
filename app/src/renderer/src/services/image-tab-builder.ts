// Image VIEW controller (Eagle-style fit-to-screen detail) — #144 reworked the
// old image TAB (type:'image') into an 'image' history entry on the unified
// per-tab back/forward stack: double-click pushes an image entry onto the
// current tab (leaving is nav-back), middle-click opens a background tab whose
// history is a single image entry (back stays disabled — 確定未決1). This module
// owns the view show/hide (hologramStore 'activeImageTab' → the ImageTabHost
// component derives the whole React model), the gallery index (replace, not push —
// 確定未決2), and the tab-title stamping (_autoTitle). The stack itself lives in
// tabs-builder.ts's nav (handed in as deps).
import { imageTabGroup, imageTabTitleOf } from './records.ts';
import { genTabId, navEntryUrl } from './tab-state.ts';
import { set as storeSet } from './store.ts';

export interface ImageTabBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getPostById(id: string): HologramPost | undefined;
  showDetail(g: HologramPostGroup): void;
  closeDetail(): void;
  closeTab(id: string | null | undefined): void;
  getActiveTabId(): string | null;
  setActiveTabId(id: string | null): void;
  mutateTabs(fn: (arr: HologramTab[]) => HologramTab[] | undefined): void;
  saveActiveTabState(): void;
  nav: {
    adopt(t: HologramTab | null | undefined): void;
    applyCurrent(): void;
    push(e: HologramNavEntry): void;
    replace(e: HologramNavEntry): void;
    current(): HologramNavEntry | null;
    canBack(): boolean;
  };
  navBack(): void;
  persistTabsDebounced(): void;
}

export function makeImageTabController(deps: ImageTabBuilderDeps) {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;

  // recs resolve against the live library on every use (imageTabGroup,
  // records.ts), so deletions degrade to a "missing" empty state instead of a
  // broken image. No cached group (_g) anymore — resolution is a map lookup.
  const resolveGroup = (recs: string[]) => imageTabGroup({ id: deps.getActiveTabId() || '', recs }, (id) => deps.getPostById(id));

  const imageEntry = (recs: string[], idx: number): HologramNavEntry => ({ u: navEntryUrl('image', { recs, idx }), kind: 'image', state: { recs, idx } });

  // Publish the view identity to hologramStore — services/image-tab.ts derives
  // the whole React model from this (crossed with posts-data.ts for library
  // changes, and 'inspectedKey' for the inspector state).
  function publish(recs: string[], idx: number) {
    storeSet('activeImageTab', { id: deps.getActiveTabId() || '', recs, idx });
  }

  // Stamp the image title onto the active tab (auto-title — cleared by
  // tabs-builder when a grid entry becomes current again).
  function stampTabTitle(title: string) {
    const id = deps.getActiveTabId();
    deps.mutateTabs((arr) => {
      const t = arr.find((x) => x.id === id);
      if (t) {
        t.title = title;
        t._autoTitle = true;
      }
    });
  }

  // body.image-tab-active is React-owned (ImageTabHost toggles it from model
  // presence — the class ⟺ the image view is showing). This closure keeps only
  // this local flag for the re-entrancy guard + command gating.
  let imageViewShowing = false;
  function showImageView(recs: string[], idx: number) {
    imageViewShowing = true;
    publish(recs, idx); // → ImageTabHost derives the model, adds body.image-tab-active
    const g = resolveGroup(recs);
    // The inspector opens with the view (Eagle-style detail screen).
    if (g) deps.showDetail(g);
    else deps.closeDetail();
    const title = g ? imageTabTitleOf(g, deps.t('imgTabFallback')) : deps.t('imgTabFallback');
    stampTabTitle(title);
    document.title = title + ' — Hologram';
  }
  function hideImageView() {
    if (!imageViewShowing) return;
    imageViewShowing = false;
    storeSet('activeImageTab', null); // → ImageTabHost removes the class
    deps.closeDetail(); // the open detail belonged to the image view; grid tabs reopen it per card
  }

  // Double-click a card (#143 確定): the image view is a history DESTINATION in
  // the current tab — push an image entry and show it. Leaving is ←/Alt+← (Esc
  // stays a dismiss-only key — 確定).
  function openImageEntry(g: HologramPostGroup) {
    const recs = g.records.map((r) => r.captureId).filter(Boolean);
    if (!recs.length) return;
    deps.nav.push(imageEntry(recs, 0));
    showImageView(recs, 0);
    deps.persistTabsDebounced();
  }

  // Gallery index step — rewrites the current image entry in place (paging
  // within one image view is not a navigation — 確定未決2's replace list).
  function setImageTabIndex(i: number) {
    const cur = deps.nav.current();
    if (!imageViewShowing || !cur || cur.kind !== 'image') return;
    const st = cur.state as { recs: string[]; idx: number };
    deps.nav.replace(imageEntry(st.recs, i));
    publish(st.recs, i);
    deps.persistTabsDebounced();
  }
  function toggleImageTabInspector() {
    const cur = deps.nav.current();
    if (!imageViewShowing || !cur || cur.kind !== 'image') return;
    if (byId('postDetail').hidden) {
      const g = resolveGroup((cur.state as { recs: string[] }).recs);
      if (g) deps.showDetail(g);
    } else deps.closeDetail();
    // inspectorOpen derives from hologramStore's 'inspectedKey' reactively — no repaint call needed.
  }
  // The view's close command: browser semantics — an image entry reached from a
  // grid goes BACK; a tab that is nothing but its image entry (middle-click)
  // closes outright.
  function closeImageTab() {
    if (deps.nav.canBack()) deps.navBack();
    else deps.closeTab(deps.getActiveTabId());
  }

  // Open a post group as its own tab: a normal tab whose history is one image
  // entry (中クリック＝「画像ビューを直接開いた新タブ」＝履歴1コマ — 確定未決1).
  // Background by default (browser-like: middle-click leaves you in the grid).
  function addImageTab(g: HologramPostGroup, opts?: { activate?: boolean }) {
    const recs = g.records.map((r) => r.captureId).filter(Boolean);
    if (!recs.length) return;
    const id = genTabId();
    const t = {
      id,
      pinned: false,
      title: imageTabTitleOf(g, deps.t('imgTabFallback')),
      _autoTitle: true,
      state: null,
      _navHist: [JSON.stringify(imageEntry(recs, 0))],
      _navIdx: 0,
    } as HologramTab;
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
      deps.nav.adopt(t);
      deps.nav.applyCurrent();
    }
    deps.persistTabsDebounced();
  }

  return {
    showImageView,
    hideImageView,
    openImageEntry,
    setImageTabIndex,
    toggleImageTabInspector,
    closeImageTab,
    addImageTab,
    isShowing: () => imageViewShowing, // primitive read — live, not a snapshot
  };
}
