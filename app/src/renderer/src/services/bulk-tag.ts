// Bulk tag dialog bridge — the imperative→declarative bridge for "タグを追加"
// on the selection bar (P2⑦). Same shape as prompt.ts/confirm.ts: the renderer
// side pushes a config, the React component (BulkTagDialog) draws it.
//
// Unlike the tag-pop it replaces, this bridge carries NO staged tag list. The
// staging is the dialog's own React state, so there is no module-level mirror to
// keep in step and no refresh() round-trip after every add/remove — the reason
// the retired bulk path needed both a staging module and a recompute-and-push
// helper. The renderer keeps what only it can do: the tag vocabulary
// (pickerData), the kind menu, and the persistence/undo/toast in onApply
// (bulk-tag-builder.ts).
let current: HologramBulkTagModel | null = null;
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

export function open(config: HologramBulkTagConfig) {
  current = Object.assign({ openId: ++seq }, config);
  notify();
}
export function close() {
  if (!current) return;
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
