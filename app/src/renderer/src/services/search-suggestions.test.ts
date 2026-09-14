import { expect, test, vi } from 'vitest';
import { queryEntries, registerProvider, resetProviders } from './search-suggestions.ts';
const search = vi.hoisted(() => vi.fn());
vi.mock('./search-results.ts', () => ({ matchingIds: search }));
test('エンジンの順位を使い、セクション別の上限と選択動作を維持する', () => {
  resetProviders();
  const perform = vi.fn();
  registerProvider({
    id: 'test',
    entries: () => [
      { id: 'a', section: 'tag', title: 'illustration', perform },
      { id: 'b', section: 'tag', title: 'picture', perform },
      { id: 'c', section: 'user', title: 'illustrator', perform },
    ],
  });
  search.mockReturnValue(new Set(['b', 'c', 'a']));
  const groups = queryEntries('illustraton', { limit: { tag: 1 } });
  expect(groups.map((g) => g.section)).toEqual(['tag', 'user']);
  expect(groups[0].items[0].id).toBe('b');
  groups[0].items[0].perform();
  expect(perform).toHaveBeenCalledOnce();
});
