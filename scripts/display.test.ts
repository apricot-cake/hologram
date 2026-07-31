// services/display.ts のロジック単体テスト（#658 の avatar 軸を中心に）。
// このモジュールは #618 の直交キー（layout/squareThumbs/showInfo）に avatar 軸を
// 足しただけ＝新しい概念は増えない、が守られているかを軽く押さえる：
//   - DISPLAY_KEYS に 'showAvatar' が入っている（3本→4本）
//   - currentShape() の既定は avatar: true（他の軸と同じ「未設定なら ON」の形）
//   - setAvatar() → currentShape().avatar が反映される。shapeSnapshot() も動く
//   - avatarDisabled の disabled 条件が square/info の逆（list でこそ有効）になっている
//
// モジュール直下の store はテスト間で共有される singleton（services/store.ts）なので、
// 各テストは自分の変更を最後に戻す（records.test.ts の withShape と同じ流儀）。
import { afterEach, describe, expect, test } from 'vitest';
import { avatarDisabled, currentShape, DISPLAY_KEYS, setAvatar, setInfo, setLayout, setSquare, shapeSnapshot } from '../app/src/renderer/src/services/display';

// 触った3キーを元の既定（グリッド・元比率・情報あり・アバターあり）へ必ず戻す。
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

// #658 の核心＝リスト行は無効にしない。square/info は list で無効（グリッド専用の軸
// だから）だが、avatar は list でこそ AuthorLine に描く先がある（ListRow は常に
// AuthorLine を描く）。無効になるのはグリッドで「情報を表示」が OFF の時だけ＝
// PostCard.tsx の info ブロック（AuthorLine の置き場）ごと消えるので描く先が無い。
describe('avatarDisabled: リスト行は無効にしない', () => {
  test.each([
    { list: false, info: false, expected: true }, // グリッド・情報なし → 無効
    { list: false, info: true, expected: false }, // グリッド・情報あり → 有効
    { list: true, info: false, expected: false }, // リスト（情報は無関係）→ 有効
    { list: true, info: true, expected: false }, // リスト → 有効
  ])('list=$list, info=$info → disabled=$expected', ({ list, info, expected }) => {
    expect(avatarDisabled({ list, info, square: false, avatar: true })).toBe(expected);
  });
});
