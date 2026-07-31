// Grid model sources — the imperative→declarative bridge for every VIRTUALIZED
// grid (library posts / posters / trash). orchestrator.ts owns the data pipeline and
// supplies what a gesture on a cell does (configureActions);
// the grid components own cell rendering + windowing (masonic). Kept SEPARATE from
// hologramStore for modelOf/keyOf specifically, which carry CALLBACKS (same
// reason as menu.js/qf-pop.js) — everything else (items, layout inputs) DOES live
// in hologramStore; these sources derive the rest of the model from it. A real ES
// module now — its exports are imported directly by viewer.ts and the grid
// components; hologramStore itself is a real ES module too (store.ts).

import { currentShape, DISPLAY_KEYS, gutterFor } from './display.ts';
import type { DisplayShape } from './display.ts';
import { get as storeGet, subscribe as storeSubscribe } from './store.ts';
import type { ZoomAnchor } from './zoom-anchor.ts';
//
// Both grids (post and poster) were converted from a PUSHED
// bridge (viewer calls render()/patch() with a full model) to a PULLED source
// (viewer only writes items/layout into hologramStore; the source derives the rest
// on get()). GridMount (_shared/VirtualGrid.tsx) only ever calls .get()/.subscribe()
// on its bridge prop — it never called render()/patch()/isActive(), those were
// viewer-only APIs — so this was a drop-in swap with zero changes to GridMount.
//
// model shape: { items, itemsKey, modelOf(item,i)→cell model, keyOf(item,i)→
// stable key, columnCount?, columnWidth?, rowGutter, itemHeightEstimate, … }.
//  - itemsKey bumps ONLY when the items array reference actually changed (filter /
//    sort / search / data change). The component resets its positioner (cached cell
//    heights) on it — and re-syncs scrollTop, per the PoC blank-grid trap.
//  - paint (internal, bumped on every get()) makes the component re-render even when
//    field VALUES repeat, since a fresh object ref is what React's bridge-driven
//    setState in GridMount keys off.

type PostGridConfig = { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; labels?: any; onAspect(cap: string, ar: string): void };
type PosterGridConfig = { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined };
type TrashGridConfig = Omit<PostGridConfig, 'onAspect'>;

// The layout half of a post-grid model, derived from the display shape (#618) plus
// the size axis. One function, three grids (library / trash), so a display change
// cannot land on one of them and not the other.
//
//  - columnCount pins the list to a single full-width column; the grid leaves it
//    unset so masonic treats columnWidth as a MINIMUM and stretches columns to fill
//    (the same math as the old CSS auto-fill minmax).
//  - `square` tells the host a cell is exactly one column wide AND high, which makes
//    its height estimate exact. True only for a BARE square grid — with 情報を表示 on
//    the metadata block hangs below the square, so the height is measured, not known.
//  - itemHeightEstimate is only ever a first guess (masonic measures what it renders);
//    it decides how far a deep-scroll restore lands before the real heights arrive.
function postLayout(shape: DisplayShape, gridSize: number, listThumb: number) {
  const infoBlock = 96; // rough height of the poster/excerpt/meta block under a square
  return {
    shape,
    // The small end of the size axis IS the overview zoom (#141): at that scale a cell
    // is all thumbnail, and a badge painted over it covers the thing it is counting.
    overview: !shape.list && gridSize < 96,
    columnCount: shape.list ? 1 : undefined,
    columnWidth: shape.list ? undefined : gridSize,
    square: shape.square && !shape.info,
    rowGutter: gutterFor(shape),
    itemHeightEstimate: shape.list ? Math.round(listThumb * 1.25) : shape.square ? gridSize + (shape.info ? infoBlock : 0) : Math.round(gridSize * 1.2),
    listThumb,
  };
}

