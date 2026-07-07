// Edit-overlay bridge — the imperative→declarative bridge for the bulk "add tags to
// selection" modal (#editOverlay/#editOverlayBox). Unlike the inspector's TagEditor,
// which persists every change immediately, this one stages tags in `editTags` (owned
// by viewer.js) and only writes them out on Save — Cancel/background-click discard
// the staging list untouched. viewer.js keeps every business rule (selection,
// persistence, undo) and the overlay's own show/hide + modal-chrome classList; the
// React island owns rendering #editOverlayBox's content. Kept SEPARATE from
// window.corpusStore for the same reason as menu.js/kind-menu.js/filter-popover.js/
// qf-pop.js/inspector.js: the model carries CALLBACKS. Plain IIFE on window (like
// store.js); loaded BEFORE viewer.js.
//
// model shape: see viewer.js's tagSelectedBtn handler for the full field list.
// openId is bumped only by open() (each time the modal opens fresh) so the mounted
// TagEditor resets its local picker-filter text between sessions; refresh() keeps the
// current openId so add/remove/toggle re-render in place without losing that text.
(function () {
  'use strict';
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

  function open(model: Omit<CorpusEditOverlayModel, 'openId'>) {
    current = { ...model, openId: ++seq };
    notify();
  }
  function refresh(partial: Record<string, unknown>) {
    if (!current) return;
    current = { ...current, ...partial };
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
  function subscribe(cb: () => void) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  window.corpusEditOverlay = { open, refresh, close, get, subscribe };
})();
