// Unit tests for panel-width-pref.ts (#30): the clamp that any width coming from
// dragging, numeric input, or restore must always pass through. Pure (the module's
// IPC / localStorage side is only touched inside functions, so just importing it
// doesn't do anything).
//
// What this guards: width can come from an arbitrary pointer coordinate, from a
// config.json a person hand-edited, or from a key press at the limit. All three land
// in clampWidth, and inside it the viewport cap is the one rule that's easy to get
// backwards = on a narrow window the cap can fall below the panel's own minimum, so a
// naive min(cap, …) would return a sliver nobody can grab.

import { describe, expect, test } from 'vitest';
import { LIMITS, clampWidth } from '../app/src/renderer/src/services/panel-width-pref';

const WIDE = 2560; // a width where the viewport cap never kicks in

describe('絶対的な上下限', () => {
  test('inspector: 範囲内はそのまま', () => {
    expect(clampWidth('inspectorWidth', 400, WIDE)).toBe(400);
  });

  test('inspector: 下限未満は引き上げ', () => {
    expect(clampWidth('inspectorWidth', 0, WIDE)).toBe(LIMITS.inspectorWidth.min);
  });

  test('inspector: 上限超えは引き下げ', () => {
    expect(clampWidth('inspectorWidth', 5000, WIDE)).toBe(LIMITS.inspectorWidth.max);
  });
});

describe('ビューポート上限（45%）', () => {
  // A 1000px window → cap of 450px, below the inspector's own max of 560.
  test('inspector: 1000px ウィンドウでは max より先に上限が効く', () => {
    expect(clampWidth('inspectorWidth', 560, 1000)).toBe(450);
  });

  // The window's own minWidth is 720px. 45% of that is 324, which is above inspector's
  // min of 260 = the cap and the floor only cross at an even narrower width.
  test('inspector: 720px（ウィンドウ最小幅）での上限', () => {
    expect(clampWidth('inspectorWidth', 500, 720)).toBe(324);
  });

  test('inspector: 上限が下限を割り込むときは下限が勝つ', () => {
    expect(clampWidth('inspectorWidth', 500, 400)).toBe(LIMITS.inspectorWidth.min);
  });
});

// Pointer coordinates are fractional; the CSS px written back is an integer
describe('丸め', () => {
  test('小数は整数 px へ', () => {
    expect(clampWidth('inspectorWidth', 300.4, WIDE)).toBe(300);
  });

  test('.5 は切り上げ', () => {
    expect(clampWidth('inspectorWidth', 300.5, WIDE)).toBe(301);
  });
});

// A width that's already been clamped doesn't change on a second clamp (a restored config value goes through here on every launch)
describe('冪等性', () => {
  test('inspectorWidth', () => {
    for (const w of [0, 250, 400, 9999]) {
      const once = clampWidth('inspectorWidth', w, 1440);
      expect(clampWidth('inspectorWidth', once, 1440)).toBe(once);
    }
  });
});
