// 検索ボックスの配線＝旧 viewer.ts のモノリスから抽出。クエリ木のテキストの
// 葉の状態機械（search-editing.ts）と、searchbox の React コンポーネント
// （searchbox.ts）へのサジェスト選択ブリッジは、すでに本物の ES モジュール
// として存在する――このモジュールは、以前は viewer.ts にインラインで
// あった view 固有の接着剤: ストアの `searchQuery` の getter/setter
// （入力とプログラムによる書き込みを見分けるエコーガード付き）と、入力中の
// 即時の再描画。
//
// ストアは注入ではなく直接 import している（#1054）: その2つのアクセサが、
// ここで自由形式の文字列キーに対して型付けされていた唯一の deps で、型付き
// ストアだと注入には何の見返りも無い――それらを差し替えるテストは無い。
// postQB と描画／サイドバーのコールバックは引き続き viewer.ts が持つので、
// deps として注入される――query-builder.ts/kind-menu-builder.ts と同じ ctx
// パターン。
import { get as confirmGet } from './confirm.ts';
import { makeSearchEditing } from './search-editing.ts';
import { focusSearchBox, init as initSearchBox } from './searchbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';
import { store } from './store.ts';

export interface SearchBoxDeps {
  getTree(): HologramQueryGroup;
  addFilter(leaf: { type: string; [k: string]: any }): HologramQueryLeaf | null;
  removeNode(node: HologramQueryLeaf): void;
  treeLeaves(tree: HologramQueryGroup): HologramQueryLeaf[];
  afterQueryChange(): void;
  renderPosts(): void;
  renderPosters(): void;
}

export function makeSearchBox(deps: SearchBoxDeps) {
  // hologramStore の 'searchQuery' が検索値そのもの。searchbox コンポーネント
  // はそれを制御された Base UI Autocomplete 入力として描画する。入力時:
  // コンポーネント → ストア → 下の subscriber が即時の重い副作用を
  // 実行する。プログラムによる書き込み（リセット／タブ・履歴の復元／葉の
  // 確定）: viewer → setSearchBoxValue → ストア → コンポーネントが入力欄を
  // 再描画する。_searchEcho がこの2つを見分ける――setSearchBoxValue の
  // どの呼び出し元も自分で再描画を引き起こすので、そのエコーを入力
  // パイプラインへも流すと二重描画になり、編集中のテキストの葉を churn
  // させてしまう。
  function searchQuery() {
    return store.getState().searchQuery;
  }
  let _searchEcho = '';
  function setSearchBoxValue(v: string | null | undefined) {
    _searchEcho = String(v ?? '');
    store.setState({ searchQuery: _searchEcho });
  }

  const searchEditing = makeSearchEditing({
    getTree: deps.getTree,
    addFilter: deps.addFilter,
    removeNode: deps.removeNode,
    treeLeaves: deps.treeLeaves,
    searchQuery,
    setSearchBoxValue,
    afterQueryChange: () => deps.afterQueryChange(),
    renderPosts: () => deps.renderPosts(),
  });
  function rebindEditingTextLeaf() {
    searchEditing.rebind();
  }

  // 連続入力による履歴の追加を一つにまとめる。
  let _liveToken: object | null = null;
  let _liveSearch = false;
  const liveSearchKey = (): unknown => (_liveSearch ? _liveToken : null);
  function asLiveSearch(fn: () => void, end?: boolean) {
    if (!_liveToken) _liveToken = {};
    _liveSearch = true;
    try {
      fn();
    } finally {
      _liveSearch = false;
      if (end) _liveToken = null;
    }
  }
  function handleSearchQueryStoreChange() {
    const v = searchQuery();
    if (v === _searchEcho) return; // setSearchBoxValue のエコー＝その呼び出し元が自分で再描画する
    _searchEcho = v;
    asLiveSearch(() => {
      if (store.getState().browseMode === 'posters') {
        deps.renderPosters();
        return;
      }
      searchEditing.sync(); // posts: ボックスはクエリ木の 'text' の葉を編集する
    });
  }

  // ボックスの「外」から来た語句でライブラリを検索する――今のところ選択
  // テキストの右クリックメニュー（#167）。あえてエコーの印を付けずにストア
  // へ push する。これでキー入力が通るのと同じパイプラインをこれも通る:
  // コンポーネントはストアから入力欄を再描画し、上の
  // handleSearchQueryStoreChange が今表示中のビューを即時に更新する。同じ理由で、語句は（葉として確定
  // させずに）ボックスに残す――「検索ボックスに入れておく」は利用者が
  // 見て、編集し、消せる状態であり、確定済みのフィルタ行はそうではない。
  function searchFor(text: string) {
    const v = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!v) return;
    store.setState({ searchQuery: v });
    focusSearchBox(); // 語句がどこに着地したかを示し、キャレットをそこに残す
  }

  initSearchBox({
    onPick: (it) => asLiveSearch(() => searchEditing.pick(it), true),
  });

  function canExecuteSearchFocus(e: KeyboardEvent) {
    if (isTypingTarget(e)) return false;
    if (confirmGet()) return false;
    if (settingsIsOpen()) return false;
    return true;
  }
  registerShortcut({
    id: 'search.focus',
    titleKey: 'shortcutSearchFocus',
    defaultCombo: '/',
    ignoreShift: true,
    canExecute: canExecuteSearchFocus,
    // コンポーネントが登録するフォーカス用コールバック（マウントするまでは no-op）＝#searchBox の id 契約は無くなった（P2④）
    perform: focusSearchBox,
  });

  function handleShortcutSearchFocusKey(e: KeyboardEvent) {
    tryRun('search.focus', e);
  }

  return {
    searchQuery,
    setSearchBoxValue,
    searchFor,
    handleSearchQueryStoreChange,
    rebindEditingTextLeaf,
    handleShortcutSearchFocusKey,
    searchEditing,
    liveSearchKey,
  };
}
