// Unit tests for the logic in marquee.ts (#484 drag range selection, #242 empty-space click).
// Covers only the judging part: rect × cell array → the resulting selected index set.
// The gesture itself (the actual mousedown→drag→mouseup and auto-scroll behavior) is out of
// scope for automated tests because synthetic mouse events don't work on the virtual grid =
// #484's body says "verifying with a real mouse is assumed". What's guarded here is the
// intersection-test contract (intersection, not containment / edges are exclusive / returned
// in ascending order), the auto-scroll speed curve, and the boundary at which the same
// press-down becomes a drag versus a click.

import { describe, expect, test } from 'vitest';
import * as M from '../app/src/renderer/src/services/marquee';

// A plain 3-column×2-row layout (column width 200, row height 150, no gutter).
// Matches the shape masonic's positioner returns (left/top/height + column width).
const cells: M.MarqueeCell[] = [
  { index: 0, left: 0, top: 0, width: 200, height: 150 },
  { index: 1, left: 200, top: 0, width: 200, height: 150 },
  { index: 2, left: 400, top: 0, width: 200, height: 150 },
  { index: 3, left: 0, top: 150, width: 200, height: 150 },
  { index: 4, left: 200, top: 150, width: 200, height: 150 },
  { index: 5, left: 400, top: 150, width: 200, height: 150 },
];

const rect = (x: number, y: number, w: number, h: number): M.MarqueeRect => ({ x, y, width: w, height: h });

