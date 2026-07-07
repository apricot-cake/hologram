// Active-bar bridge — the imperative→declarative bridge for the query-builder frames
// (#postActiveBar / #posterActiveBar): the nav 戻る/進む buttons, the フィルター title,
// the empty-bar hint, the result count, the リセット button, and the ⓘ help popover.
// The chips themselves (#queryChips / #posterQueryChips) stay their OWN island
// (query-chips) — those containers keep viewer's delegated click/contextmenu handlers, so
// the activebar island renders only the FRAME around them (portaled into static sub-mounts
// that sit beside the chips containers, never replacing them).
//
// viewer.js keeps ALL logic: buildActivebarModel() aggregates the current state (nav
// canBack/canForward, viewGroups/posterList counts, each builder's hasQuery + search) and
// pushActivebar() renders it. The count/reset/empty/nav are pure data; nav/reset/help need
// to CALL back into viewer, so (unlike sidebar/selection-bar) the model carries callbacks
// (onNavBack / onNavFwd / onReset / onPosterReset) — like confirm.js, this is a dedicated
// bridge, not corpusStore. A fresh full model each render (viewer rebuilds it); the island
// diffs it.
//
// model shape: see viewer.js's buildActivebarModel() and CorpusActivebarModel in
// islands/types/globals.d.ts. Plain IIFE on window (like selection-bar.js); loaded BEFORE
// viewer.js.
(function () {
  'use strict';
  let current = null;
  const subs = new Set();
  window.corpusActivebar = {
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
