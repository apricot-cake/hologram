// Context-menu controller — the imperative→declarative bridge for the right-click
// menus. viewer.ts calls open({ items, x, y }, onPick) to show a
// glass menu; the context-menu React island subscribes and renders it. Kept SEPARATE
// from hologramStore because the menu carries an onPick CALLBACK (a function),
// which doesn't belong in the serializable reactive store. A real ES module (named
// exports), imported directly by its consumers (viewer.ts / query-chips.ts / ContextMenu.tsx).
//
// item shape: { label, act, danger?, checked?, sep?, manage?, ...extra }. onPick(item)
// runs the viewer-side action; if it RETURNS a new items array the menu stays open and
// re-renders (toggle rows — e.g. assign-to-folder), otherwise the menu closes.
let current: HologramContextMenuModel | null = null; // { items, x, y, onPick } | null
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

// biome-ignore lint/suspicious/noConfusingVoidType: void is the intentional "close the menu" return (same as HologramContextMenu in globals.d.ts)
export function open(model: { items?: HologramMenuItem[]; x?: number; y?: number } | null, onPick?: (item: HologramMenuItem) => HologramMenuItem[] | void) {
  current = { items: (model && model.items) || [], x: (model && model.x) || 0, y: (model && model.y) || 0, onPick: onPick || null };
  notify();
}
export function close() {
  if (current) {
    current = null;
    notify();
  }
}
export function pick(item: HologramMenuItem) {
  if (!current || !current.onPick) {
    close();
    return;
  }
  const ref = current;
  const next = current.onPick(item);
  if (current !== ref) return; // onPick opened a DIFFERENT menu (card→folder) or closed it — leave that as-is
  if (Array.isArray(next)) {
    current = { ...current, items: next };
    notify();
  } // stay open, re-render (toggle rows)
  else close();
}
export function get() {
  return current;
} // stable ref between changes (useSyncExternalStore)
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
