// native-host/tag-normalize.mts の単体テスト＝保存時のタグ・ハッシュタグのグリフの正規化
// (#197)。扱うのは NFKC と trim だけ。大文字小文字とカタカナ⇔ひらがなを畳まないことも
// ここで押さえる（services/search.ts の normalize と違うのはその点＝あのファイルの冒頭
// コメントを参照）。

import { describe, expect, test } from 'vitest';
import { MAX_TAG_NAME_COMBINING_MARK_RUN, normalizeTagName, normalizeTagNames } from './tag-normalize.mts';

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

  test('256文字を越える異なる名前を切り詰めず、別の名前として保つ', () => {
    const prefix = '長'.repeat(300);
    expect(normalizeTagName(prefix + '甲')).toBe(prefix + '甲');
    expect(normalizeTagName(prefix + '乙')).toBe(prefix + '乙');
    expect(normalizeTagNames([prefix + '甲', prefix + '乙'])).toEqual([prefix + '甲', prefix + '乙']);
  });

  test('NFKC で入力より長くなる文字も展開結果を切らない', () => {
    // U+FDFA は NFKC で18 code pointへ展開される。
    const expanded = '\ufdfa'.normalize('NFKC');
    const input = '\ufdfa'.repeat(300);
    expect(normalizeTagName(input)).toBe(expanded.repeat(300));
    expect(normalizeTagName(input).length).toBeGreaterThan(256);
    expect(normalizeTagName(normalizeTagName(input))).toBe(normalizeTagName(input));
  });

  test('長い名前の末尾にある絵文字のサロゲート対を切らない', () => {
    const input = 'a'.repeat(10_000) + '😀';
    expect(normalizeTagName(input)).toBe(input);
    expect([...normalizeTagName(input)].at(-1)).toBe('😀');
  });

  test('病的な結合文字列は NFKC を始める前に拒否する', () => {
    const input = 'a' + '\u0300\u0316'.repeat(100_000);
    const original = String.prototype.normalize;
    let called = false;
    String.prototype.normalize = function (...args: Parameters<string['normalize']>) {
      called = true;
      return original.apply(this, args);
    };
    try {
      expect(() => normalizeTagName(input)).toThrow(RangeError);
      expect(called).toBe(false);
    } finally {
      String.prototype.normalize = original;
    }
  });

  test('結合文字の仕事量上限までは受理し、越えた入力は拒否する', () => {
    expect(normalizeTagName('a' + '\u0300'.repeat(MAX_TAG_NAME_COMBINING_MARK_RUN))).toBeTruthy();
    expect(() => normalizeTagName('a' + '\u0300'.repeat(MAX_TAG_NAME_COMBINING_MARK_RUN + 1))).toThrow(RangeError);
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