describe('rectFromPoints: どの向きへ引いても正規化される', () => {
  test('右下へ引く', () => {
    expect(M.rectFromPoints(10, 20, 110, 220)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  test('左上へ引いても同じ矩形', () => {
    expect(M.rectFromPoints(110, 220, 10, 20)).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  });

  test('動かなければ面積ゼロ', () => {
    expect(M.rectFromPoints(50, 50, 50, 50)).toEqual({ x: 50, y: 50, width: 0, height: 0 });
  });
});

describe('intersects: 交差判定（内包ではない）', () => {
  const cell = cells[0]; // 0,0 - 200,150

  test('ほんの少し重なれば選ばれる', () => {
    expect(M.intersects(rect(195, 145, 50, 50), cell)).toBe(true);
  });

  test('矩形がセルを完全に含む', () => {
    expect(M.intersects(rect(-10, -10, 300, 300), cell)).toBe(true);
  });

  test('セルが矩形を完全に含む（縦長カードを内側からなぞった場合）', () => {
    expect(M.intersects(rect(50, 50, 10, 10), cell)).toBe(true);
  });

  test('辺で接するだけでは選ばれない（辺は排他）', () => {
    expect(M.intersects(rect(200, 0, 50, 150), cell)).toBe(false);
    expect(M.intersects(rect(0, 150, 200, 50), cell)).toBe(false);
  });

  test('離れていれば選ばれない', () => {
    expect(M.intersects(rect(250, 0, 50, 50), cell)).toBe(false);
  });

  test('面積ゼロでも内部の点なら当たる（辺の上だけが空振り）', () => {
    expect(M.intersects(rect(100, 75, 0, 0), cell)).toBe(true);
    expect(M.intersects(rect(0, 75, 0, 0), cell)).toBe(false);
  });
});

describe('hitIndices: 矩形 × セル配列 → 選択される index', () => {
  test('1行目の左2枚だけをまたぐ', () => {
    expect(M.hitIndices(rect(150, 10, 100, 50), cells)).toEqual([0, 1]);
  });

  test('4象限の交点をまたぐと4枚', () => {
    expect(M.hitIndices(rect(190, 140, 20, 20), cells)).toEqual([0, 1, 3, 4]);
  });

  test('全面をなぞれば全部', () => {
    expect(M.hitIndices(rect(0, 0, 600, 300), cells)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('どこにも当たらなければ空', () => {
    expect(M.hitIndices(rect(700, 700, 50, 50), cells)).toEqual([]);
  });

  test('候補が降順で来ても昇順で返す（positioner.range は順序を保証しない）', () => {
    expect(M.hitIndices(rect(0, 0, 600, 300), [...cells].reverse())).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('列ごとに高さが違っても縦のずれを正しく見る（masonry 本来の形）', () => {
    const ragged: M.MarqueeCell[] = [
      { index: 0, left: 0, top: 0, width: 200, height: 400 }, // a tall card
      { index: 1, left: 200, top: 0, width: 200, height: 100 },
      { index: 2, left: 200, top: 100, width: 200, height: 100 }, // the shorter column packs earlier
    ];
    // A band that only passes through the lower part of the right column. Overlaps the tall
    // card in the left column at y=300.
    expect(M.hitIndices(rect(100, 150, 200, 20), ragged)).toEqual([0, 2]);
    // Excludes the left column, only the lower part of the right column
    expect(M.hitIndices(rect(250, 150, 100, 20), ragged)).toEqual([2]);
  });
});

describe('exceedsThreshold: 押下がドラッグに変わる境目', () => {
  const t = M.MARQUEE_THRESHOLD;

  test('しきい値未満はドラッグではない（クリックのまま）', () => {
    expect(M.exceedsThreshold(0, 0)).toBe(false);
    expect(M.exceedsThreshold(t - 1, t - 1)).toBe(false);
  });

  test('しきい値ちょうどでドラッグ（境界は含む）', () => {
    expect(M.exceedsThreshold(t, 0)).toBe(true);
    expect(M.exceedsThreshold(0, t)).toBe(true);
  });

  test('片方の軸だけでも成立する', () => {
    expect(M.exceedsThreshold(t + 20, 0)).toBe(true);
    expect(M.exceedsThreshold(0, t + 20)).toBe(true);
  });

  test('向きは問わない（負の移動も同じ）', () => {
    expect(M.exceedsThreshold(-t, 0)).toBe(true);
    expect(M.exceedsThreshold(-(t - 1), -(t - 1))).toBe(false);
  });
});

describe('clearsSelection: 余白クリックで選択を解除するか（#242）', () => {
  test('ドラッグしていない素の押し離しなら解除する', () => {
    expect(M.clearsSelection(false, false)).toBe(true);
  });

  test('Ctrl / Shift を押していたら解除しない（Nautilus・Dolphin と同型）', () => {
    expect(M.clearsSelection(false, true)).toBe(false);
  });

  test('ドラッグになったら解除しない（帯が選択を決める）', () => {
    expect(M.clearsSelection(true, false)).toBe(false);
    expect(M.clearsSelection(true, true)).toBe(false);
  });
});

describe('autoScrollStep: 端に寄せた時のスクロール量', () => {
  const top = 100;
  const bottom = 700; // a scroller with height 600

  test('中央では動かない', () => {
    expect(M.autoScrollStep(400, top, bottom)).toBe(0);
  });

  test('上端の帯に入ると負（上へ）', () => {
    expect(M.autoScrollStep(top + 10, top, bottom)).toBeLessThan(0);
  });

  test('下端の帯に入ると正（下へ）', () => {
    expect(M.autoScrollStep(bottom - 10, top, bottom)).toBeGreaterThan(0);
  });

  test('帯の入口ではゼロ、奥へ行くほど速い', () => {
    const edge = M.AUTOSCROLL_EDGE;
    expect(M.autoScrollStep(bottom - edge, top, bottom)).toBe(0);
    const shallow = M.autoScrollStep(bottom - edge / 2, top, bottom);
    const deep = M.autoScrollStep(bottom - 1, top, bottom);
    expect(deep).toBeGreaterThan(shallow);
  });

  test('スクローラの外へ出ても最大速度で頭打ち', () => {
    expect(M.autoScrollStep(bottom + 5000, top, bottom)).toBe(M.AUTOSCROLL_MAX);
    expect(M.autoScrollStep(top - 5000, top, bottom)).toBe(-M.AUTOSCROLL_MAX);
  });

  test('帯幅ゼロなら無効（ゼロ除算を出さない）', () => {
    expect(M.autoScrollStep(bottom + 100, top, bottom, 0)).toBe(0);
  });
});
