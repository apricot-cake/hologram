// Tag-pop bridge — the imperative→declarative bridge for the tag picker pop
// (Issue #22): the single popup opened from a card's 🏷, the inspector's ✎, or the
// selection bar's "タグを追加", replacing the inspector's always-live TagEditor AND
// the bulk edit-overlay modal. Mirrors inspector.ts's shape (NOT bridge.ts's
// makeCallbackBridge — that has no refresh()): open() bumps openId so the mounted
// island remounts (resets the picker's local filter text — a fresh card/selection),
// while refresh() keeps the current openId so a tag mutation re-renders in place
// (input text + picker scroll survive). orchestrator.ts keeps every business rule
// (persistence, undo, homonym detection, bulk staging); the React island
// (TagPop.tsx) only draws whatever this bridge currently holds.
let current: CorpusTagPopModel | null = null;
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

export function open(model: Omit<CorpusTagPopModel, 'openId'>) {
  current = { ...model, openId: ++seq } as CorpusTagPopModel;
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
