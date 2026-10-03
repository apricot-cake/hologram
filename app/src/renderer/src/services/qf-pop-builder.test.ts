import { describe, expect, test, vi } from 'vitest';
import { makeQfPop } from './qf-pop-builder';

describe('タグ行のトグル対象', () => {
  test('postShadow で実在 __none タグとタグなし番兵を区別する', () => {
    const removeFilter = vi.fn();
    const addFilter = vi.fn();
    const deps = {
      postShadow: () => [
        { type: 'tag', value: '__none' },
        { type: 'tag', value: '__none', tagId: 71 },
      ],
      posterShadow: () => [],
      posterQHasValue: () => false,
      posterAddFilter: vi.fn(),
      posterRemoveByLeaf: vi.fn(),
      posterRemoveFilter: vi.fn(),
      addFilter,
      removeFilter,
      buildUsers: () => [],
    };
    const qf = makeQfPop(deps);

    qf.pickValue('tag', { v: '__none', l: 'タグなし' });
    expect(removeFilter).toHaveBeenLastCalledWith(0);
    qf.pickValue('tag', { v: '__none', l: '__none（実タグ）', tagId: 71 });
    expect(removeFilter).toHaveBeenLastCalledWith(1);
    expect(addFilter).not.toHaveBeenCalled();
  });

  test('同じ値の対象が無ければ行全体の tagId と label を追加へ渡す', () => {
    const addFilter = vi.fn();
    const qf = makeQfPop({
      postShadow: () => [{ type: 'tag', value: '__none' }],
      posterShadow: () => [],
      posterQHasValue: () => false,
      posterAddFilter: vi.fn(),
      posterRemoveByLeaf: vi.fn(),
      posterRemoveFilter: vi.fn(),
      addFilter,
      removeFilter: vi.fn(),
      buildUsers: () => [],
    });

    qf.pickValue('tag', { v: '__none', l: '__none（実タグ）', tagId: 72 });
    expect(addFilter).toHaveBeenCalledWith({ type: 'tag', value: '__none', tagId: 72, label: '__none（実タグ）' });
  });
});
