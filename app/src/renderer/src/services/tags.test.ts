import { describe, expect, test } from 'vitest';
import { makeTags, sameTags } from './tags';
import { createTranslator } from './translation';
import { postView } from '../../../../../tests/helpers/test-post-view';
const t = await createTranslator('ja');
function fixture() {
  const state = {
    labels: { people: '人物', angle: '角度', format: '形式', works: '作品', characters: 'キャラ', empty: '空のグループ' },
    memberships: {
      1: { id: 1, name: '正面', label: '正面', groupId: 'angle' },
      2: { id: 2, name: '漫画', label: '漫画', groupId: 'format' },
      3: { id: 3, name: '作品A', label: '作品A', groupId: 'works' },
      4: { id: 4, name: 'キャラA', label: 'キャラA', groupId: 'characters' },
    },
  };
  const api = makeTags({ tagGroups: () => state.memberships, tagLabels: () => state.labels, posterTags: () => ({ one: { tags: ['投稿者用'], tagIds: [8] } }), allPosts: () => [postView({ tags: ['正面', '自由タグ'], tagIds: [1, 7] })], t });
  return { state, api };
}
describe('一階層のタググループ', () => {
  test('任意のグループを所属先として参照する', () => {
    const { api } = fixture();
    expect(api.tagGroupOf(1)).toBe('angle');
    expect(api.tagGroupOfName('漫画')).toBe('format');
    expect(api.tagGroupOf(7)).toBeNull();
  });
  test('全グループと空グループを表示する', () => {
    const { api } = fixture();
    expect(api.groupedTagVocab().map((g) => g.name)).toEqual(['人物', '角度', '形式', '作品', 'キャラ', '空のグループ', '未分類']);
    expect(api.groupedTagVocab().find((g) => g.name === '空のグループ')?.tags).toEqual([]);
  });
  test('グループのタグは所属先だけに表示する', () => {
    const { api } = fixture();
    expect(api.groupedTagVocab().find((g) => g.name === '角度')?.tags).toEqual(['正面']);
    expect(api.groupedTagVocab().find((g) => g.name === '未分類')?.tags).toEqual(['自由タグ']);
  });
  test('作品とキャラに組み込みの表示名を持たない', () => {
    const { api } = fixture();
    expect(api.tagGroupLabel('work')).toBe('');
    expect(api.tagGroupLabel('character')).toBe('');
  });
  test('グループ名の変更を反映する', () => {
    const { state, api } = fixture();
    state.labels.angle = 'カメラ';
    expect(api.groupedTagVocab()[1].name).toBe('カメラ');
  });
  test('投稿者用の未分類タグは投稿用と分ける', () => {
    const { api } = fixture();
    expect(api.groupedTagVocab({ scope: 'poster' }).find((g) => g.name === '未分類')?.tags).toEqual(['投稿者用']);
  });
  test('投稿者のタグは直接付けたものだけを返す', () => {
    const { api } = fixture();
    expect(api.posterTagEntriesOf('one')).toEqual([{ id: 8, name: '投稿者用', label: '投稿者用' }]);
    expect(api.posterTagsOf('missing')).toEqual([]);
  });
});
test('タグの比較は順序に依存しない', () => {
  expect(sameTags(['a', 'b'], ['b', 'a'])).toBe(true);
  expect(sameTags(['a'], ['b'])).toBe(false);
  expect(sameTags([], [])).toBe(true);
  expect(sameTags(['a'], [])).toBe(false);
});
