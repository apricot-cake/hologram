// 検索欄は一つのテキスト条件を編集する。候補を選んだ場合は明示的なフィルタへ置き換える。
export interface SearchEditingDeps {
  getTree(): HologramQueryGroup;
  addFilter(leaf: { type: string; [k: string]: any }): HologramQueryLeaf | null;
  removeNode(node: HologramQueryLeaf): void;
  treeLeaves(tree: HologramQueryGroup): HologramQueryLeaf[];
  searchQuery(): string;
  setSearchBoxValue(v: string): void;
  afterQueryChange(): void;
  renderPosts(): void;
}

export function makeSearchEditing(deps: SearchEditingDeps) {
  const { getTree, addFilter, removeNode, treeLeaves, searchQuery, setSearchBoxValue, afterQueryChange, renderPosts } = deps;
  let editingTextNode: HologramQueryLeaf | null = null;

  function isEditingLeaf(node: unknown) {
    return node === editingTextNode;
  }
  // クエリビルダーの onLeafMutated。結び付いていた葉が消されたか、別の場所へドラッグ
  // された＝結び付きを外し、打ち込みが孤児のノードを書き換えないようにする。
  function onLeafMutated(node: unknown) {
    if (node === editingTextNode) {
      editingTextNode = null;
      setSearchBoxValue('');
    }
  }
  // 木が足元でリセットされたか置き換わった（例えば resetAllFilters）＝検索ボックスに
  // 触れずに、結び付いていた葉を忘れる。
  function clear() {
    editingTextNode = null;
  }
  // 検索ボックスを、結び付いた 'text' の葉へ写す。空なら葉を消し、そうでなければ編集中の
  // 葉をその場で更新するか、新しく作って結び付ける。
  function sync() {
    // 自分で直す。結び付いていた葉がリセットや置き換えで木から外れていたら、それを忘れる
    // （そうしないと、下の Object.assign が孤児のノードを書き換えてしまう）。
    if (editingTextNode && !treeLeaves(getTree()).includes(editingTextNode)) editingTextNode = null;
    const val = (searchQuery() || '').trim();
    if (!val) {
      if (editingTextNode) {
        const n = editingTextNode;
        editingTextNode = null;
        removeNode(n);
      } else renderPosts();
      return;
    }
    if (editingTextNode) {
      editingTextNode.value = val;
      afterQueryChange();
    } else {
      editingTextNode = addFilter({ type: 'text', value: val }) || treeLeaves(getTree()).find((c) => c.type === 'text' && c.value === val) || null;
      if (!editingTextNode) renderPosts();
    }
  }
  // タブや履歴の状態を復元した後、編集中の葉を、復元された入力欄の値に一致する木の葉へ
  // 結び直す。そうすれば打ち込みを再開した時に、複製せずにそれを編集できる。
  function rebind() {
    editingTextNode = null;
    const tree = getTree();
    // 旧形式のANDで並ぶテキスト条件を、同じ意味の一つの検索語へまとめる。
    // ORや否定を含む保存条件は意味を変えず、そのまま残す。
    if (tree.op === 'and' && !tree.neg) {
      const leaves = tree.children.filter((n): n is HologramQueryLeaf => n.kind === 'cond' && n.type === 'text' && !n.neg);
      if (leaves.length) {
        editingTextNode = leaves[0];
        const value = [...new Set(leaves.map((n) => String(n.value || '').trim()).filter(Boolean))].join(' ');
        editingTextNode.value = value;
        tree.children = tree.children.filter((n) => !leaves.slice(1).includes(n as HologramQueryLeaf));
        setSearchBoxValue(value);
      }
    }
  }
  // 具体的な候補の選択（タグや投稿者）は、書きかけの自由文の語に勝つ＝打った文字は絞り込みを
  // 探すためのもので、残しておくべき本文の検索ではない。
  function pick(it: { kind: string; value: string; label?: string } | null | undefined) {
    if (!it) return;
    setSearchBoxValue('');
    if (editingTextNode) {
      const n = editingTextNode;
      editingTextNode = null;
      removeNode(n);
    }
    if (it.kind === 'tag') addFilter({ type: 'tag', value: it.value });
    else if (it.kind === 'user') addFilter({ type: 'user', value: it.value, label: it.label });
  }

  return { isEditingLeaf, onLeafMutated, clear, sync, rebind, pick };
}
