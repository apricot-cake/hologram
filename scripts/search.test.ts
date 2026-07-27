// search.ts のロジック単体テスト。正規化(B)・サブシーケンス(A)・近似部分一致＝
// 編集距離(C) を直接検証する。

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

  // ラテン系の分音記号は落とさない（NFC へ戻す＝合成形のまま・語長も従来どおり）
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

describe('A: サブシーケンス（順序一致・飛び石OK）', () => {
  test('"ねこわ" が "ねこかわいい" に一致（飛び石）', () => {
    expect(S.compile('ねこわ')('ねこかわいい')).toBe(true);
  });
});

describe('C: 編集距離', () => {
  // 「こんにちは」の ち→と 置換ミス
  test('置換ミス "こんにとは" が "こんにちは世界" に一致', () => {
    expect(S.compile('こんにとは')('こんにちは世界')).toBe(true);
  });

  test('無関係文には不一致', () => {
    expect(S.compile('こんにとは')('いぬのおさんぽ')).toBe(false);
  });

  // 短語(<=2)は編集距離0（誤爆防止）
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
