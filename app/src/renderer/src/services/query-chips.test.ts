import { describe, expect, test } from 'vitest';
import { createQueryBuilder } from './query-chips';

describe('項目ごとの固定された結合方法', () => {
  const create = () => createQueryBuilder({ multiValueTypes: ['tag', 'hashtag', 'folder'], predOf: (f) => (item) => item[f.type].includes(f.value), onChange: () => {} });
  test('タグはAND、サイトはOR、項目間はAND', () => {
    const qb = create();
    for (const [type, value] of [
      ['tag', 'a'],
      ['tag', 'b'],
      ['platform', 'x'],
      ['platform', 'pixiv'],
    ])
      qb.addFilter({ type, value });
    expect(qb.eval({ tag: ['a', 'b'], platform: ['x'] })).toBe(true);
    expect(qb.eval({ tag: ['a', 'b'], platform: ['pixiv'] })).toBe(true);
    expect(qb.eval({ tag: ['a'], platform: ['x'] })).toBe(false);
    expect(qb.eval({ tag: ['a', 'b'], platform: ['misskey'] })).toBe(false);
  });
  test('保存されたORのタグ条件もANDに揃える', () => {
    const qb = create();
    qb.setTree({
      kind: 'group',
      op: 'and',
      neg: false,
      children: [
        {
          kind: 'group',
          op: 'or',
          neg: false,
          children: [
            { kind: 'cond', type: 'tag', value: 'a' },
            { kind: 'cond', type: 'tag', value: 'b' },
          ],
        },
      ],
    });
    expect(qb.eval({ tag: ['a'] })).toBe(false);
    expect(qb.eval({ tag: ['a', 'b'] })).toBe(true);
  });
});

describe('タグの実体とタグなし番兵', () => {
  test('同じ __none 値を独立して追加・選択・削除できる', () => {
    const qb = createQueryBuilder({ multiValueTypes: ['tag'], predOf: () => () => true, onChange: () => {} });
    qb.addFilter({ type: 'tag', value: '__none' });
    qb.addFilter({ type: 'tag', value: '__none', tagId: 42 });

    expect(qb.shadow()).toEqual([
      { type: 'tag', value: '__none' },
      { type: 'tag', value: '__none', tagId: 42 },
    ]);
    expect(qb.qHasTag(null, '__none')).toBe(true);
    expect(qb.qHasTag(42, '__none')).toBe(true);

    qb.removeFilter(qb.shadow().findIndex((f) => f.tagId === 42));
    expect(qb.shadow()).toEqual([{ type: 'tag', value: '__none' }]);
    expect(qb.qHasTag(null, '__none')).toBe(true);
    expect(qb.qHasTag(42, '__none')).toBe(false);
  });

  test('通常の id 付き作者タグは実体単位で重複を除く', () => {
    const qb = createQueryBuilder({ multiValueTypes: ['tag'], predOf: () => () => true, onChange: () => {} });
    qb.addFilter({ type: 'tag', value: '作者', tagId: 9 });
    expect(qb.addFilter({ type: 'tag', value: '作者', tagId: 9 })).toBeNull();
    expect(qb.addFilter({ type: 'tag', value: '作者', tagId: 10 })).not.toBeNull();
    expect(qb.shadow().map((f) => f.tagId)).toEqual([9, 10]);
  });
});
