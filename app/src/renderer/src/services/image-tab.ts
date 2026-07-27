// Image-tab model source — converts #imageTabView off the old push
// (viewer.js built the React model and called render(model) on it from ~8 call
// sites: showImageTab / hideImageTabView / index step / inspector toggle /
// library refresh) to a PULLED source, the same shape as the grid sources
// (renderer/grid.ts). viewer.js writes only the tab IDENTITY into hologramStore's
// 'activeImageTab' (id/recs/idx — the one piece of tab state migrated ahead of the
// full tabs→store move); get() derives everything else: the gallery items (via
// hologramRecords.imageTabGroup, crossed with posts-data.ts so a deleted post
// degrades to the missing state live with no viewer push — exactly what
// posts-data.ts's doc comment anticipated) and inspectorOpen (hologramStore's
// 'inspectedKey', already the single source for "is the inspector open" since the
// state→store phase). Commands (index step / inspector toggle / close tab) dispatch
// back to viewer.ts via callbacks handed in through configure() (onIndexChange/
// onToggleInspector/onCloseTab), mirroring the query-chips / TabBarEvents
// event-half pattern — this file only computes, it never mutates tab state.
// Real ES module (named export `hologramImageTabSource`) — imported directly by
// image-tab/index.tsx (components) and viewer.ts (configure). The former dispatch
// through viewer.ts's old shared bridge was DI'd away when image-tab-builder.ts
// took over supplying the callbacks.
import { get as getPostsData, subscribe as subscribePostsData } from './posts-data.ts';
import { imageTabGroup } from './records.ts';
import { get as storeGet, subscribe as storeSubscribe } from './store.ts';

type Gallery = { buildGroupGalleryItems(g: any): { src: string; alt: string; video: boolean }[] };
let gallery: Gallery | null = null;
let labels: Record<string, string> | null = null;
let onIndexChange: ((i: number) => void) | null = null;
let onToggleInspector: (() => void) | null = null;
let onCloseTab: (() => void) | null = null;

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

function byIdMap() {
  const m = new Map<string, any>();
  for (const p of getPostsData()) m.set(p.captureId, p);
  return m;
}

function dispatchIndex(i: number) {
  if (onIndexChange) onIndexChange(i);
}
function dispatchToggleInspector() {
  if (onToggleInspector) onToggleInspector();
}
function dispatchClose() {
  if (onCloseTab) onCloseTab();
}

function get(): HologramImageTabModel | null {
  const active = storeGet('activeImageTab');
  if (!active || !gallery || !labels) return null;
  const byId = byIdMap();
  const g = imageTabGroup({ id: active.id, recs: active.recs }, (id) => byId.get(id));
  if (!g) return { items: [], idx: 0, missing: true, labels, onCloseTab: dispatchClose };
  const items = gallery.buildGroupGalleryItems(g);
  if (!items.length) return { items: [], idx: 0, missing: true, labels, onCloseTab: dispatchClose };
  return {
    items,
    idx: Math.max(0, Math.min(active.idx, items.length - 1)),
    inspectorOpen: storeGet('inspectedKey') != null,
    labels,
    onIndexChange: dispatchIndex,
    onToggleInspector: dispatchToggleInspector,
    onCloseTab: dispatchClose,
  };
}

export const hologramImageTabSource = {
  configure(cfg: { gallery: Gallery; labels: Record<string, string>; onIndexChange: (i: number) => void; onToggleInspector: () => void; onCloseTab: () => void }) {
    gallery = cfg.gallery;
    labels = cfg.labels;
    onIndexChange = cfg.onIndexChange;
    onToggleInspector = cfg.onToggleInspector;
    onCloseTab = cfg.onCloseTab;
  },
  get,
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },
};
for (const k of ['activeImageTab', 'inspectedKey']) storeSubscribe(k, notify);
subscribePostsData(notify);
