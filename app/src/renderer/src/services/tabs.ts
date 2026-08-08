// Tab-strip model source — converts the strip off the old push
// (viewer.js built a full TabsModel via renderTabs() and pushed it to a shared
// render bridge from ~15 call sites) to a PULLED source, the
// same shape as the grid sources (services/grid.ts) and the image-tab source
// (services/image-tab.ts). viewer.js no longer holds tabs/activeTabId as closure
// state — hologramStore's 'tabs'/'activeTabId' keys ARE the state now (the SAME
// "single source of truth" move selection.ts made for selectedSet); every
// renderTabs() call site is gone, its notification now automatic through the store
// subscriptions below.
//
// The ACTIVE tab's title/icon still need the LIVE filter state (not the tab's
// persisted .state, which only updates on switch-away). postQB.shadow() was
// deliberately never mirrored to the store (every read site calls it directly,
// to avoid a second copy) — this recomputes the same thing from
// what IS mirrored: query.ts's buildShadow(postQueryTree) is the exact function
// postQB.shadow() calls internally. searchQuery/sortPost/multiOnly all live in
// the store, so this source reads them where their writers wrote them.
// allPostsCount covers the tab title's item count.
//
// tabTitleOf itself stays viewer-constructed (tab-state.ts's makeTabLabels
// with viewer's t/folderName/etc deps, which this file has no access to) —
// configure() takes the already-built function, plus the static icon map + pin
// glyph, as invariant callbacks (same "configure once" shape as the grid
// sources' modelOf/keyOf/labels/onAspect).
//
// Tab EVENTS are the strip's own props now (tabs/Tabs.tsx calls orchestrator's
// switchTab/closeTab/… directly, #621) — this file only computes the model, it never
// mutates tab state.
import { buildShadow } from './query.ts';
import { store, subscribeKeys } from './store.ts';

type TabTitleOf = (state: any, ctx: { allCount?: number | null }) => { text: string; iconType: string };
type TabsConfig = { tabTitleOf: TabTitleOf; tabIcons: Record<string, string>; pinSvg: string; closeTitle?: string; newTitle?: string; postersTitle?: string; trashTitle?: string; imageFallbackTitle?: string; tagManageTitle?: string };

let tabTitleOf: TabTitleOf | null = null;
let tabIcons: Record<string, string> | null = null;
let pinSvg = '';
let closeTitle = '';
let newTitle = '';
let postersTitle = '';
let trashTitle = '';
let imageFallbackTitle = '';
let tagManageTitle = '';

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
// image / timeline). The ACTIVE tab reads the LIVE mode/store instead (its stack
// is only flushed to the tab object on switch-away).
function navKindOf(t: HologramTab): 'posts' | 'posters' | 'image' | 'timeline' {
  if (Array.isArray(t._navHist) && t._navHist.length) {
    const i = Math.max(0, Math.min(typeof t._navIdx === 'number' ? t._navIdx : t._navHist.length - 1, t._navHist.length - 1));
    try {
      const kind = JSON.parse(t._navHist[i]).kind;
      if (kind === 'posters' || kind === 'image' || kind === 'timeline') return kind;
    } catch {
      /* fall through to posts */
    }
  }
  return 'posts';
}

// Mirrors what postQB.shadow() computes internally, from the SAME mirrored
// tree (query-chips.ts's state half) — no second shadow copy lives in the store.
function liveActiveState() {
  const tree = store.getState().postQueryTree;
  return {
    f: tree ? buildShadow(tree) : [],
    search: store.getState().searchQuery,
    sort: store.getState().sortPost,
    multi: store.getState().multiOnly,
  };
}

function get(): HologramTabsModel | null {
  const tt = tabTitleOf;
  const icons = tabIcons;
  if (!tt || !icons) return null;
  const rawTabs: HologramTab[] | undefined = store.getState().tabs;
  if (!rawTabs) return null; // not yet loaded by viewer's initTabs()
  const activeTabId = store.getState().activeTabId;
  const allCount = store.getState().allPostsCount;
  const tabs = rawTabs.map((t) => {
    const isActive = t.id === activeTabId;
    // #21: a tag-management tab has no query state and no "current view" to
    // derive a title from -- checked first, active or not, since (unlike
    // trash) this is a per-tab flag rather than a global mode.
    if (t.specialKind === 'tags') {
      return { id: t.id, title: tagManageTitle, icon: t.pinned ? pinSvg : icons.tag, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    const kind = isActive ? (store.getState().activeImageTab ? 'image' : store.getState().browseMode === 'posters' ? 'posters' : store.getState().browseMode === 'trash' ? 'trash' : store.getState().browseMode === 'timeline' ? 'timeline' : 'posts') : navKindOf(t);
    // Trash (#268) — only ever the ACTIVE tab, since the trash records no history
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
      return { id: t.id, title: postersTitle, icon: t.pinned ? pinSvg : icons.user, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    // #183: timeline shares posts' own derived title (same postQB/search/sort
    // state — see tabs-builder.ts's snapshotEntry) rather than a fixed label the
    // way posters/trash get one — a "3 hits" count is just as meaningful reading
    // the feed as it is browsing the grid. Only the icon marks it apart.
    const s = isActive ? liveActiveState() : t.state || {};
    const derived = tt(s, { allCount });
    const icon = t.pinned ? pinSvg : kind === 'timeline' ? icons.date || icons.all : icons[derived.iconType] || icons.all;
    // t.title is never shown on a grid tab: with manual renaming dropped (#621), the
    // only title a tab can carry is the auto one an image entry stamped on it, and on
    // a grid the derived title is the truth (the auto one may be a frame stale, if the
    // tab navigated back before clearAutoTitle landed).
    return { id: t.id, title: derived.text, icon, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
  });
  return { tabs, closeTitle, newTitle };
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
    tagManageTitle = cfg.tagManageTitle || '';
  },
  get,
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};
subscribeKeys(['tabs', 'activeTabId', 'postQueryTree', 'searchQuery', 'sortPost', 'multiOnly', 'allPostsCount', 'browseMode', 'activeImageTab'], notify);
