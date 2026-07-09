// Edit-overlay bridge — the imperative→declarative bridge for the bulk "add tags to
// selection" modal (#editOverlay/#editOverlayBox). Unlike the inspector's TagEditor,
// which persists every change immediately, this one stages tags in `editTags` (owned
// by viewer.ts) and only writes them out on Save — Cancel/background-click discard
// the staging list untouched. viewer.ts keeps every business rule (selection,
// persistence, undo) and the overlay's own show/hide + modal-chrome classList; the
// React island owns rendering #editOverlayBox's content. Kept SEPARATE from
// corpusStore for the same reason as menu.ts/kind-menu.ts/filter-popover.ts/
// qf-pop.ts/inspector.ts: the model carries CALLBACKS. A real ES module (named
// exports), imported directly by its consumers (viewer.ts / bulk-edit.ts / EditOverlay.tsx).
//
// model shape: see viewer.ts's tagSelectedBtn handler for the full field list.
// openId is bumped only by open() (each time the modal opens fresh) so the mounted
// TagEditor resets its local picker-filter text between sessions; refresh() keeps the
// current openId so add/remove/toggle re-render in place without losing that text.
let current: CorpusEditOverlayModel | null = null;
let seq = 0;
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

export function open(model: Omit<CorpusEditOverlayModel, 'openId'>) {
  current = { ...model, openId: ++seq };
  notify();
}
export function refresh(partial: Record<string, unknown>) {
  if (!current) return;
  current = { ...current, ...partial };
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
