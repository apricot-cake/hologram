import { expect, test } from 'vitest';
import { matchingPreviousName, previousNames, posterNameKeywords } from './poster-names.ts';

test('現在名を履歴表示から除き、検索時だけ旧表示名・旧ハンドルを返す', () => {
  const user = {
    displayName: '凪',
    screenName: 'nagi',
    names: [
      { field: 'displayName' as const, value: '凪', firstObservedAt: '2026-09-01', lastObservedAt: '2026-09-01' },
      { field: 'displayName' as const, value: '春野', firstObservedAt: '2026-01-01', lastObservedAt: '2026-01-01' },
      { field: 'screenName' as const, value: 'haruno', firstObservedAt: '2026-01-01', lastObservedAt: '2026-01-01' },
    ],
  };
  expect(previousNames(user)).toHaveLength(2);
  expect(posterNameKeywords(user)).toBe('春野 @haruno');
  expect(matchingPreviousName(user, '')).toBe('');
  expect(matchingPreviousName(user, '凪')).toBe('');
  expect(matchingPreviousName(user, '春')).toBe('春野');
  expect(matchingPreviousName(user, '@HARUNO')).toBe('@haruno');
});
