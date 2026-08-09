// panel-width-pref.ts (#30) の単体テスト。ドラッグ・数値入力・復元のどこから来た幅も、
// 必ず通り抜けることになる clamp を試す。純粋（このモジュールの IPC / localStorage の側は
// 関数の中でしか触らないので、import しただけでは何も起きない）。
//
// ここで守っているもの。幅は任意のポインタ座標から来ることもあれば、人が手で編集した
// config.json から来ることも、限界での打鍵から来ることもある。3つとも clampWidth に着地
// する。その中でビューポート上限は、1つだけ逆に取り違えやすい規則＝狭いウィンドウでは
// 上限がパネル自身の最小値を下回りうるので、素朴な min(cap, …) は誰もつかめない細片を
// 返してしまう。

import { describe, expect, test } from 'vitest';
import { LIMITS, clampWidth } from '../app/src/renderer/src/services/panel-width-pref';

const WIDE = 2560; // ビューポート上限が決して効かない幅

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
  // 1000px のウィンドウ → 上限は 450px で、インスペクタ自身の max 560 を下回る。
  test('inspector: 1000px ウィンドウでは max より先に上限が効く', () => {
    expect(clampWidth('inspectorWidth', 560, 1000)).toBe(450);
  });

  // ウィンドウ自身の minWidth は 720px。その45%は 324 で、インスペクタの min 260 より上
  // ＝上限と下限が交差するのは、もっと狭い幅になってから。
  test('inspector: 720px（ウィンドウ最小幅）での上限', () => {
    expect(clampWidth('inspectorWidth', 500, 720)).toBe(324);
  });

  test('inspector: 上限が下限を割り込むときは下限が勝つ', () => {
    expect(clampWidth('inspectorWidth', 500, 400)).toBe(LIMITS.inspectorWidth.min);
  });
});

// ポインタ座標は小数。書き戻す CSS px は整数
describe('丸め', () => {
  test('小数は整数 px へ', () => {
    expect(clampWidth('inspectorWidth', 300.4, WIDE)).toBe(300);
  });

  test('.5 は切り上げ', () => {
    expect(clampWidth('inspectorWidth', 300.5, WIDE)).toBe(301);
  });
});

// すでに clamp を通った幅は、2度目の clamp で変わらない（復元した設定値は起動のたびにここを通る）
describe('冪等性', () => {
  test('inspectorWidth', () => {
    for (const w of [0, 250, 400, 9999]) {
      const once = clampWidth('inspectorWidth', w, 1440);
      expect(clampWidth('inspectorWidth', once, 1440)).toBe(once);
    }
  });
});
