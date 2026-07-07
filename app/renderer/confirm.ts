// Confirm-overlay bridge — the imperative→declarative bridge for the shared confirm modal
// (#confirmOverlay). viewer.js calls open(config) with a message + optional skip checkbox
// or keyword gate + onOk/onCancel callbacks; the React island (ConfirmHost) renders the
// modal, owns the keyword/skip local state, toggles #confirmOverlay's .show class (the
// CSS + setupModalChrome key on it), and calls the callbacks. The destructive LOGIC stays
// in viewer's onOk closures — this only moves WHEN it runs (callback vs the old flag-
// branching #confirmOk handler). Callbacks aren't serializable, so this is a dedicated
// bridge (like menu.js / kind-menu.js), NOT corpusStore.
//
// config: { message, okLabel, cancelLabel, skipLabel?, keywordPlaceholder?, keywordRequired?,
//           onOk(result:{skip}), onCancel? }  — see viewer.js's three open sites.
(function () {
  'use strict';
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
  function open(config: CorpusConfirmConfig) {
    current = Object.assign({ openId: ++seq }, config);
    notify();
  }
  function close() {
    current = null;
    notify();
  }
  window.corpusConfirm = {
    open,
    close,
    get: () => current,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
})();
