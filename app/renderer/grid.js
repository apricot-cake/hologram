// Post-grid bridge — the imperative→declarative bridge for the VIRTUALIZED post
// grid (#postGrid). viewer.js owns the whole data pipeline (getFilteredPosts →
// groupRecords → viewGroups), the container's classes/CSS vars, and every
// delegated #postGrid event handler; the grid island (islands/grid) owns cell
// rendering + windowing (masonic). Kept SEPARATE from window.corpusStore for the
// same reason as menu.js/qf-pop.js: modelOf/keyOf carry CALLBACKS. Plain IIFE on
// window; loaded BEFORE viewer.js.
//
// model shape: { view, items: viewGroups, itemsKey, modelOf(group,i)→card model,
// keyOf(group)→stable key, labels, rowGutter, itemHeightEstimate }.
//  - itemsKey bumps ONLY when viewer rebuilt the viewGroups array (filter / sort /
//    search / data change). The island resets its positioner (cached cell
//    heights) on it — and re-syncs scrollTop, per the PoC blank-grid trap.
//  - paint (internal, bumps on every render/repaint) makes the island re-render
//    the VISIBLE cells so modelOf re-reads live viewer state (selection, clip,
//    inspected) without touching the positioner or scroll.
// render(null) hands the container back to the legacy path: the island unmounts
// its cells synchronously (flushSync) before the caller's next line runs.
(function () {
  'use strict';
  let current = null;
  let seq = 0;
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

  function render(model) {
    current = model ? { ...model, paint: ++seq } : null;
    notify();
  }
  function repaint() {
    if (!current) return;
    current = { ...current, paint: ++seq };
    notify();
  }
  // Merge a partial model update into the current one (live size-slider drags:
  // viewer patches columnWidth per input instead of a full renderPosts).
  function patch(partial) {
    if (!current) return;
    current = { ...current, ...partial, paint: ++seq };
    notify();
  }
  const isActive = () => current !== null;
  function get() {
    return current;
  } // stable ref between changes (prop-driven root render in the island)
  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  window.corpusGrid = { render, repaint, patch, isActive, get, subscribe };
})();
