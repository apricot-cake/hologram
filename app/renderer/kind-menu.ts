// 種別 (tag-kind) menu bridge — the imperative→declarative bridge for the work/
// character/general classification menu (right-click a tag chip in the edit picker /
// inspector / poster picker). viewer.ts builds the row model (current kind, already-
// localized labels) and owns the pick/rename actions; the kind-menu React island
// subscribes and renders the glass popup. Kept SEPARATE from corpusStore for the
// same reason as menu.ts: onPick/onRename carry CALLBACKS, which don't belong in the
// serializable reactive store. A real ES module (named exports), imported directly
// by its consumers (viewer.ts / KindMenu.tsx).
//
// model shape: { x, y, header, renameTitle, rows, onPick(kind), onRename(kind) }.
// row shape: { kind, label, dot?, renameable?, checked? } | { sep: true }.
let current: CorpusKindMenuModel | null = null; // model | null
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

export function open(model: CorpusKindMenuModel) {
  current = model;
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
