// Inspector bridge — the imperative→declarative bridge for the persistent right-column
// inspector panel (#postDetail/#postDetailBox: post detail + poster detail, including the
// always-live inline tag editor). viewer.ts keeps every business rule (persistence, undo,
// homonym detection, grouping, poster folders) and the panel's own hidden/insp-open/
// refreshTileSlider chrome; the React island owns rendering #postDetailBox's content.
// Kept SEPARATE from corpusStore for the same reason as menu.ts/kind-menu.ts/
// filter-popover.ts/qf-pop.ts: the model carries CALLBACKS. A real ES module (named
// exports), imported directly by its consumers (viewer.ts / Inspector.tsx).
//
// model shape (kind: 'post' | 'poster'): see viewer.ts's inspectorPostModel /
// inspectorPosterModel builders for the full field list. openId is an internal
// monotonic counter bumped only by open() (a fresh post/poster, or a full rebuild) —
// refresh() keeps the current openId so the mounted component re-renders in place
// (local state like the tag-input text and its filter query survive), matching the old
// behavior where only #ivTagChips/#ivTagPicker were touched by a tag mutation while a
// full showDetail()/showPosterDetail() rebuild (e.g. adopting a source tag) reset them.
let current: CorpusInspectorModel | null = null;
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

export function open(model: Omit<CorpusInspectorModel, 'openId'>) {
  // Omit<> collapses onto CorpusInspectorModel's `[extra: string]: any` index
  // signature (Pick/Omit over an indexed type loses the named required
  // properties), so the cast restores what's structurally true at runtime.
  current = { ...model, openId: ++seq } as CorpusInspectorModel;
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
