import { describe, expect, test, vi } from 'vitest';
import { makeSearchEditing } from './search-editing';
import { makeSearchBox } from './search-box-builder';
import { store } from './store';

function fixture() {
  const tree: HologramQueryGroup = { kind: 'group', op: 'and', neg: false, children: [] };
  let value = '';
  const deps = {
    getTree: () => tree,
    treeLeaves: () => tree.children as HologramQueryLeaf[],
    addFilter: (leaf: any) => {
      const node = { kind: 'cond', ...leaf };
      tree.children.push(node);
      return node;
    },
    removeNode: (node: HologramQueryLeaf) => {
      tree.children = tree.children.filter((n) => n !== node);
    },
    searchQuery: () => value,
    setSearchBoxValue: (next: string) => {
      value = next;
    },
    afterQueryChange: vi.fn(),
    renderPosts: vi.fn(),
    renderPosters: vi.fn(),
  };
  return { deps, tree, edit: makeSearchEditing(deps) };
}

describe('検索欄の単一条件', () => {
  test('入力の変更は同じ条件を更新し、空欄で削除する', () => {
    const { deps, tree, edit } = fixture();
    deps.setSearchBoxValue('猫');
    edit.sync();
    const first = tree.children[0];
    deps.setSearchBoxValue('猫 イラスト');
    edit.sync();
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toBe(first);
    expect(edit.isEditingLeaf(first)).toBe(true);
    expect(deps.searchQuery()).toBe('猫 イラスト');
    deps.setSearchBoxValue('');
    edit.sync();
    expect(tree.children).toHaveLength(0);
  });
  test('旧形式の複数のAND検索を欄に戻し、編集で増殖させない', () => {
    const { deps, tree, edit } = fixture();
    deps.addFilter({ type: 'text', value: '猫' });
    deps.addFilter({ type: 'text', value: 'イラスト' });
    deps.addFilter({ type: 'tag', value: '保存' });
    edit.rebind();
    expect(deps.searchQuery()).toBe('猫 イラスト');
    deps.setSearchBoxValue('犬');
    edit.sync();
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]).toMatchObject({ type: 'text', value: '犬' });
    expect(tree.children[1]).toMatchObject({ type: 'tag', value: '保存' });
  });
  test('候補を選ぶと検索をタグ条件に置き換える', () => {
    const { deps, tree, edit } = fixture();
    deps.setSearchBoxValue('猫');
    edit.sync();
    edit.pick({ kind: 'tag', value: '猫' });
    expect(deps.searchQuery()).toBe('');
    expect(tree.children).toEqual([{ kind: 'cond', type: 'tag', value: '猫' }]);
  });
  test('更新処理はタイマーを待たず、呼び出し内で反映される', () => {
    const { deps, tree } = fixture();
    const box = makeSearchBox(deps);
    const previous = store.getState();
    try {
      store.setState({ browseMode: 'posts', searchQuery: '即時検索' });
      box.handleSearchQueryStoreChange();
      expect(tree.children).toEqual([{ kind: 'cond', type: 'text', value: '即時検索' }]);
    } finally {
      store.setState({ browseMode: previous.browseMode, searchQuery: previous.searchQuery });
    }
  });
});
