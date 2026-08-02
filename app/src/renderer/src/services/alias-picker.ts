// Poster-picker bridge for "同一人物にする" (#23 St1) — the imperative→declarative
// bridge for the shared alias-merge dialog (posters/AliasPicker.tsx), same shape
// as prompt.ts/confirm.ts: callers open(config) with the candidate list + an
// onPick callback, the React component renders the dialog and owns the typed
// query, and this module only moves WHEN it runs (the actual merge — and its
// confirm gate — stays in poster-grid-builder.ts's onPick closure).
//
// A real ES module (named exports), imported directly by its one consumer
// (poster-grid-builder.ts) and by the host component.

export interface HologramAliasPickerCandidate {
  key: string;
  label: string;
  sub: string; // handle/platform badge text shown beside the name
}

export interface HologramAliasPickerConfig {
  title: string;
  placeholder: string;
  emptyLabel: string;
  candidates: HologramAliasPickerCandidate[];
  onPick(key: string): void;
  onCancel?(): void;
}

export interface HologramAliasPickerModel extends HologramAliasPickerConfig {
  openId: number;
}

let current: HologramAliasPickerModel | null = null;
let seq = 0;
const subs = new Set<() => void>();
function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}
export function open(config: HologramAliasPickerConfig) {
  current = { ...config, openId: ++seq };
  notify();
}
export function close() {
  current = null;
  notify();
}
export function get() {
  return current;
}
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
