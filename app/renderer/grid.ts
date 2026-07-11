// Grid model sources — the imperative→declarative bridge for every VIRTUALIZED
// grid (#postGrid / #posterGrid). viewer.js owns the data pipeline, the
// container's classes/CSS vars, and every delegated container event handler;
// the grid islands own cell rendering + windowing (masonic). Kept SEPARATE from
// corpusStore for modelOf/keyOf specifically, which carry CALLBACKS (same
// reason as menu.js/qf-pop.js) — everything else (items, layout inputs) DOES live
// in corpusStore; these sources derive the rest of the model from it. A real ES
// module now — its exports are imported directly by viewer.ts and the grid
// islands; corpusStore itself is a real ES module too (store.ts).

import { get as storeGet, subscribe as storeSubscribe } from './store.ts';
//
// P4-B slice⑩ (post) and slice⑫ (poster) converted both grids from a PUSHED
// bridge (viewer calls render()/patch() with a full model) to a PULLED source
// (viewer only writes items/layout into corpusStore; the source derives the rest
// on get()). GridMount (_shared/VirtualGrid.tsx) only ever calls .get()/.subscribe()
// on its bridge prop — it never called render()/patch()/isActive(), those were
// viewer-only APIs — so this was a drop-in swap with zero changes to GridMount.
//
// model shape: { items, itemsKey, modelOf(item,i)→cell model, keyOf(item,i)→
// stable key, columnCount?, columnWidth?, rowGutter, itemHeightEstimate, … }.
//  - itemsKey bumps ONLY when the items array reference actually changed (filter /
//    sort / search / data change). The island resets its positioner (cached cell
//    heights) on it — and re-syncs scrollTop, per the PoC blank-grid trap.
//  - paint (internal, bumped on every get()) makes the island re-render even when
//    field VALUES repeat, since a fresh object ref is what React's bridge-driven
//    setState in GridMount keys off.

type PostGridConfig = { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; labels: any; onAspect(cap: string, ar: string): void };
type PosterGridConfig = { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; tagTitle: string; infoTitle: string };

// Post grid model source (P4-B slice⑩): items come from corpusStore('postGroups'),
// layout is derived from corpusStore('view'/'cardSize'/'tileSize'/'listThumb')
// using the same formulas renderPosts() used to compute inline. configure() sets
// the invariant callbacks once (modelOf/keyOf/labels/onAspect never change
// identity meaningfully across renders — only items+layout do).
function makePostGridSource() {
  let config: PostGridConfig | null = null;
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
  for (const k of ['postGroups', 'view', 'cardSize', 'tileSize', 'listThumb']) storeSubscribe(k, notify);
  function computeModel(): CorpusGridModel | null {
    if (!config) return null;
    const items = storeGet('postGroups');
    if (items == null) return null; // undefined (nothing rendered yet) or explicit null (grid empty)
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    const view = storeGet('view') || 'card';
    const cardSize = storeGet('cardSize');
    const tileSize = storeGet('tileSize');
    const listThumb = storeGet('listThumb');
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
    configure(cfg: PostGridConfig) {
      config = cfg;
    },
    setLiveColumnWidth(px: number | null) {
      liveColumnWidth = px;
      notify();
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const corpusPostGridSource = makePostGridSource();

// Poster grid model source (P4-B slice⑫): same shape as the post source, minus
// onAspect (poster avatars don't report a learned aspect ratio) and minus a
// live-drag override — the poster size slider already commits corpusIpc.setPref
// on every 'input' tick (renderer/orchestrator.ts's setupPosterSizeSlider has no
// separate mid-drag/commit split like the post slider), so writing corpusStore
// on every tick too is no NEW cost; get() just reads the settled value straight
// from the store like every other layout input.
function makePosterGridSource() {
  let config: PosterGridConfig | null = null;
  let lastItems: any = undefined;
  let itemsKeySeq = 0;
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
  for (const k of ['posterGroups', 'posterView', 'posterTileSize', 'posterCardSize']) storeSubscribe(k, notify);
  function computeModel(): CorpusGridModel | null {
    if (!config) return null;
    const items = storeGet('posterGroups');
    if (items == null) return null; // undefined until the first renderPosters() — after that it's always an array (possibly empty), never explicitly cleared to null (unlike posts, poster has no innerHTML-clear ordering constraint to preserve)
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    const view = storeGet('posterView') || 'card';
    const posterTileSize = storeGet('posterTileSize');
    const posterCardSize = storeGet('posterCardSize');
    return {
      items,
      itemsKey: itemsKeySeq,
      modelOf: config.modelOf,
      keyOf: config.keyOf,
      tagTitle: config.tagTitle,
      infoTitle: config.infoTitle,
      // list: one full-width row column, gap 4. tile: squares packed by minimum
      // width posterTileSize, gap 10. card: avatar-led columns of minimum width
      // posterCardSize, gap 14 — masonic stretches columns to fill, the same
      // math as the old CSS auto-fill minmax (mirrors the post source's formula
      // shape with poster's own numbers — see the old pushPosterModel()).
      columnCount: view === 'list' ? 1 : undefined,
      columnWidth: view === 'tile' ? posterTileSize : view === 'card' ? posterCardSize : undefined,
      square: view === 'tile', // meta overlays the square avatar → cell height = column width
      rowGutter: view === 'list' ? 4 : view === 'tile' ? 10 : 14,
      itemHeightEstimate: view === 'list' ? 52 : Math.round(posterCardSize * 1.35),
      paint: ++paintSeq,
    } as CorpusGridModel;
  }
  return {
    configure(cfg: PosterGridConfig) {
      config = cfg;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const corpusPosterGridSource = makePosterGridSource();
