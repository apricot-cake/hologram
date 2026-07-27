// Grid geometry service — pure column/size/slider-track math, extracted 1:1
// from viewer.js as the tenth "pure logic → service" slice of the viewer
// decomposition (最終形B). The post tile slider and the poster size slider
// each carried a private copy of the same formulas (pColsFor/tileColsFor,
// pSizeFor/tileSizeFor, and the nBig/nSmall/invert track derivation) — this
// module is the single owner. A real ES module (named exports), imported
// directly by viewer.ts; touches no DOM (containers are measured by the
// caller and passed in as metrics).

// Metrics contract: m = { W: container width px (floored fractional width —
// clientWidth rounds up half-pixels, which makes an exact-fill size 1px too
// wide and silently drops a column), g: gutter px }.

// How many columns fit at a given min column size (auto-fill minmax math —
// masonic's columnWidth is a minimum and columns stretch to fill, the same
// column-count formula as the old CSS grid).
export const colsFor = (size: number, m: HologramGridMetrics) => Math.max(1, Math.floor((m.W + m.g) / (size + m.g)));
// Exact-fit column size for a target column count.
export const sizeFor = (n: number, m: HologramGridMetrics) => Math.floor((m.W - (n - 1) * m.g) / n);
// Fewest columns whose exact-fit size still stays ≤ max. ceil — floor would
// offer a notch whose size clamps and never reflows.
export const minColsFor = (max: number, m: HologramGridMetrics) => Math.max(1, Math.ceil((m.W + m.g) / (max + m.g)));

// Derive a size-slider track that maps to COLUMN COUNTS, not raw px: the
// stretching grid only moves the layout at column-count thresholds, so
// mapping each detent to one column count makes every step visible (no dead
// zones). The track is inverted (right = larger = fewer columns).
//   st = { min, max, size } (the view's size axis + current value)
//   opts.minCols — hard floor for nBig (card view always allows 1 column).
// Returns { nBig, nSmall, single, value }; single = only one column count is
// geometrically possible (a one-stop slider conveys nothing → callers hide it).
export function sliderTrack(st: { min: number; max: number; size: number }, m: HologramGridMetrics, opts?: { minCols?: number }) {
  const nBig = (opts && opts.minCols) || minColsFor(st.max, m);
  const nSmall = Math.max(nBig, colsFor(st.min, m));
  const n = Math.min(nSmall, Math.max(nBig, colsFor(st.size, m)));
  return { nBig, nSmall, single: nBig === nSmall, value: nBig + nSmall - n };
}
// Un-invert a track value back to its target column count (self-inverse —
// the same formula maps count→value).
export const trackCols = (value: number, nBig: number, nSmall: number) => nBig + nSmall - value;

// Thumbnail width for a given display size: 60px buckets so cache keys don't
// fragment per drag pixel, clamped to the thumbnailer's serviceable range.
export const thumbW = (raw: number, min: number, max: number) => Math.min(max, Math.max(min, Math.ceil(raw / 60) * 60));
