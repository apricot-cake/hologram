import { describe, expect, test } from 'vitest';
import { windowsUserContextMatches } from './windows-user-context.mts';

describe('Windowsユーザー領域の実行判定', () => {
  test('環境の所有者と同じWindowsユーザーを許可する', () => {
    expect(windowsUserContextMatches('desktop-2ij7h91\\apricot\r\n', 'DESKTOP-2IJ7H91', 'apricot')).toBe(true);
  });

  test('隔離された別ユーザーと不完全な環境を拒否する', () => {
    expect(windowsUserContextMatches('desktop-2ij7h91\\sandbox', 'DESKTOP-2IJ7H91', 'apricot')).toBe(false);
    expect(windowsUserContextMatches('desktop-2ij7h91\\apricot', undefined, 'apricot')).toBe(false);
  });
});
