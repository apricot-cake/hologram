// Tab-strip model source — converts #tabBarInner off the old push
// (viewer.js built a full TabsModel via renderTabs() and pushed it to a shared
// render bridge from ~15 call sites) to a PULLED source, the
// same shape as the grid sources (services/grid.ts) and the image-tab source
// (services/image-tab.ts). viewer.js no longer holds tabs/activeTabId/
// tabEditingId as closure state — hologramStore's 'tabs'/'activeTabId'/
// 'tabEditingId' keys ARE the state now (the SAME "single source of truth" move
// selection.ts made for selectedSet); every renderTabs() call site is gone, its
// notification now automatic through the store subscriptions below.
//
// The ACTIVE tab's title/icon still need the LIVE filter state (not the tab's
// persisted .state, which only updates on switch-away). postQB.shadow() was
// deliberately never mirrored to the store (every read site calls it directly,
// to avoid a second copy) — this recomputes the same thing from
// what IS mirrored: query.ts's buildShadow(postQueryTree) is the exact function
// postQB.shadow() calls internally. searchQuery/sortPost were already mirrored;
// multiOnly is mirrored for this source's sake (viewer.ts, alongside
// sortPost). allPostsCount covers the tab title's item count.
//
// tabTitleOf itself stays viewer-constructed (tab-state.ts's makeTabLabels
// with viewer's t/folderName/etc deps, which this file has no access to) —
// configure() takes the already-built function, plus the static icon map + pin
// glyph, as invariant callbacks (same "configure once" shape as the grid
// sources' modelOf/keyOf/labels/onAspect).
//
// Tab bar EVENTS (click/contextmenu/keydown/…) stay wired through TabBarEvents
// (App.tsx), which imports the handlers' live bindings from
// viewer.ts directly — unchanged by this move; this file only computes the
// model, it never mutates tab state.
// Plain IIFE on window (like grid.ts / image-tab.ts); loaded BEFORE viewer.js.
import { buildShadow } from './query.ts';
import { get as storeGet, subscribe as storeSubscribe } from './store.ts';

type TabTitleOf = (state: any, ctx: { allCount?: number | null }) => { text: string; iconType: string };
type TabsConfig = { tabTitleOf: TabTitleOf; tabIcons: Record<string, string>; pinSvg: string; closeTitle?: string; newTitle?: string; postersTitle?: string; trashTitle?: string; imageFallbackTitle?: string };

let tabTitleOf: TabTitleOf | null = null;
let tabIcons: Record<string, string> | null = null;
let pinSvg = '';
let closeTitle = '';
let newTitle = '';
let postersTitle = '';
let trashTitle = '';
let imageFallbackTitle = '';

const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
};

// A tab's current view kind (#144: the history entry decides — posts / posters /
// image). The ACTIVE tab reads the LIVE mode/store instead (its stack is only
// flushed to the tab object on switch-away).
function navKindOf(t: HologramTab): 'posts' | 'posters' | 'image' {
  if (Array.isArray(t._navHist) && t._navHist.length) {
    const i = Math.max(0, Math.min(typeof t._navIdx === 'number' ? t._navIdx : t._navHist.length - 1, t._navHist.length - 1));
    try {
      const kind = JSON.parse(t._navHist[i]).kind;
      if (kind === 'posters' || kind === 'image') return kind;
    } catch {
      /* fall through to posts */
    }
  }
  return 'posts';
}

// Mirrors what postQB.shadow() computes internally, from the SAME mirrored
// tree (query-chips.ts's state half) — no second shadow copy lives in the store.
function liveActiveState() {
  const tree = storeGet('postQueryTree');
  return {
    f: tree ? buildShadow(tree) : [],
    search: storeGet('searchQuery') || '',
    sort: storeGet('sortPost'),
    multi: !!storeGet('multiOnly'),
  };
}

function get(): HologramTabsModel | null {
  const tt = tabTitleOf;
  const icons = tabIcons;
  if (!tt || !icons) return null;
  const rawTabs: HologramTab[] | undefined = storeGet('tabs');
  if (!rawTabs) return null; // not yet loaded by viewer's initTabs()
  const activeTabId = storeGet('activeTabId');
  const editingId = storeGet('tabEditingId') || null;
  const allCount = storeGet('allPostsCount') || 0;
  const tabs = rawTabs.map((t) => {
    const isActive = t.id === activeTabId;
    const kind = isActive ? (storeGet('activeImageTab') ? 'image' : storeGet('browseMode') === 'posters' ? 'posters' : storeGet('browseMode') === 'trash' ? 'trash' : 'posts') : navKindOf(t);
    // ゴミ箱 (#268) — only ever the ACTIVE tab, since the trash records no history
    // entry (navKindOf can never answer 'trash'). The strip says where the tab is
    // looking, and while it is looking at the trash the old grid title would lie.
    if (kind === 'trash') {
      return { id: t.id, title: trashTitle, icon: t.pinned ? pinSvg : icons.trash || icons.all, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    if (kind === 'image') {
      // The image title is stamped on t.title (auto-title) by the image-view controller.
      return { id: t.id, title: t.title || imageFallbackTitle, icon: t.pinned ? pinSvg : icons.media, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    if (kind === 'posters') {
      const title = t.title && !t._autoTitle ? t.title : postersTitle;
      return { id: t.id, title, icon: t.pinned ? pinSvg : icons.user, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    const s = isActive ? liveActiveState() : t.state || {};
    const derived = tt(s, { allCount });
    const icon = t.pinned ? pinSvg : icons[derived.iconType] || icons.all;
    // _autoTitle = a stale image title on a tab that navigated back to a grid
    // before the clear landed — never show it over the derived grid title.
    return { id: t.id, title: t.title && !t._autoTitle ? t.title : derived.text, icon, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
  });
  return { tabs, editingId, closeTitle, newTitle };
}

export const hologramTabsSource = {
  configure(cfg: TabsConfig) {
    tabTitleOf = cfg.tabTitleOf;
    tabIcons = cfg.tabIcons;
    pinSvg = cfg.pinSvg;
    closeTitle = cfg.closeTitle || '';
    newTitle = cfg.newTitle || '';
    postersTitle = cfg.postersTitle || '';
    trashTitle = cfg.trashTitle || '';
    imageFallbackTitle = cfg.imageFallbackTitle || '';
  },
  get,
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};
for (const k of ['tabs', 'activeTabId', 'tabEditingId', 'postQueryTree', 'searchQuery', 'sortPost', 'multiOnly', 'allPostsCount', 'browseMode', 'activeImageTab']) storeSubscribe(k, notify);
