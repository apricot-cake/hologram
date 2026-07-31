// The display axes (#618) — "how do I see it", decomposed into orthogonal keys.
//
// P2② shipped the display popover as a FACADE over a single 3-value store key
// (`view` = card/tile/list): "情報を表示" flipped the thumbnail's SHAPE, the GIF
// playback and the image quality along with the metadata, because all four rode one
// value. This module is the replacement — three independent keys, five legal states:
//
//   grid + 元比率 + 情報あり   (Pinterest / Notion ギャラリー)
//   grid + 元比率 + 情報なし   (Pinterest / Eagle 既定)
//   grid + 正方形 + 情報あり   (EC グリッド / Eagle のファイル名表示)
//   grid + 正方形 + 情報なし   (pixiv / Instagram / X メディアタブ)
//   list                       (行そのものが情報なので2スイッチは無効)
//
// Naming: only the SQUARE side is named — "元の比率のまま敷き詰める" needs no term of
// its own, which is why there is no `masonry`/`waterfall` in the codebase (2026-07-19
// 確定, #154). `square` is Mac 写真.app の「正方形のサムネール」と同語.
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from './store.ts';

/** The three store keys that make up a display state. */
export const DISPLAY_KEYS = ['layout', 'squareThumbs', 'showInfo'] as const;

export interface DisplayShape {
  /** Rows instead of a grid. Both switches below are inert (and disabled) while true. */
  list: boolean;
  /** Grid: crop every thumbnail to a square, so the grid is an even lattice. */
  square: boolean;
  /** Grid: draw the poster / excerpt / meta block under the thumbnail. */
  info: boolean;
}

/** Defaults = grid, original aspect, info on (what the old `view: 'card'` drew). */
export function currentShape(): DisplayShape {
  return {
    list: storeGet('layout') === 'list',
    square: storeGet('squareThumbs') === true,
    info: storeGet('showInfo') !== false,
  };
}

/** Fires on any of the three keys — callers that re-derive the whole shape. */
export function subscribeShape(cb: () => void): () => void {
  const unsubs = DISPLAY_KEYS.map((k) => storeSubscribe(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

/** A value that changes whenever the shape does (useSyncExternalStore snapshots). */
export function shapeSnapshot(): string {
  const s = currentShape();
  return `${s.list ? 'list' : 'grid'}|${s.square ? 'sq' : 'ar'}|${s.info ? 'info' : 'bare'}`;
}

// --- The size axis ----------------------------------------------------------
// One size per layout: the grid's is a COLUMN WIDTH (the square edge, when squares
// are on — same number either way), the list's is its thumbnail width.
//
// The grid's floor depends on `info`, and only on it: at the small end of the axis a
// cell is pure thumbnail — that IS the overview zoom (#141) — and a metadata block
// has nowhere to go there. So turning 情報を表示 on raises the floor (and pulls an
// overview-sized grid up to it); turning it off opens the small end again.
export const GRID_MAX = 560;
export const GRID_MIN_BARE = 48;
export const GRID_MIN_INFO = 200;
export const LIST_MIN = 56;
export const LIST_MAX = 200;

export const gridMin = (info: boolean): number => (info ? GRID_MIN_INFO : GRID_MIN_BARE);

/** Clamp a grid column width into the range the current `info` switch allows. */
export const clampGridSize = (px: number, info: boolean): number => Math.max(gridMin(info), Math.min(GRID_MAX, px));

/**
 * The gap between cells, in px. One formula, two readers: the grid model hands it to
 * masonic as the row/column gutter, and the size track needs the same number to work
 * out how many columns fit. A bare square lattice packs tightest (pixiv / X メディア
 * タブ); anything carrying text needs room to read as separate cards.
 */
export const gutterFor = (shape: DisplayShape): number => (shape.list ? 14 : shape.square && !shape.info ? 8 : 16);

/** Set one axis. Writing the store is the whole action — every reader subscribes. */
export function setLayout(list: boolean): void {
  storeSet('layout', list ? 'list' : 'grid');
}
export function setSquare(on: boolean): void {
  storeSet('squareThumbs', on);
}
export function setInfo(on: boolean): void {
  storeSet('showInfo', on);
}
