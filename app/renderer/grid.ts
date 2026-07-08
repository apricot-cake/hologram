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

  window.corpusPosterGrid = makeGridBridge(); // posters (#posterGrid) — still pushed; posts moved to a pulled source below (P4-B slice⑩)

  // Post grid model source (P4-B slice⑩): unlike the pushed bridges above, this is
  // PULLED — items come from corpusStore('postGroups'), layout is derived from
  // corpusStore('view'/'cardSize'/'tileSize'/'listThumb') using the same formulas
  // renderPosts() used to compute inline. configure() sets the invariant callbacks
  // once; get()/subscribe() satisfy the same shape GridMount already consumes
  // (_shared/VirtualGrid.tsx only ever calls .get()/.subscribe() on its bridge
  // prop, never .render()/.patch()/.isActive() — those were viewer-only, so a
  // pulled source is a drop-in swap with zero changes to GridMount itself).
  function makePostGridSource(): CorpusPostGridSource {
    let config: { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; labels: any; onAspect(cap: string, ar: string): void } | null = null;
    let liveColumnWidth: number | null = null; // mid-drag override; deliberately not in corpusStore (see the type's doc comment)
    let lastItems: any = undefined;
    let itemsKeySeq = 0; // bumps only when the items reference actually changes — mirrors the old push-time itemsKey bump
    let paintSeq = 0;
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
    // Store-key listeners are wired ONCE (not per subscribe() caller) — there's a
    // single consumer (GridMount) in practice, but this avoids stacking duplicate
    // corpusStore subscriptions (and duplicate notify() fan-out) if that changes.
    for (const k of ['postGroups', 'view', 'cardSize', 'tileSize', 'listThumb']) window.corpusStore.subscribe(k, notify);
    function computeModel(): CorpusGridModel | null {
      if (!config) return null;
      const items = window.corpusStore.get('postGroups');
      if (items == null) return null; // undefined (nothing rendered yet) or explicit null (grid empty)
      if (items !== lastItems) {
        lastItems = items;
        itemsKeySeq++;
      }
      const view = window.corpusStore.get('view') || 'card';
      const cardSize = window.corpusStore.get('cardSize');
      const tileSize = window.corpusStore.get('tileSize');
      const listThumb = window.corpusStore.get('listThumb');
      const computedColumnWidth = view === 'tile' ? tileSize : view === 'card' ? cardSize : undefined;
      return {
        view,
        items,
        itemsKey: itemsKeySeq,
        modelOf: config.modelOf,
        keyOf: config.keyOf,
        labels: config.labels,
        columnCount: view === 'list' ? 1 : undefined,
        columnWidth: liveColumnWidth ?? computedColumnWidth,
        square: view === 'tile',
        rowGutter: view === 'list' ? 14 : view === 'tile' ? 8 : 16,
        itemHeightEstimate: view === 'list' ? Math.round(listThumb * 1.25) : view === 'tile' ? tileSize : Math.round(cardSize * 1.2),
        onAspect: config.onAspect,
        paint: ++paintSeq,
      } as CorpusGridModel;
    }
    return {
      configure(cfg) {
        config = cfg;
      },
      setLiveColumnWidth(px) {
        liveColumnWidth = px;
        notify();
      },
      get: computeModel,
      subscribe(cb) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    };
  }
  window.corpusPostGridSource = makePostGridSource();
})();
