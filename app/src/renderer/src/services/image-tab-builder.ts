// Image VIEW controller (Eagle-style fit-to-screen detail) — #144 reworked the
// old image TAB (type:'image') into an 'image' history entry on the unified
// per-tab back/forward stack: double-click pushes an image entry onto the
// current tab (leaving is nav-back), middle-click opens a background tab whose
// history is a single image entry (back stays disabled — confirmed (pending item 1)). This module
// owns the view show/hide (hologramStore 'activeImageTab' → the ImageTabHost
// component derives the whole React model), the gallery index (replace, not push —
// confirmed (pending item 2)), and the tab-title stamping (_autoTitle). The stack itself lives in
// tabs-builder.ts's nav (handed in as deps).
import { imageTabGroup, imageTabTitleOf } from './records.ts';
import { isVisible as panelIsVisible, setOpen as panelSetOpen } from './inspector-panel.ts';
import { reveal as panelsReveal } from './panels.ts';
import { genTabId, navEntryUrl } from './tab-state.ts';
import { store } from './store.ts';

export interface ImageTabBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getPostById(id: string): HologramPost | undefined;
  showDetail(g: HologramPostGroup): void;
  dismissDetail(): void;
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

type ImageEntry = { kind?: string; state?: { recs?: unknown; idx?: unknown } };

function imageEntryFor(t: HologramTab): ImageEntry | null {
  const hist = t._navHist;
  if (!Array.isArray(hist) || !hist.length) return null;
  const idx = typeof t._navIdx === 'number' ? t._navIdx : hist.length - 1;
  try {
    const entry = JSON.parse(hist[idx]) as ImageEntry;
    return entry?.kind === 'image' && Array.isArray(entry.state?.recs) ? entry : null;
  } catch (_e) {
    return null;
  }
}

// A tab's image name is a projection of its current image entry, not a saved
// label. Re-evaluate every open image tab after the library changes so deletion
// falls back to the neutral name and restoring the record restores its name.
export function refreshImageTabTitles(tabs: HologramTab[], activeTabId: string | null, activeEntry: HologramNavEntry | null, getPostById: (id: string) => HologramPost | undefined, fallback: string): boolean {
  let changed = false;
  for (const t of tabs) {
    const entry = t.id === activeTabId ? activeEntry : imageEntryFor(t);
    const state = entry?.state as { recs?: unknown } | undefined;
    if (entry?.kind !== 'image' || !Array.isArray(state?.recs)) continue;
    const g = imageTabGroup({ id: t.id, recs: state.recs as string[] }, getPostById);
    const title = g ? imageTabTitleOf(g, fallback) : fallback;
    if (t.title !== title || !t._autoTitle) {
      t.title = title;
      t._autoTitle = true;
      changed = true;
    }
  }
  return changed;
}

