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
