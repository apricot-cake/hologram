import { expect, test, vi } from 'vitest';
import { posterSortValue } from './poster-sort-value.ts';

vi.mock('./format.ts', () => ({ compactDate: (date: string) => date.slice(0, 10), formatCount: (count: number) => String(count) }));
const user = { count: 3, followers: 124, localViewCount: 7, latest: '2026-01-01', lastCapture: '2026-02-01', lastViewedAt: '2026-03-01' } as HologramUserAgg;
const tree = { op: 'and', children: [] } as unknown as HologramQueryGroup;

test.each([
  ['count', 'posts', '3'],
  ['count-asc', 'posts', '3'],
  ['followers-pct', 'followers', '124'],
  ['followers-pct-asc', 'followers', '124'],
  ['local-views-desc', 'views', '7'],
  ['local-views-asc', 'views', '7'],
  ['last-viewed-desc', 'date', '2026-03-01'],
  ['last-viewed-asc', 'date', '2026-03-01'],
  ['date-desc', 'date', '2026-01-01'],
])('%s の実際の値を表示する', (sort, kind, label) => {
  expect(posterSortValue(user, sort, tree)).toEqual({ kind, label });
});

test.each(['name', 'name-desc', 'random'])('%s は重複表示しない', (sort) => {
  expect(posterSortValue(user, sort, tree)).toBeNull();
});

test('未取得とゼロを区別する', () => {
  expect(posterSortValue({ ...user, followers: null }, 'followers-pct', tree)?.label).toBe('—');
  expect(posterSortValue({ ...user, followers: 0 }, 'followers-pct', tree)?.label).toBe('0');
  expect(posterSortValue({ ...user, lastViewedAt: undefined }, 'last-viewed-desc', tree)?.label).toBe('—');
});
