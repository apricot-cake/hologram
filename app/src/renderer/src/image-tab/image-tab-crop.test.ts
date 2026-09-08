import { describe, expect, test } from 'vitest';
import { fromPercentCrop, toPercentCrop } from './crop.ts';

describe('画像タブの可逆クロップ座標', () => {
  test('DBの0〜1形式と react-image-crop の百分率形式を往復する', () => {
    const stored = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 };
    const percent = toPercentCrop(stored);
    expect(percent).toEqual({ unit: '%', x: 10, y: 20, width: 70, height: 60 });
    expect(fromPercentCrop(percent)).toEqual(stored);
  });

  test('ライブラリから届いた端の丸め誤差を画像の範囲内へ収める', () => {
    expect(fromPercentCrop({ unit: '%', x: -0.001, y: 90, width: 100.01, height: 20 })).toEqual({ x: 0, y: 0.9, width: 1, height: 0.09999999999999998 });
  });

  test('空の選択範囲は保存しない', () => {
    expect(fromPercentCrop({ unit: '%', x: 50, y: 50, width: 0, height: 10 })).toBeNull();
  });
});
