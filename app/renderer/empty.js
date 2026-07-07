// Empty-state bridge — the imperative→declarative bridge for #emptyState (the "no posts
// yet" / "no results" placeholder shown when the grid is empty). viewer.js keeps the
// container's show/hide (empty.style.display) + the delegated #emptyState click handler
// (emptyImportBtn / emptyResetBtn); the React island renders the message + CTA button from
// the model. No callbacks — the buttons keep their old IDs so viewer's delegation fires
// unchanged (same as the selection-bar bridge).
//
// model: 'firstRun' | 'filtered' | 'posterFirstRun' | null — the variant only; the island
// owns the i18n labels (like GlassSelect / SectionTitle). Plain IIFE on window (like
// store.js); loaded BEFORE viewer.js.
(function () {
  'use strict';
  let current = null;
  const subs = new Set();
  window.corpusEmpty = {
    render(model) {
      current = model || null;
      for (const cb of [...subs]) {
        try {
          cb();
        } catch (_e) {
          /* ignore */
        }
      }
    },
    get() {
      return current;
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
})();
