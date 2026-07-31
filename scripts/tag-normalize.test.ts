// native-host/tag-normalize.mts のユニットテスト＝タグ・ハッシュタグの保存時字形正規化
// （#197）。NFKC + trim だけを見る。大小文字・カナ⇔かなを畳まないことも固定する
// （services/search.ts の normalize と違う点＝ファイル冒頭コメント参照）。

import { describe, expect, test } from 'vitest';
import { normalizeTagName, normalizeTagNames } from '../native-host/tag-normalize.mts';

describe('normalizeTagName', () => {
  test('全角英数は半角へ畳む（NFKC）', () => {
    expect(normalizeTagName('ＡＢＣ１２３')).toBe('ABC123');
  });

  test('半角カナは全角カナへ畳む（NFKC）', () => {
    expect(normalizeTagName('ﾈｺ')).toBe('ネコ');
  });

  test('前後の空白を trim する', () => {
    expect(normalizeTagName('  猫  ')).toBe('猫');
  });

  test('全角空白も trim する（NFKC が全角空白を半角へ畳んでから trim が効く）', () => {
    expect(normalizeTagName('　猫　')).toBe('猫');
  });

  test('互換文字を統一する（丸数字など）', () => {
    expect(normalizeTagName('①')).toBe('1');
  });

  test.each([
    ['大文字小文字は畳まない', 'VTuber', 'VTuber'],
    ['カナ⇔かなは畳まない', 'ねこ', 'ねこ'],
    ['カタカナはそのまま', 'ネコ', 'ネコ'],
  ])('%s: %s -> %s', (_label, input, expected) => {
    expect(normalizeTagName(input)).toBe(expected);
  });

  test('文字列でなければ空文字', () => {
    expect(normalizeTagName(3)).toBe('');
    expect(normalizeTagName(null)).toBe('');
    expect(normalizeTagName(undefined)).toBe('');
    expect(normalizeTagName({})).toBe('');
  });

  test('空文字・空白のみは空文字', () => {
    expect(normalizeTagName('')).toBe('');
    expect(normalizeTagName('   ')).toBe('');
  });
});

describe('normalizeTagNames', () => {
  test('配列でなければ空配列', () => {
    expect(normalizeTagNames(null)).toEqual([]);
    expect(normalizeTagNames('ABC')).toEqual([]);
    expect(normalizeTagNames(undefined)).toEqual([]);
  });

  test('文字列でない要素は落とす', () => {
    expect(normalizeTagNames(['a', 3, null, undefined, {}, 'b'])).toEqual(['a', 'b']);
  });

  test('正規化した結果が同じになった要素は重複排除する（初出優先）', () => {
    expect(normalizeTagNames(['ＡＢＣ', 'ABC', ' ABC '])).toEqual(['ABC']);
  });

  test('正規化後に空になった要素は落とす', () => {
    expect(normalizeTagNames(['猫', '   ', ''])).toEqual(['猫']);
  });

  test('大小文字・カナ⇔かなが異なる要素は別タグのまま残す', () => {
    expect(normalizeTagNames(['ネコ', 'ねこ', 'NEKO', 'neko'])).toEqual(['ネコ', 'ねこ', 'NEKO', 'neko']);
  });

  test('順序は初出順を保つ', () => {
    expect(normalizeTagNames(['b', 'a', 'ｂ'])).toEqual(['b', 'a']);
  });
});
