// Confirm-overlay bridge — the imperative→declarative bridge for the shared confirm modal
// (#confirmOverlay). viewer.ts calls open(config) with a message + optional skip checkbox
// or keyword gate + onOk/onCancel callbacks; the React island (ConfirmHost) renders the
// modal, owns the keyword/skip local state, toggles #confirmOverlay's .show class (the
// CSS + setupModalChrome key on it), and calls the callbacks. The destructive LOGIC stays
// in viewer's onOk closures — this only moves WHEN it runs (callback vs the old flag-
// branching #confirmOk handler). Callbacks aren't serializable, so this is a dedicated
// bridge (like menu.ts / kind-menu.ts), NOT corpusStore. A real ES module (named
// exports), imported directly by its consumers (viewer.ts / Confirm.tsx).
//
// config: { message, okLabel, cancelLabel, skipLabel?, keywordPlaceholder?, keywordRequired?,
//           onOk(result:{skip}), onCancel? }  — see viewer.ts's three open sites.
let current: CorpusConfirmModel | null = null;
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
export function open(config: CorpusConfirmConfig) {
  current = Object.assign({ openId: ++seq }, config);
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
