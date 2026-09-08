// services/display.ts のロジックの単体テスト（#658 の avatar 軸が中心）。
// このモジュールは #618 の直交するキー（layout/squareThumbs/showInfo）の上に
// avatar 軸を足すだけ＝新しい概念は増えない。それが保たれているかを軽く見る。
//   - DISPLAY_KEYS が 'showAvatar' を含む（3本 → 4本）
//   - currentShape() の既定は avatar: true（他の軸と同じ「未設定なら ON」の形）
//   - setAvatar() → currentShape().avatar に反映される。shapeSnapshot() も動く
//   - avatarDisabled の無効条件は square/info の裏返し（リストのときにこそ有効）
//
// モジュールの直下にある store はテスト間で共有される singleton（services/store.ts）
// なので、各テストは自分の変更を最後に戻す（records.test.ts の withShape と同じ作法）。
import { afterEach, describe, expect, test } from 'vitest';
import { avatarDisabled, currentShape, DISPLAY_KEYS, setAvatar, setInfo, setLayout, setSquare, shapeSnapshot } from './display';

// 触った3本のキーを必ず元の既定へ戻す（グリッド、元の比率、情報を出す、アバターを出す）。
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

// #658 の勘所＝リスト行は決して無効にしない。square/info はリストで無効になる
// （グリッド専用の軸だから）が、avatar はリストでこそ描く先＝AuthorLine がある
// （ListRow は常に AuthorLine を描く）。無効になるのはグリッドで「情報を出す」が
// OFF のときだけ＝PostCard.tsx の情報ブロック（AuthorLine の居場所）ごと消えて、
// 描く先が無くなる。
describe('avatarDisabled: リスト行は無効にしない', () => {
  test.each([
    { list: false, info: false, expected: true }, // グリッド、情報なし → 無効
    { list: false, info: true, expected: false }, // グリッド、情報あり → 有効
    { list: true, info: false, expected: false }, // リスト（情報は関係ない） → 有効
    { list: true, info: true, expected: false }, // リスト → 有効
  ])('list=$list, info=$info → disabled=$expected', ({ list, info, expected }) => {
    expect(avatarDisabled({ list, info, square: false, avatar: true })).toBe(expected);
  });
});
