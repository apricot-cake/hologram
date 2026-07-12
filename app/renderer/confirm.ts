// Confirm bridge — the imperative→declarative bridge for the shared confirm modal
// (a shadcn AlertDialog). Callers pass open(config) a message + optional skip checkbox
// or keyword gate + onOk/onCancel callbacks; the React island (ConfirmHost) renders the
// dialog, owns the keyword/skip local state, and calls the callbacks. The destructive
// LOGIC stays in the caller's onOk closures — this only moves WHEN it runs. Callbacks
// aren't serializable, so this is a dedicated bridge (like menu.ts / kind-menu.ts), NOT
// corpusStore. A real ES module (named exports), imported directly by its consumers
// (post-grid-builder.ts / selection-builder.ts / Confirm.tsx). ModalChrome (App.tsx)
// reads get()/subscribe() for the modal-open body class + titlebar tint.
//
// config: { message, description?, okLabel, cancelLabel, skipLabel?, keywordPlaceholder?,
//           keywordRequired?, onOk(result:{skip}), onCancel? }
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
