import { describe, expect, test, vi } from 'vitest';
import { makeQfPop } from './qf-pop-builder';
import { createQueryBuilder } from './query-chips';
import { makePostPredOf, makePosterPredOf } from './query';

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

describe('保存済み name-only タグ条件との統合', () => {
  const restored = (value: string): HologramQueryGroup => ({ kind: 'group', op: 'and', neg: false, children: [{ kind: 'cond', type: 'tag', value }] });

  test('post は復元後の述語評価で tree だけ ID 解決されても facet toggle で解除・再選択できる', () => {
    const predOf = makePostPredOf({ isInFolder: () => false, tagIdOf: (name) => (name === '作者' ? 31 : undefined) });
    const qb = createQueryBuilder({ multiValueTypes: ['tag'], predOf, onChange: () => {} });
    qb.setTree(restored('作者'));
    expect(qb.shadow()).toEqual([{ type: 'tag', value: '作者' }]);

    expect(qb.eval({ tags: ['作者'], tagIds: [31] })).toBe(true);
    expect((qb.getTree().children[0] as HologramQueryLeaf).tagId).toBe(31);
    expect(qb.shadow()).toEqual([{ type: 'tag', value: '作者' }]);

    const qf = makeQfPop({
      postShadow: qb.shadow,
      posterShadow: () => [],
      posterQHasValue: () => false,
      posterAddFilter: vi.fn(),
      posterRemoveByLeaf: vi.fn(),
      posterRemoveFilter: vi.fn(),
      addFilter: qb.addFilter,
      removeFilter: qb.removeFilter,
      buildUsers: () => [],
    });
    const row = { v: '作者', l: '作者', tagId: 31 };
    expect(qb.qHasTag(31, '作者')).toBe(true);
    qf.pickValue('tag', row);
    expect(qb.shadow()).toEqual([]);
    qf.pickValue('tag', row);
    expect(qb.shadow()).toEqual([{ type: 'tag', value: '作者', tagId: 31 }]);
  });

  test('poster も復元した name-only 条件を点灯し、facet toggle で解除・再選択できる', () => {
    const predOf = makePosterPredOf({ posterTagEntriesOf: () => [{ id: 41, name: '作者', label: '作者' }] });
    const qb = createQueryBuilder({ multiValueTypes: ['tag'], predOf, onChange: () => {}, tagNoneIsSentinel: false });
    qb.setTree(restored('作者'));
    expect(qb.eval({ key: 'poster' })).toBe(true);
    expect(qb.qHasTag(41, '作者')).toBe(true);

    const qf = makeQfPop({
      postShadow: () => [],
      posterShadow: qb.shadow,
      posterQHasValue: qb.qHasValue,
      posterAddFilter: qb.addFilter,
      posterRemoveByLeaf: qb.removeByLeaf,
      posterRemoveFilter: qb.removeFilter,
      addFilter: vi.fn(),
      removeFilter: vi.fn(),
      buildUsers: () => [],
    });
    const row = { v: '作者', l: '作者', tagId: 41 };
    qf.pickValue('poster-tag', row);
    expect(qb.shadow()).toEqual([]);
    qf.pickValue('poster-tag', row);
    expect(qb.shadow()).toEqual([{ type: 'tag', value: '作者', tagId: 41 }]);
  });

  test('poster の name-only 実在 __none タグも点灯し、解除・再選択できる', () => {
    const predOf = makePosterPredOf({ posterTagEntriesOf: () => [{ id: 51, name: '__none', label: '__none' }] });
    const qb = createQueryBuilder({ multiValueTypes: ['tag'], predOf, onChange: () => {}, tagNoneIsSentinel: false });
    qb.setTree(restored('__none'));
    expect(qb.eval({ key: 'poster' })).toBe(true);
    expect(qb.qHasTag(51, '__none')).toBe(true);

    const qf = makeQfPop({
      postShadow: () => [],
      posterShadow: qb.shadow,
      posterQHasValue: qb.qHasValue,
      posterAddFilter: qb.addFilter,
      posterRemoveByLeaf: qb.removeByLeaf,
      posterRemoveFilter: qb.removeFilter,
      addFilter: vi.fn(),
      removeFilter: vi.fn(),
      buildUsers: () => [],
    });
    const row = { v: '__none', l: '__none', tagId: 51 };
    qf.pickValue('poster-tag', row);
    expect(qb.shadow()).toEqual([]);
    qf.pickValue('poster-tag', row);
    expect(qb.shadow()).toEqual([{ type: 'tag', value: '__none', tagId: 51 }]);
  });
});
