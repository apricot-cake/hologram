import { afterEach, describe, expect, test } from 'vitest';
import { avatarDisabled, currentShape, DISPLAY_KEYS, setAvatar, setInfo, setSquare, shapeSnapshot } from './display';

afterEach(() => {
  setSquare(false);
  setInfo(true);
  setAvatar(true);
});

describe('DISPLAY_KEYS', () => {
  test('showAvatar を含む3本', () => {
    expect(DISPLAY_KEYS).toContain('showAvatar');
    expect(DISPLAY_KEYS).toHaveLength(3);
  });
});

describe('currentShape(): avatar の既定', () => {
  test('store キー未設定なら true', () => {
    expect(currentShape().avatar).toBe(true);
  });

  test('setAvatar(false) で currentShape().avatar が false になる', () => {
    setAvatar(false);
    expect(currentShape().avatar).toBe(false);
  });

  test('shapeSnapshot() は avatar のトグル前後で変わる', () => {
    const before = shapeSnapshot();
    setAvatar(false);
    const after = shapeSnapshot();
    expect(after).not.toBe(before);
  });
});

describe('avatarDisabled: 情報を非表示にすると無効', () => {
  test.each([
    { info: false, expected: true }, // グリッド、情報なし → 無効
    { info: true, expected: false }, // グリッド、情報あり → 有効
  ])('info=$info → disabled=$expected', ({ info, expected }) => {
    expect(avatarDisabled({ info, square: false, avatar: true })).toBe(expected);
  });
});
