// The imperative→declarative bridge for "ウェブで探す" entry points OUTSIDE the toolbar
// (#207's own "投稿者・タグの文脈メニュー...パネル1個・入口複数" design) — same
// current/subs/notify shape as services/menu.ts and services/kind-menu.ts, so a caller
// that only has a click point (x, y) and a one-off condition tree (e.g. a single 'user'
// or 'tag' leaf) can pop the SAME WebSearchPanel content anchored at that point, without
// owning a PopoverTrigger of its own. WebSearchPanel.tsx's WebSearchContextPanelHost is
// the sole reader (subscribe/get); poster-grid-builder.ts / kind-menu-builder.ts are the
// callers (open).
export interface WebSearchContextModel {
  tree: HologramQueryGroup;
  x: number;
  y: number;
}
let current: WebSearchContextModel | null = null;
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

export function open(tree: HologramQueryGroup, x: number, y: number) {
  current = { tree, x, y };
  notify();
}
export function close() {
  if (current) {
    current = null;
    notify();
  }
}
export function get() {
  return current;
} // stable ref between changes (useSyncExternalStore)
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
