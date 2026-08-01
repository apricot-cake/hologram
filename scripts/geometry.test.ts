// Unit tests for the logic in geometry.ts. Verifies the column-count calculation
// (colsFor/sizeFor/minColsFor), the slider-track derivation (sliderTrack/trackCols =
// inversion convention), and the thumbnail width's 60px quantization (thumbW). Regression
// guard for the slice where the old viewer.js's pColsFor/tileColsFor (duplicate
// implementations) were consolidated into single ownership.

import { describe, expect, test } from 'vitest';
import * as G from '../app/src/renderer/src/services/geometry';

const m = { W: 1000, g: 14 }; // card-ish gutter

describe('colsFor / sizeFor: auto-fill minmax の列数式と往復整合', () => {
  test('1000px/gap14 に size200 は 4列', () => {
    expect(G.colsFor(200, m)).toBe(4);
  });

  test('ちょうど収まる境界（size239.5→floor）', () => {
    expect(G.colsFor(239, m)).toBe(4);
  });

  test('巨大 size でも最低1列', () => {
    expect(G.colsFor(5000, m)).toBe(1);
  });

  test('sizeFor: 4列の exact-fit は 239px', () => {
    expect(G.sizeFor(4, m)).toBe(239);
  });

  test('sizeFor: 1列はコンテナ幅そのまま', () => {
    expect(G.sizeFor(1, m)).toBe(1000);
  });

  // Feeding sizeFor's result back into colsFor gives the same column count (stable because both floor)
  test.each([1, 2, 3, 5, 8])('往復整合: %i列 → sizeFor → colsFor', (n) => {
    expect(G.colsFor(G.sizeFor(n, m), m)).toBe(n);
  });
});

// "The fewest columns that still fit within size≤max" uses ceil (floor would offer a notch
// that exceeds max = this is the regression point the old comment warned about)
describe('minColsFor', () => {
  test('max340 なら 1000px は最少3列', () => {
    expect(G.minColsFor(340, m)).toBe(3);
  });

  test('sizeFor(その列数) は max 以下', () => {
    expect(G.sizeFor(G.minColsFor(340, m), m)).toBeLessThanOrEqual(340);
  });

  test('1列足りる巨大 max は 1', () => {
    expect(G.minColsFor(2000, m)).toBe(1);
  });
});

describe('sliderTrack: nBig..nSmall のレンジ・現在値の clamp・反転規約', () => {
  test('poster card 相当（min150 max340）のトラック', () => {
    const tr = G.sliderTrack({ min: 150, max: 340, size: 200 }, m);
    expect(tr.nBig).toBe(3); // max340
    expect(tr.nSmall).toBe(6); // min150
    expect(tr.single).toBe(false);
    expect(tr.value).toBe(5); // size200 → 4 columns → 3+6-4 (right = inverted, so it's the largest)
    // trackCols is a self-inverse: maps value back to a column count
    expect(G.trackCols(tr.value, tr.nBig, tr.nSmall)).toBe(4);
  });

  test('現在 size がレンジ外（min 未満まで縮んだ保存値）でも value は端に clamp', () => {
    const tr = G.sliderTrack({ min: 150, max: 340, size: 40 }, m);
    expect(tr.value).toBe(tr.nBig); // most columns = smallest value under the inversion
  });

  test('minCols=1（card ビューの「常に1列を許す」）が nBig の下限を上書き', () => {
    const tr = G.sliderTrack({ min: 240, max: 340, size: 280 }, m, { minCols: 1 });
    expect(tr.nBig).toBe(1);
    expect(tr.nSmall).toBe(G.colsFor(240, m)); // nSmall still derives from min
  });

  test('幅が狭く1択しかない → single=true（呼び出し側がスライダー行を隠す契約）', () => {
    const narrow = { W: 200, g: 10 };
    const tr = G.sliderTrack({ min: 150, max: 340, size: 200 }, narrow);
    expect(tr.single).toBe(true);
    expect(tr.nBig).toBe(tr.nSmall);
  });
});

describe('thumbW: 60px バケット量子化＋clamp（asset キャッシュキーの断片化防止）', () => {
  test('60の倍数へ切り上げ', () => {
    expect(G.thumbW(252, 180, 960)).toBe(300);
  });

  test('ちょうど倍数はそのまま', () => {
    expect(G.thumbW(300, 180, 960)).toBe(300);
  });

  test('min clamp', () => {
    expect(G.thumbW(10, 180, 960)).toBe(180);
  });

  test('max clamp', () => {
    expect(G.thumbW(5000, 180, 960)).toBe(960);
  });

  // Byte-for-byte equivalence with the old viewer.js implementation
  // (Math.min(960, Math.max(180, Math.ceil((s*1.4)/60)*60))): confirmed parity with
  // representative values (tile default 180, boundary points). #141 lowered only
  // tileThumbW's floor from 180→120, so parity is a claim about the formula "in the range
  // that doesn't hit the floor".
  test.each([120, 180, 300, 420, 900])('旧 tileThumbW とパリティ (size=%i)', (s) => {
    const legacy = Math.min(960, Math.max(180, Math.ceil((s * 1.4) / 60) * 60));
    expect(G.thumbW(s * 1.4, 180, 960)).toBe(legacy);
  });
});

// Degradation guard for #141's widening of the tile floor from 120→48
describe('俯瞰ズーム', () => {
  const wide = { W: 1280, g: 8 };

  // Even with a floor of 48, the track still holds up as a column-count range (doesn't
  // become single, and the notch at the small end really does reach down to tiny tiles)
  test('min48 でトラックが single にならない', () => {
    expect(G.sliderTrack({ min: 48, max: 400, size: 180 }, wide).single).toBe(false);
  });

  test('最多列は min48 由来', () => {
    expect(G.sliderTrack({ min: 48, max: 400, size: 180 }, wide).nSmall).toBe(G.colsFor(48, wide));
  });

  // The left end of the inverted track (value=nBig) = the most columns. At 1280px/gap8,
  // 23 columns = 17 rows tall means about 390 items per screen, which makes "visually
  // scanning the whole set" work.
  test('最小 notch は20列以上（1画面 数百枚）', () => {
    const tr = G.sliderTrack({ min: 48, max: 400, size: 180 }, wide);
    expect(G.trackCols(tr.nBig, tr.nBig, tr.nSmall)).toBeGreaterThanOrEqual(20);
  });

  // size doesn't degrade even after round-tripping to the edge notch (if clamp crushed it, it'd collapse to 1 column)
  test('最小 notch の exact-fit が 48〜96px に収まる', () => {
    const tr = G.sliderTrack({ min: 48, max: 400, size: 180 }, wide);
    const smallest = G.sizeFor(G.trackCols(tr.nBig, tr.nBig, tr.nSmall), wide);
    expect(smallest).toBeGreaterThanOrEqual(48);
    expect(smallest).toBeLessThan(96);
  });

  // Thumbnail floor is 120 (48*1.4≈67 rounded to the 60px bucket). The thumbnailer serves
  // from 64px, so the main side needs no changes.
  test('tileThumbW 下限は120', () => {
    expect(G.thumbW(48 * 1.4, 120, 960)).toBe(120);
  });

  test('既定サイズ180のバケットは不変（300）', () => {
    expect(G.thumbW(180 * 1.4, 120, 960)).toBe(300);
  });
});
