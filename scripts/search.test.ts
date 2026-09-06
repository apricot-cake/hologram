import { describe, expect, test } from 'vitest';
import * as S from '../app/src/renderer/src/services/search';

describe('表記ゆれと部分一致', () => {
  test.each([
    ['ＡB１２', 'ab12'],
    ['ﾈｺ', 'ねこ'],
    ['ネコ', 'ねこ'],
    ['ﾊﾞｯｸﾞ', 'ばっぐ'],
    ['パン', 'ぱん'],
    ['ヴ', 'ゔ'],
    ['か\u3099', 'が'],
    ['café', 'café'],
  ])('%sを%sへ正規化する', (raw, expected) => expect(S.normalize(raw)).toBe(expected));
  test.each([
    ['ねこ', 'ネコかわいい', true],
    ['ハック', 'バッグ', false],
    ['はん', 'パン', false],
    ['ねこ', 'ねずみとうさぎとこども', false],
    ['ねこわ', 'ねこかわいい', false],
    ['こんにとは', 'こんにちは世界', false],
    ['neko', 'ねこの写真', false],
    ['neko', 'NEKO photos', true],
    ['ねこ　かわ', 'かわいいねこの写真', true],
    ['ねこ かわ', 'ねこだけ', false],
    ['   ', 'なんでも', true],
  ])('検索%s / 本文%s → %s', (query, hay, expected) => expect(S.compile(query)(hay)).toBe(expected));
  test('候補の部分一致にも濁点とローマ字の区別が適用される', () => {
    expect(S.includesNormalized('ﾊﾞｯｸﾞ一覧', 'ばっぐ')).toBe(true);
    expect(S.includesNormalized('ﾊﾞｯｸﾞ一覧', 'はっく')).toBe(false);
    expect(S.includesNormalized('ねこの写真', 'neko')).toBe(false);
    expect(S.includesNormalized('ねこの写真', 'ね写')).toBe(false);
  });
});

describe('原文での強調位置', () => {
  test.each([
    ['Hello World', 'world', 6, 11],
    ['前ﾊﾞｯｸﾞ後', 'バッグ', 1, 6],
    ['前か\u3099後', 'ガ', 1, 3],
    ['前㍿後', '株式会社', 1, 2],
    ['🐈ネコ写真', 'ねこ', 2, 4],
    ['かわいいねこ', 'ねこ かわ', 0, 2],
  ])('%s / %s', (hay, query, start, end) => expect(S.matchSpan(hay, query)).toEqual({ start, end }));
  test('曖昧一致や空欄を強調しない', () => {
    expect(S.matchSpan('こんにとは世界', 'こんにちは')).toBeNull();
    expect(S.matchSpan('ねずみとこども', 'ねこ')).toBeNull();
    expect(S.matchSpan('バッグ', 'ハック')).toBeNull();
    expect(S.matchSpan('本文', '')).toBeNull();
  });
});

describe('#29 snippetOf: 結果行のスニペット', () => {
  test('一致箇所をハイライトオフセットとして返す', () => {
    const snip = S.snippetOf('今日は天気が良くて猫と散歩した', '猫と散歩');
    expect(snip.matchStart).toBeGreaterThanOrEqual(0);
    expect(snip.text.slice(snip.matchStart, snip.matchEnd)).toBe('猫と散歩');
  });

  test('一致が無ければハイライト無しの頭出し', () => {
    const snip = S.snippetOf('まったく関係の無い本文がここに続く', 'ねこ');
    expect(snip.matchStart).toBe(-1);
    expect(snip.matchEnd).toBe(-1);
    expect(snip.text.length).toBeGreaterThan(0);
  });

  test('改行・連続空白は1行に畳む', () => {
    const snip = S.snippetOf('一行目\n\n  二行目です', '二行目');
    expect(snip.text).not.toMatch(/\n/);
  });

  test('長文は前後を… で切り詰める', () => {
    const long = 'あ'.repeat(100) + '猫' + 'い'.repeat(100);
    const snip = S.snippetOf(long, '猫', 10);
    expect(snip.text.startsWith('…')).toBe(true);
    expect(snip.text.endsWith('…')).toBe(true);
  });
});
