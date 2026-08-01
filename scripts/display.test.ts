// Logic unit test for services/display.ts (centered on #658's avatar axis).
// This module just adds an avatar axis on top of #618's orthogonal keys
// (layout/squareThumbs/showInfo) = no new concept is added, and this lightly checks that this holds:
//   - DISPLAY_KEYS includes 'showAvatar' (3 keys -> 4)
//   - currentShape()'s default is avatar: true (the same "unset means ON" shape as the other axes)
//   - setAvatar() -> currentShape().avatar reflects it. shapeSnapshot() works too
//   - avatarDisabled's disabled condition is the inverse of square/info's (it's enabled specifically in list mode)
//
// Since the store directly under the module is a singleton shared across tests
// (services/store.ts), each test restores its own changes at the end (same convention as records.test.ts's withShape).
import { afterEach, describe, expect, test } from 'vitest';
import { avatarDisabled, currentShape, DISPLAY_KEYS, setAvatar, setInfo, setLayout, setSquare, shapeSnapshot } from '../app/src/renderer/src/services/display';

// Always restores the 3 touched keys back to their original defaults (grid, original ratio, info shown, avatar shown).
afterEach(() => {
  setLayout(false);
  setSquare(false);
  setInfo(true);
  setAvatar(true);
});

describe('DISPLAY_KEYS', () => {
  test('showAvatar を含む4本', () => {
    expect(DISPLAY_KEYS).toContain('showAvatar');
    expect(DISPLAY_KEYS).toHaveLength(4);
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

// #658's core point = a list row is never disabled. square/info are disabled in
// list mode (because they're grid-only axes), but avatar has somewhere to draw
// into — AuthorLine — precisely in list mode (ListRow always draws
// AuthorLine). It only gets disabled when it's the grid and "show info" is OFF
// = the whole info block in PostCard.tsx (where AuthorLine lives) disappears, so there's nowhere to draw it.
describe('avatarDisabled: リスト行は無効にしない', () => {
  test.each([
    { list: false, info: false, expected: true }, // grid, no info -> disabled
    { list: false, info: true, expected: false }, // grid, info shown -> enabled
    { list: true, info: false, expected: false }, // list (info irrelevant) -> enabled
    { list: true, info: true, expected: false }, // list -> enabled
  ])('list=$list, info=$info → disabled=$expected', ({ list, info, expected }) => {
    expect(avatarDisabled({ list, info, square: false, avatar: true })).toBe(expected);
  });
});
