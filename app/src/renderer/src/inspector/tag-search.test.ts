import { afterEach, describe, expect, test, vi } from 'vitest';
import { MAX_TAG_NAME_COMBINING_MARK_RUN, normalizeTagName } from '../../../../../native-host/tag-normalize.mts';
import { filterTagGroups, filterTagRows } from './tag-search.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('タグ候補の安全な検索', () => {
  test('危険な入力では候補ごとのNFKC正規化を始めない', () => {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    const query = 'a' + '\u0300'.repeat(MAX_TAG_NAME_COMBINING_MARK_RUN + 1);
    const groups = [{ id: 'group', name: '分類', items: [{ tag: '候補1' }, { tag: '候補2' }] }];
    const rows = [{ name: '作品1' }, { name: '作品2' }];

    expect(filterTagGroups(groups, query, () => true)).toEqual([]);
    expect(filterTagRows(rows, query)).toEqual([]);
    expect(normalize.mock.calls.filter(([form]) => form === 'NFKC')).toHaveLength(0);
  });

  test.each([
    ['通常の部分一致', 'illustration', ['Long Illustration Name']],
    ['日本語の表記ゆれ', 'ねこ', ['ネコ作品']],
    ['emoji', '🐈', ['猫🐈作品']],
    ['長い正常文字列', 'a'.repeat(20_000), [`prefix-${'a'.repeat(20_000)}-suffix`]],
  ])('%sを作品・キャラクター候補から検索できる', (_label, query, expected) => {
    const rows = expected.map((name) => ({ name }));
    expect(filterTagRows(rows, query)).toEqual(rows);
  });

  test('通常、日本語、emoji、長い正常文字列をタグ名とグループ名から検索できる', () => {
    const longName = '長'.repeat(20_000);
    const groups = [
      { id: 'normal', name: 'Category', items: [{ tag: 'Illustration' }] },
      { id: 'japanese', name: '動物', items: [{ tag: 'ネコ' }] },
      { id: 'emoji', name: '絵文字🐈', items: [{ tag: '別名' }] },
      { id: 'long', name: '長文', items: [{ tag: longName }] },
    ];

    expect(filterTagGroups(groups, 'illustration', () => true).map((group) => group.id)).toEqual(['normal']);
    expect(filterTagGroups(groups, 'ねこ', () => true).map((group) => group.id)).toEqual(['japanese']);
    expect(filterTagGroups(groups, '🐈', () => true).map((group) => group.id)).toEqual(['emoji']);
    expect(filterTagGroups(groups, longName, () => true).map((group) => group.id)).toEqual(['long']);
  });

  test.each([
    ['通常', '  Illustration  ', 'Illustration'],
    ['日本語', '  ネコ  ', 'ネコ'],
    ['emoji', '  猫🐈  ', '猫🐈'],
    ['長い正常文字列', `  ${'a'.repeat(20_000)}  `, 'a'.repeat(20_000)],
  ])('%sの入力からタグを作成できる', (_label, input, expected) => {
    expect(normalizeTagName(input)).toBe(expected);
  });
});
