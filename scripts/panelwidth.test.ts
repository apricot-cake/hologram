// panel-width-pref.ts のユニットテスト（#30）: ドラッグ・数値入力・復元のいずれで
// 来た幅も必ず通る clamp。純粋（モジュールの IPC / localStorage 側は関数の中でしか
// 触らないので、import しただけでは何も起きない）。
//
// 守っているもの: 幅はポインタの任意座標からも、人が手で編集した config.json からも、
// 限界でのキー操作からも来る。3つとも clampWidth に着地し、その中でビューポート上限が
// 唯一「逆に書きやすい」規則＝狭いウィンドウでは上限がパネル自身の最小値を下回りうるので、
// 素朴な min(cap, …) は誰も掴めない細片を返してしまう。

import { describe, expect, test } from 'vitest';
import { LIMITS, clampWidth } from '../app/src/renderer/src/services/panel-width-pref';

const WIDE = 2560; // ビューポート上限が絶対に効かない幅

describe('絶対的な上下限', () => {
  test('sidebar: 範囲内はそのまま', () => {
    expect(clampWidth('sidebarWidth', 300, WIDE)).toBe(300);
  });

  test('sidebar: 下限未満は引き上げ', () => {
    expect(clampWidth('sidebarWidth', 40, WIDE)).toBe(LIMITS.sidebarWidth.min);
  });

  test('sidebar: 上限超えは引き下げ', () => {
    expect(clampWidth('sidebarWidth', 9999, WIDE)).toBe(LIMITS.sidebarWidth.max);
  });

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
  // 1000px のウィンドウ → 上限450px。inspector の max 560 より下、sidebar の 400 より上＝
  // 片方だけに効く。
  test('inspector: 1000px ウィンドウでは max より先に上限が効く', () => {
    expect(clampWidth('inspectorWidth', 560, 1000)).toBe(450);
  });

  test('sidebar: 1000px ウィンドウでは依然 max が先に効く', () => {
    expect(clampWidth('sidebarWidth', 560, 1000)).toBe(LIMITS.sidebarWidth.max);
  });

  // ウィンドウ自身の minWidth は 720px。そこでの 45% は 324 で inspector の min 260 より
  // 上＝上限と下限が交差するのはさらに狭い時。
  test('inspector: 720px（ウィンドウ最小幅）での上限', () => {
    expect(clampWidth('inspectorWidth', 500, 720)).toBe(324);
  });

  test('inspector: 上限が下限を割り込むときは下限が勝つ', () => {
    expect(clampWidth('inspectorWidth', 500, 400)).toBe(LIMITS.inspectorWidth.min);
  });

  test('sidebar: 上限が下限を割り込むときは下限が勝つ', () => {
    expect(clampWidth('sidebarWidth', 500, 300)).toBe(LIMITS.sidebarWidth.min);
  });
});

// ポインタ座標は小数、書き戻す CSS px は整数
describe('丸め', () => {
  test('小数は整数 px へ', () => {
    expect(clampWidth('sidebarWidth', 300.4, WIDE)).toBe(300);
  });

  test('.5 は切り上げ', () => {
    expect(clampWidth('sidebarWidth', 300.5, WIDE)).toBe(301);
  });
});

// clamp 済みの幅は再度 clamp しても変わらない（復元された config 値は起動のたびここを通る）
describe('冪等性', () => {
  test.each(['sidebarWidth', 'inspectorWidth'])('%s', (key) => {
    for (const w of [0, 250, 400, 9999]) {
      const once = clampWidth(key, w, 1440);
      expect(clampWidth(key, once, 1440)).toBe(once);
    }
  });
});
