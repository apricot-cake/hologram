// Logic unit tests for search.ts. Directly verifies normalization (B), subsequence (A),
// and approximate partial match = edit distance (C).

import { describe, expect, test } from 'vitest';
import * as S from '../app/src/renderer/src/services/search';

describe('B: 表記ゆれ正規化', () => {
  test('カタカナ→ひらがな', () => {
    expect(S.normalize('ネコ')).toBe('ねこ');
  });

  test('全角英数→半角+小文字', () => {
    expect(S.normalize('ＡB１２')).toBe('ab12');
  });

  test('半角カナ→ひらがな', () => {
    expect(S.normalize('ﾈｺ')).toBe('ねこ');
  });
});

describe('B: 濁点・半濁点の同一視（#96）', () => {
  test('濁点を落とす', () => {
    expect(S.normalize('バッグ')).toBe('はっく');
  });

  test('半濁点を落とす', () => {
    expect(S.normalize('パン')).toBe('はん');
  });

  test('半角カナ＋半角濁点も落とす', () => {
    expect(S.normalize('ﾊﾞｯｸﾞ')).toBe('はっく');
  });

  test('ヴ→う', () => {
    expect(S.normalize('ヴ')).toBe('う');
  });

  // Latin diacritics are not stripped (revert to NFC = keep the composed form; string length stays as before)
  test('é は分解したままにしない', () => {
    expect(S.normalize('café')).toBe('café');
  });

  test('é の語長は1文字のまま', () => {
    expect(S.normalize('é')).toHaveLength(1);
  });

  test('"ハック" が "バッグ" に一致（濁点同一視）', () => {
    expect(S.compile('ハック')('バッグ')).toBe(true);
  });

  test('濁点同一視でも無関係語には不一致', () => {
    expect(S.compile('ハック')('いぬのおさんぽ')).toBe(false);
  });
});

describe('B 経由のマッチ（ひらがなクエリ↔カタカナ本文）', () => {
  test('"ねこ" が "ネコかわいい" に一致', () => {
    expect(S.compile('ねこ')('ネコかわいい')).toBe(true);
  });

  test('"ねこ" は "いぬのおさんぽ" に不一致', () => {
    expect(S.compile('ねこ')('いぬのおさんぽ')).toBe(false);
  });
});

describe('短語彙用の正規化部分一致', () => {
  test('全角半角・カナかな・濁点のゆれを吸収する', () => {
    expect(S.includesNormalized('ﾊﾞｯｸﾞ一覧', 'はっく')).toBe(true);
  });

  test('空のクエリは一致し、飛び石一致はしない', () => {
    expect(S.includesNormalized('ネコかわいい', '')).toBe(true);
    expect(S.includesNormalized('ネコかわいい', 'ねわ')).toBe(false);
  });

  test('ローマ字の派生かなクエリと元クエリを OR で照合する', () => {
    expect(S.includesNormalized('ねこの写真', 'neko')).toBe(true);
    expect(S.includesNormalized('neko photos', 'neko')).toBe(true);
  });

  test('入力途中の n は IME モードのまま扱う', () => {
    expect(S.includesNormalized('しn', 'shin')).toBe(true);
  });
});

describe('A: サブシーケンス（順序一致・飛び石OK）', () => {
  test('"ねこわ" が "ねこかわいい" に一致（飛び石）', () => {
    expect(S.compile('ねこわ')('ねこかわいい')).toBe(true);
  });
});

describe('C: 編集距離', () => {
  // A ち→と substitution typo in "こんにちは"
  test('置換ミス "こんにとは" が "こんにちは世界" に一致', () => {
    expect(S.compile('こんにとは')('こんにちは世界')).toBe(true);
  });

  test('無関係文には不一致', () => {
    expect(S.compile('こんにとは')('いぬのおさんぽ')).toBe(false);
  });

  // Short terms (<=2 chars) get edit distance 0 (prevents false hits)
  test('短語は厳密（"ねこ" は "ねね" に不一致）', () => {
    expect(S.compile('ねこ')('ねね')).toBe(false);
  });
});

describe('AND 結合 + 全角スペース', () => {
  test('両語一致で true', () => {
    expect(S.compile('ねこ　かわ')('ねことかわいい')).toBe(true);
  });

  test('片方欠落で false', () => {
    expect(S.compile('ねこ　かわ')('ねこだけ')).toBe(false);
  });
});

test('空クエリは常に一致', () => {
  expect(S.compile('   ')('なんでも')).toBe(true);
});

// #29: full-text search snippet extraction. Runs on the RAW (non-normalized)
// string on purpose — see search.ts's header comment on why NFKC-normalized
// positions cannot be mapped back to the original.
describe('#29 matchSpan: 原文側での位置探索', () => {
  test('ぴったり一致は小文字化 indexOf', () => {
    expect(S.matchSpan('Hello World', 'world')).toEqual({ start: 6, end: 11 });
  });

  test('大文字小文字を無視する', () => {
    expect(S.matchSpan('こんにちは World です', 'WORLD')).toEqual({ start: 6, end: 11 });
  });

  test('厳密一致が無ければ近似位置へフォールバック（1文字の置換ミス）', () => {
    const span = S.matchSpan('こんにとは世界', 'こんにちは');
    if (!span) throw new Error('expected an approximate match');
    expect(span.end).toBeLessThanOrEqual(7);
  });

  test('短語（編集距離0）で一致が無ければ null', () => {
    expect(S.matchSpan('いぬのさんぽ', 'ねこ')).toBeNull();
  });

  test('空クエリは null', () => {
    expect(S.matchSpan('なんでも', '')).toBeNull();
  });
});

describe('#29 approxSubstringEnd: 最良一致の終端位置', () => {
  test('編集距離0では indexOf と同じ終端', () => {
    expect(S.approxSubstringEnd('ねこがすき', 'ねこ', 0)).toBe(2);
  });

  test('予算内の置換ミスなら終端を返す', () => {
    expect(S.approxSubstringEnd('こんにとは世界', 'こんにちは', 1)).not.toBeNull();
  });

  test('予算を超えると null', () => {
    expect(S.approxSubstringEnd('いぬのさんぽ', 'ねこかわいい', 1)).toBeNull();
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