// Post grid model source: items come from hologramStore('postGroups'), layout from the
// display axes plus hologramStore('gridSize'/'listThumb') via postLayout above.
// configure() sets the invariant callbacks once (modelOf/keyOf/onAspect never change
// identity meaningfully across renders — only items+layout do).
function makePostGridSource() {
  let config: PostGridConfig | null = null;
  let actions: HologramCardActions | undefined; // what a gesture ON a cell does (orchestrator.ts fills it in)
  let liveColumnWidth: number | null = null; // mid-drag override; deliberately not in hologramStore (see the type's doc comment)
  let zoomAnchor: ZoomAnchor | null = null; // the position Ctrl+wheel zoom wants held (#282) — same side channel as the live column width
  let lastItems: any;
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
  // hologramStore subscriptions (and duplicate notify() fan-out) if that changes.
  for (const k of ['postGroups', ...DISPLAY_KEYS, 'gridSize', 'listThumb']) storeSubscribe(k, notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = storeGet('postGroups');
    if (items == null) return null; // undefined (nothing rendered yet) or explicit null (grid empty)
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    const layout = postLayout(currentShape(), storeGet('gridSize') || 280, storeGet('listThumb') || 88);
    return {
      ...layout,
      items,
      itemsKey: itemsKeySeq,
      modelOf: config.modelOf,
      keyOf: config.keyOf,
      labels: config.labels,
      cardActions: actions,
      columnWidth: liveColumnWidth ?? layout.columnWidth,
      zoomAnchor,
      onAspect: config.onAspect,
      paint: ++paintSeq,
    } as HologramGridModel;
  }
  return {
    configure(cfg: PostGridConfig) {
      config = cfg;
    },
    configureActions(a: HologramCardActions) {
      actions = a;
    },
    setLiveColumnWidth(px: number | null) {
      liveColumnWidth = px;
      notify();
    },
    // Where the view should still be looking after the size change that is about
    // to follow (#282). Deliberately does NOT notify: the size change is what
    // makes the grid re-lay out, and the anchor has to be on the model it renders
    // from — announcing it on its own would only cost a render that changes
    // nothing. The component re-arms on the object's IDENTITY, so a repeat get()
    // between size changes hands it the same anchor and is correctly a no-op.
    setZoomAnchor(a: ZoomAnchor | null) {
      zoomAnchor = a;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const hologramPostGridSource = makePostGridSource();

// Poster grid model source: same shape as the post source, minus
// onAspect (poster avatars don't report a learned aspect ratio) and minus a
// live-drag override — the poster size slider already commits hologramIpc.setPref
// on every 'input' tick (services/orchestrator.ts's setupPosterSizeSlider has no
// separate mid-drag/commit split like the post slider), so writing hologramStore
// on every tick too is no NEW cost; get() just reads the settled value straight
// from the store like every other layout input.
function makePosterGridSource() {
  let config: PosterGridConfig | null = null;
  let actions: HologramCardActions | undefined;
  let lastItems: any;
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
  function computeModel(): HologramGridModel | null {
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
      cardActions: actions,
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
    } as HologramGridModel;
  }
  return {
    configure(cfg: PosterGridConfig) {
      config = cfg;
    },
    configureActions(a: HologramCardActions) {
      actions = a;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const hologramPosterGridSource = makePosterGridSource();

// Trash grid model source (#268) — the ゴミ箱 destination draws the SAME cards the
// library does, so it takes the post side's modelOf/keyOf/labels verbatim
// (orchestrator hands over post-grid-builder's cardModel) and derives its layout
// from the same density keys. Its items come from 'trashGroups', which
// services/trash-view.ts writes; nothing else differs, and deliberately so — a
// second card vocabulary for deleted posts is exactly the "二重 UI" the design
// rejected. No onAspect (the learned-aspect cache belongs to the library's own
// masonry pass), no live column width / zoom anchor (Ctrl+wheel zoom and the size
// slider drag both aim at the post grid).
function makeTrashGridSource() {
  let config: TrashGridConfig | null = null;
  let actions: HologramCardActions | undefined;
  let lastItems: any;
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
  for (const k of ['trashGroups', ...DISPLAY_KEYS, 'gridSize', 'listThumb']) storeSubscribe(k, notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = storeGet('trashGroups');
    if (items == null) return null; // undefined (never loaded) or explicit null (trash empty)
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    return {
      ...postLayout(currentShape(), storeGet('gridSize') || 280, storeGet('listThumb') || 88),
      items,
      itemsKey: itemsKeySeq,
      modelOf: config.modelOf,
      keyOf: config.keyOf,
      labels: config.labels,
      cardActions: actions,
      paint: ++paintSeq,
    } as HologramGridModel;
  }
  return {
    configure(cfg: TrashGridConfig) {
      config = cfg;
    },
    configureActions(a: HologramCardActions) {
      actions = a;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const hologramTrashGridSource = makeTrashGridSource();
