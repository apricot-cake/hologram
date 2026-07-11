// Tab-strip model source (P4-B slice⑯) — converts #tabBarInner off the old push
// (viewer.js built a full TabsModel via renderTabs() and called
// window.corpusTabs.render(model) from ~15 call sites) to a PULLED source, the
// same shape as the grid sources (renderer/grid.ts) and the image-tab source
// (renderer/image-tab.ts, ⑮). viewer.js no longer holds tabs/activeTabId/
// tabEditingId as closure state — corpusStore's 'tabs'/'activeTabId'/
// 'tabEditingId' keys ARE the state now (the SAME "single source of truth" move
// as selectedSet, ⑬); every renderTabs() call site is gone, its notification now
// automatic through the store subscriptions below.
//
// The ACTIVE tab's title/icon still need the LIVE filter state (not the tab's
// persisted .state, which only updates on switch-away). postQB.shadow() was
// deliberately never mirrored to the store (P4-B slice⑧: every read site calls
// it directly, to avoid a second copy) — this recomputes the same thing from
// what IS mirrored: query.ts's buildShadow(postQueryTree) is the exact function
// postQB.shadow() calls internally. searchQuery/sortPost were already mirrored;
// multiOnly is mirrored for the first time in this slice (viewer.ts, alongside
// sortPost). allPostsCount (⑩) covers the tab title's item count.
//
// tabTitleOf itself stays viewer-constructed (tab-state.ts's makeTabLabels
// with viewer's t/collectionName/etc deps, which this file has no access to) —
// configure() takes the already-built function, plus the static icon map + pin
// glyph, as invariant callbacks (same "configure once" shape as the grid
// sources' modelOf/keyOf/labels/onAspect).
//
// Tab bar EVENTS (click/contextmenu/keydown/…) stay wired through TabBarEvents
// (App.tsx, P4-B slice④), which imports the handlers' live bindings from
// viewer.ts directly — unchanged by this slice; this file only computes the
// model, it never mutates tab state.
// Plain IIFE on window (like grid.ts / image-tab.ts); loaded BEFORE viewer.js.
import { buildShadow } from './query.ts';
import { get as storeGet, subscribe as storeSubscribe } from './store.ts';

type TabTitleOf = (state: any, ctx: { allCount?: number | null }) => { text: string; iconType: string };
type TabsConfig = { tabTitleOf: TabTitleOf; tabIcons: Record<string, string>; pinSvg: string; closeTitle?: string; newTitle?: string };

let tabTitleOf: TabTitleOf | null = null;
let tabIcons: Record<string, string> | null = null;
let pinSvg = '';
let closeTitle = '';
let newTitle = '';

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

const isImageTab = (t: CorpusTab) => !!t && t.type === 'image';

// Mirrors what postQB.shadow() computes internally, from the SAME mirrored
// tree (P4-B slice⑦ state-half) — no second shadow copy lives in the store.
function liveActiveState() {
  const tree = storeGet('postQueryTree');
  return {
    f: tree ? buildShadow(tree) : [],
    search: storeGet('searchQuery') || '',
    sort: storeGet('sortPost'),
    multi: !!storeGet('multiOnly'),
  };
}

function get(): CorpusTabsModel | null {
  const tt = tabTitleOf;
  const icons = tabIcons;
  if (!tt || !icons) return null;
  const rawTabs: CorpusTab[] | undefined = storeGet('tabs');
  if (!rawTabs) return null; // not yet loaded by viewer's initTabs()
  const activeTabId = storeGet('activeTabId');
  const editingId = storeGet('tabEditingId') || null;
  const allCount = storeGet('allPostsCount') || 0;
  const tabs = rawTabs.map((t) => {
    const isActive = t.id === activeTabId;
    const s = isImageTab(t) ? {} : isActive ? liveActiveState() : t.state || {};
    const derived = tt(s, { allCount });
    const icon = t.pinned ? pinSvg : isImageTab(t) ? icons.media : icons[derived.iconType] || icons.all;
    return { id: t.id, title: t.title || derived.text, icon, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
  });
  return { tabs, editingId, closeTitle, newTitle };
}

export const corpusTabsSource = {
  configure(cfg: TabsConfig) {
    tabTitleOf = cfg.tabTitleOf;
    tabIcons = cfg.tabIcons;
    pinSvg = cfg.pinSvg;
    closeTitle = cfg.closeTitle || '';
    newTitle = cfg.newTitle || '';
  },
  get,
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};
for (const k of ['tabs', 'activeTabId', 'tabEditingId', 'postQueryTree', 'searchQuery', 'sortPost', 'multiOnly', 'allPostsCount']) storeSubscribe(k, notify);

