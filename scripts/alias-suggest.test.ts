// Unit tests for services/alias-suggest.ts (#23 St2: decision-free candidate
// ranking for poster name-merging — "ハンドル完全一致＞displayName正規化一致＞
//類似"). Pure logic, no IPC/DB involved, so every case here is a plain
// input→output assertion.

import { describe, expect, test } from 'vitest';
import { suggestionsFor, suggestPairs } from '../app/src/renderer/src/services/alias-suggest';

function poster(key: string, screenName: string, displayName: string) {
  return { key, screenName, displayName };
}

describe('suggestPairs — ハンドル完全一致（最強タイア）', () => {
  test('正規化後に同一ハンドルの2件はペアになる', () => {
    const posters = [poster('x:a', 'foo_bar', 'Foo A'), poster('misskey:b', 'foo_bar', 'Completely Different Name')];

    const pairs = suggestPairs(posters);

    expect(pairs).toEqual([{ a: 'misskey:b', b: 'x:a', reason: 'handle' }]);
  });

  test('全角/半角・大文字小文字・先頭 @ の違いは無視される（search.ts の normalize 準拠）', () => {
    const posters = [poster('x:a', '@FooBar', ''), poster('misskey:b', 'ｆｏｏｂａｒ', '')];

    const pairs = suggestPairs(posters);

    expect(pairs).toEqual([{ a: 'misskey:b', b: 'x:a', reason: 'handle' }]);
  });

  test('空文字のハンドル同士は一致とみなさない', () => {
    const posters = [poster('x:a', '', 'Totally Unrelated Name'), poster('misskey:b', '', 'A Different Person Entirely')];

    expect(suggestPairs(posters)).toEqual([]);
  });
});

describe('suggestPairs — displayName 正規化一致（第2タイア）', () => {
  test('ハンドルが違ってもdisplayNameが正規化後に一致すればペアになる', () => {
    const posters = [poster('x:a', 'handle1', '山田太郎'), poster('misskey:b', 'handle2', '山田太郎')];

    const pairs = suggestPairs(posters);

    expect(pairs).toEqual([{ a: 'misskey:b', b: 'x:a', reason: 'displayName' }]);
  });

  test('ハンドル一致がある場合はdisplayName一致より強い扱いになる（1ペア1件・reasonはhandle）', () => {
    const posters = [poster('x:a', 'same_handle', '山田太郎'), poster('misskey:b', 'same_handle', '山田太郎')];

    const pairs = suggestPairs(posters);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].reason).toBe('handle');
  });
});

describe('suggestPairs — 類似（第3タイア）', () => {
  test('typo程度の違いがあるハンドルは類似候補になる', () => {
    const posters = [poster('x:a', 'yamada_tarou', ''), poster('misskey:b', 'yamada_taroo', '')];

    const pairs = suggestPairs(posters);

    expect(pairs).toEqual([{ a: 'misskey:b', b: 'x:a', reason: 'similar' }]);
  });

  test('全く違う文字列は候補にならない', () => {
    const posters = [poster('x:a', 'yamada_tarou', 'Yamada Tarou'), poster('misskey:b', 'suzuki_hanako', 'Suzuki Hanako')];

    expect(suggestPairs(posters)).toEqual([]);
  });

  test('短すぎる文字列（MIN_SIMILAR_LEN未満）は類似判定の対象外', () => {
    const posters = [poster('x:a', 'ai', ''), poster('misskey:b', 'bi', '')];

    expect(suggestPairs(posters)).toEqual([]);
  });

  test('しきい値はオプションで調整できる', () => {
    const posters = [poster('x:a', 'yamada_tarou_xxxxxxxxxx', ''), poster('misskey:b', 'yamada_hanako_xxxxxxxxxx', '')];

    expect(suggestPairs(posters)).toEqual([]); // default threshold rejects this
    expect(suggestPairs(posters, { similarityThreshold: 0.5 })).toEqual([{ a: 'misskey:b', b: 'x:a', reason: 'similar' }]);
  });
});

describe('suggestPairs — 除外条件', () => {
  test('同じキーは自分自身とペアにならない', () => {
    const posters = [poster('x:a', 'same', 'Same'), poster('x:a', 'same', 'Same')]; // defensive de-dup case

    expect(suggestPairs(posters)).toEqual([]);
  });

  test('isDismissed が真を返すペアは提案されない', () => {
    const posters = [poster('x:a', 'foo_bar', ''), poster('misskey:b', 'foo_bar', '')];

    const pairs = suggestPairs(posters, { isDismissed: (a, b) => a === 'misskey:b' && b === 'x:a' });

    expect(pairs).toEqual([]);
  });

  test('却下済みペアは弱いタイアでも再浮上しない', () => {
    // Same pair would ALSO match at the 'displayName' tier if handle-tier didn't
    // claim (and then drop) it first.
    const posters = [poster('x:a', 'foo_bar', 'Same Name'), poster('misskey:b', 'foo_bar', 'Same Name')];

    const pairs = suggestPairs(posters, { isDismissed: () => true });

    expect(pairs).toEqual([]);
  });
});

describe('suggestPairs — ペアの向き', () => {
  test('a/bは常に文字列順（呼び出し側の並び順に依存しない）', () => {
    const forward = suggestPairs([poster('z:a', 'h', ''), poster('a:b', 'h', '')]);
    const backward = suggestPairs([poster('a:b', 'h', ''), poster('z:a', 'h', '')]);

    expect(forward).toEqual([{ a: 'a:b', b: 'z:a', reason: 'handle' }]);
    expect(backward).toEqual(forward);
  });
});

describe('suggestionsFor', () => {
  test('指定したキーが絡むペアだけへ絞り込む', () => {
    const posters = [poster('x:a', 'foo_bar', ''), poster('misskey:b', 'foo_bar', ''), poster('pixiv:c', 'other', '')];

    expect(suggestionsFor('x:a', posters)).toEqual([{ a: 'misskey:b', b: 'x:a', reason: 'handle' }]);
    expect(suggestionsFor('pixiv:c', posters)).toEqual([]);
  });
});
