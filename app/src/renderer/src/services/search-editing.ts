// 検索ボックスとクエリの木のテキストの葉をつなぐ状態機械と、候補の選択の処理＝
// 「search-editing の service」。viewer.js から1対1で切り出した。
// 投稿モードの検索ボックスに打った値は、クエリの木の 'text' の葉に結び付く（自由文が、
// タグやプラットフォームなどと並ぶ本物の絞り込みの条件になる）＝このモジュールが持つのは、
// 今どの葉が「打たれている最中」か（editingTextNode。私的な状態）と、その状態の遷移だ。
// 打っている間は同期し、Enter で確定し、タブや履歴の復元の後は結び直し、具体的な候補が
// 選ばれた時は捨てる。描画と永続化の副作用（afterQueryChange/renderPosts）は注入された
// コールバックのまま＝このモジュールは DOM に一切触れない（tab-state.js の makeNavHistory や
// undo.js の makeUndo と同じ形で、閉じ込めた可変の状態と注入した副作用のコールバックであり、
// 純粋関数ではない）。

// deps の取り決め:
//   getTree() / addFilter(leaf) / removeNode(node)＝投稿側のクエリビルダーのインスタンス
//     （postQB）の木の操作を、束縛したラッパーとして渡す。
//   treeLeaves(tree)＝query.js の純粋な補助。
//   searchQuery() / setSearchBoxValue(v)＝検索ボックスの値の getter と setter。
//   afterQueryChange() / renderPosts()＝viewer.js の描画のやり直しのきっかけ。状態が
//     遷移した後に呼ぶ。
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
  // Enter が編集中の葉を確定する。今の入力欄の値をそこへ流し込んでから手放す＝葉は木に
  // 残り、入力欄は空になり、次の語は新しく始まる。
  function confirm() {
    sync();
    editingTextNode = null;
    setSearchBoxValue('');
    afterQueryChange();
  }
  // タブや履歴の状態を復元した後、編集中の葉を、復元された入力欄の値に一致する木の葉へ
  // 結び直す。そうすれば打ち込みを再開した時に、複製せずにそれを編集できる。
  function rebind() {
    editingTextNode = null;
    const val = (searchQuery() || '').trim();
    if (val) editingTextNode = treeLeaves(getTree()).find((c) => c.type === 'text' && c.value === val) || null;
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

  return { isEditingLeaf, onLeafMutated, clear, sync, confirm, rebind, pick };
}
