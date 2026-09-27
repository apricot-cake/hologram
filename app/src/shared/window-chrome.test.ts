import { describe, expect, test } from 'vitest';
import { dimTitlebarSymbolColor, TITLEBAR_COLORS } from './window-chrome';
import { combinedDim } from '../renderer/src/components/ui/titlebar-symbol-dim';

describe('モーダルのネイティブ記号の暗転', () => {
  test('ライト・ダークの記号を半分の明るさにする', () => {
    expect(dimTitlebarSymbolColor(TITLEBAR_COLORS.light.symbolColor, 0.5)).toBe('#101112');
    expect(dimTitlebarSymbolColor(TITLEBAR_COLORS.dark.symbolColor, 0.5)).toBe('#737477');
  });
  test('閉じると元の色に戻る', () => {
    expect(dimTitlebarSymbolColor('#e6e8ed', combinedDim([]))).toBe('#e6e8ed');
  });
  test('重なった暗幕と比較画面の濃さを合成する', () => {
    expect(combinedDim([0.5, 0.5])).toBe(0.75);
    expect(combinedDim([0.8])).toBe(0.8);
    expect(combinedDim([0.5])).toBe(0.5);
  });
});