export function makeImageTabController(deps: ImageTabBuilderDeps) {
  // recs resolve against the live library on every use (imageTabGroup,
  // records.ts), so deletions degrade to a "missing" empty state instead of a
  // broken image. No cached group (_g) anymore — resolution is a map lookup.
  const resolveGroup = (recs: string[]) => imageTabGroup({ id: deps.getActiveTabId() || '', recs }, (id) => deps.getPostById(id));

  const imageEntry = (recs: string[], idx: number): HologramNavEntry => ({ u: navEntryUrl('image', { recs, idx }), kind: 'image', state: { recs, idx } });

  // Publish the view identity to hologramStore — services/image-tab.ts derives
  // the whole React model from this (crossed with posts-data.ts for library
  // changes, and 'inspectedKey' for the inspector state).
  function publish(recs: string[], idx: number) {
    store.setState({ activeImageTab: { id: deps.getActiveTabId() || '', recs, idx } });
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

  function refreshTitlesAfterPostsChange() {
    const fallback = deps.t('imgTabFallback');
    const activeEntry = deps.nav.current();
    let activeTitle: string | null = null;
    let changed = false;
    deps.mutateTabs((arr) => {
      changed = refreshImageTabTitles(arr, deps.getActiveTabId(), activeEntry, deps.getPostById, fallback);
      const active = arr.find((t) => t.id === deps.getActiveTabId());
      if (active && activeEntry?.kind === 'image') activeTitle = active.title;
      return changed ? arr : undefined;
    });
    if (!changed) return;
    if (activeTitle) document.title = activeTitle + ' — Hologram';
    deps.persistTabsDebounced();
  }

  // "Is the image view showing" is React's to draw and services/image-tab.ts's to
  // answer (isActive() ⟺ there is a model). This closure keeps only this local flag
  // for the re-entrancy guard + command gating.
  let imageViewShowing = false;
  function showImageView(recs: string[], idx: number) {
    imageViewShowing = true;
    publish(recs, idx); // → ImageTabHost derives the model and draws the stage
    const g = resolveGroup(recs);
    // The inspector opens with the view (Eagle-style detail screen).
    if (g) deps.showDetail(g);
    else deps.dismissDetail();
    const title = g ? imageTabTitleOf(g, deps.t('imgTabFallback')) : deps.t('imgTabFallback');
    stampTabTitle(title);
    document.title = title + ' — Hologram';
  }
  function hideImageView() {
    if (!imageViewShowing) return;
    imageViewShowing = false;
    store.setState({ activeImageTab: null }); // → ImageTabHost renders nothing, the content column comes back
    deps.dismissDetail(); // the open detail belonged to the image view; grid tabs reopen it per card
  }

  // Double-click a card (#143 confirmed): the image view is a history DESTINATION in
  // the current tab — push an image entry and show it. Leaving is ←/Alt+← (Esc
  // stays a dismiss-only key — confirmed).
  function openImageEntry(g: HologramPostGroup) {
    const recs = g.records.map((r) => r.captureId).filter(Boolean);
    if (!recs.length) return;
    deps.nav.push(imageEntry(recs, 0));
    showImageView(recs, 0);
    deps.persistTabsDebounced();
  }

  // Gallery index step — rewrites the current image entry in place (paging
  // within one image view is not a navigation — confirmed (pending item 2)'s replace list).
  function setImageTabIndex(i: number) {
    const cur = deps.nav.current();
    if (!imageViewShowing || !cur || cur.kind !== 'image') return;
    const st = cur.state as { recs: string[]; idx: number };
    deps.nav.replace(imageEntry(st.recs, i));
    publish(st.recs, i);
    deps.persistTabsDebounced();
  }
  // The image view's own inspector button — the same act as the tab band's toggle
  // (shell/InspectorToggle.tsx), reachable from the view that fills the window. "Is it on
  // screen" comes from the panel store rather than from reading the element's `hidden`
  // (P2⑦ / #153 ⑤), and BOTH branches move the panel's own state:
  // - Showing: this button IS the request for the panel, so it opens a closed one. Merely
  //   filling it while it stayed hidden — what the old code did whenever the user had
  //   closed it — made the button look dead. #245's bulk mask is a "closed" the user can
  //   see, so it comes off first, exactly as the tab-band toggle does it.
  // - Hiding: close the panel rather than dismiss its contents. dismissDetail() only
  //   clears the inspected key, which at wide width leaves the docked column on screen —
  //   so the button could turn the panel ON and never off. Closing clears the contents
  //   anyway (inspector-builder's panel subscriber).
  function toggleImageTabInspector() {
    const cur = deps.nav.current();
    if (!imageViewShowing || !cur || cur.kind !== 'image') return;
    if (panelIsVisible()) {
      panelSetOpen(false);
      return;
    }
    const g = resolveGroup((cur.state as { recs: string[] }).recs);
    if (!g) return;
    panelsReveal();
    panelSetOpen(true);
    deps.showDetail(g);
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
  // entry (middle-click = "a new tab that directly opened the image view" = one history entry — confirmed (pending item 1)).
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
    refreshTitlesAfterPostsChange,
    isShowing: () => imageViewShowing, // primitive read — live, not a snapshot
  };
}
