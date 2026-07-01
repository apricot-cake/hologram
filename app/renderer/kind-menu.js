// 種別 (tag-kind) menu bridge — the imperative→declarative bridge for the work/
// character/general classification menu (right-click a tag chip in the edit picker /
// inspector / poster picker). viewer.js builds the row model (current kind, already-
// localized labels) and owns the pick/rename actions; the kind-menu React island
// subscribes and renders the glass popup. Kept SEPARATE from window.corpusStore for the
// same reason as menu.js: onPick/onRename carry CALLBACKS, which don't belong in the
// serializable reactive store. Plain IIFE on window (like store.js / menu.js); loaded
// BEFORE viewer.js.
//
// model shape: { x, y, header, renameTitle, rows, onPick(kind), onRename(kind) }.
// row shape: { kind, label, dot?, renameable?, checked? } | { sep: true }.
(function () {
  'use strict';
  let current = null; // model | null
  const subs = new Set();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };

  function open(model) {
    current = model;
    notify();
  }
  function close() {
    if (current) {
      current = null;
      notify();
    }
  }
  function get() {
    return current;
  } // stable ref between changes (useSyncExternalStore)
  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  window.corpusKindMenu = { open, close, get, subscribe };
})();
