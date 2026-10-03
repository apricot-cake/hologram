// native-host/tag-normalize.mts の単体テスト＝保存時のタグ・ハッシュタグのグリフの正規化
// (#197)。扱うのは NFKC と trim だけ。大文字小文字とカタカナ⇔ひらがなを畳まないことも
// ここで押さえる（services/search.ts の normalize と違うのはその点＝あのファイルの冒頭
// コメントを参照）。

import { describe, expect, test } from 'vitest';
import { MAX_TAG_NAME_LENGTH, normalizeTagName, normalizeTagNames } from './tag-normalize.mts';

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

  test('長大な入力は NFKC の前にタグ名の上限で切る', () => {
    const combiningMarks = `A${'\u0300\u0316'.repeat(100_000)}`;
    const normalized = normalizeTagName(combiningMarks);

    expect(normalized.length).toBeLessThanOrEqual(MAX_TAG_NAME_LENGTH);
    expect(normalized).toBe(combiningMarks.slice(0, MAX_TAG_NAME_LENGTH).normalize('NFKC').slice(0, MAX_TAG_NAME_LENGTH));
  });

  test('NFKC で展開された結果にもタグ名の上限を適用する', () => {
    expect(normalizeTagName('㍿'.repeat(MAX_TAG_NAME_LENGTH))).toBe('株式会社'.repeat(MAX_TAG_NAME_LENGTH).slice(0, MAX_TAG_NAME_LENGTH));
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
