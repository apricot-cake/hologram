// Grid bridges — the imperative→declarative bridge for every VIRTUALIZED grid
// (#postGrid / #posterGrid / #collectionGrid). viewer.js owns the data pipeline,
// the container's classes/CSS vars, and every delegated container event handler;
// the grid islands own cell rendering + windowing (masonic). Kept SEPARATE from
// window.corpusStore for the same reason as menu.js/qf-pop.js: modelOf/keyOf
// carry CALLBACKS. Plain IIFE on window; loaded BEFORE viewer.js.
//
// model shape: { items, itemsKey, modelOf(item,i)→cell model, keyOf(item,i)→
// stable key, columnCount?, columnWidth?, rowGutter, itemHeightEstimate, … }.
//  - itemsKey bumps ONLY when viewer rebuilt the items array (filter / sort /
//    search / data change). The island resets its positioner (cached cell
//    heights) on it — and re-syncs scrollTop, per the PoC blank-grid trap.
//  - paint (internal, bumps on every render/patch) makes the island re-render
//    the VISIBLE cells without touching the positioner or scroll. Selection and
//    inspected are corpusStore subscriptions inside Cell now (not live reads
//    driven by paint), so there is no repaint()-for-a-class-change primitive
//    anymore — a full render() is the only way to bump paint.
// render(null) hands the container back to the legacy path: the island unmounts
// its cells synchronously (flushSync) before the caller's next line runs.
(function () {
  'use strict';
  function makeGridBridge(): CorpusGridBridge {
    let current: CorpusGridModel | null = null;
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

    function render(model: Omit<CorpusGridModel, 'paint'> | null) {
      // Omit<> collapses onto CorpusGridModel's `[extra: string]: any` index signature
      // (a known TS limitation — Pick/Omit over an indexed type loses the named
      // required properties), so the spread's inferred type undercounts; the cast
      // just restores what's structurally true at runtime.
      current = model ? ({ ...model, paint: ++seq } as CorpusGridModel) : null;
      notify();
    }
    // Merge a partial model update into the current one (live size-slider drags:
    // viewer patches columnWidth per input instead of a full re-render).
    function patch(partial: Partial<CorpusGridModel>) {
      if (!current) return;
      current = { ...current, ...partial, paint: ++seq };
      notify();
    }
    const isActive = () => current !== null;
    function get() {
      return current;
    } // stable ref between changes (prop-driven root render in the island)
    function subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    }
    return { render, patch, isActive, get, subscribe };
  }

  window.corpusGrid = makeGridBridge(); // posts (#postGrid)
  window.corpusPosterGrid = makeGridBridge(); // posters (#posterGrid)
})();
