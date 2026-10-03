import { describe, expect, test, vi } from 'vitest';
import { includesNormalized } from './search.ts';
import { runSafeTagSearch } from './safe-tag-search.ts';

describe('runSafeTagSearch', () => {
  test('互換分解後に危険な問い合わせは候補行の検索へ渡さない', () => {
    const search = vi.fn(() => ['到達しない']);
    const query = '\u0300\uff9e'.repeat(30_000);

    expect(runSafeTagSearch(query, search)).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  test.each([
    ['長い通常文字列', 'a'.repeat(10_000) + 'needle', ['a'.repeat(10_000) + 'needle']],
    ['日本語', 'ネコ', ['ねこ', '猫']],
    ['emoji', '🌸', ['春🌸', '春']],
  ])('%sの通常検索を維持する', (_label, query, values) => {
    expect(runSafeTagSearch(query, () => values.filter((value) => includesNormalized(value, query)))).toEqual([values[0]]);
  });
});
