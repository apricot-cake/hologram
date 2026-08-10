// 検索ボックスの配線＝旧 viewer.ts のモノリスから抽出。クエリ木のテキストの
// 葉の状態機械（search-editing.ts）と、searchbox の React コンポーネント
// （searchbox.ts）へのサジェスト選択ブリッジは、すでに本物の ES モジュール
// として存在する――このモジュールは、以前は viewer.ts にインラインで
// あった view 固有の接着剤: ストアの `searchQuery` の getter/setter
// （入力とプログラムによる書き込みを見分けるエコーガード付き）と、入力中の
// デバウンスされた再描画。
//
// ストアは注入ではなく直接 import している（#1054）: その2つのアクセサが、
// ここで自由形式の文字列キーに対して型付けされていた唯一の deps で、型付き
// ストアだと注入には何の見返りも無い――それらを差し替えるテストは無い。
// postQB と描画／サイドバーのコールバックは引き続き viewer.ts が持つので、
// deps として注入される――query-builder.ts/kind-menu-builder.ts と同じ ctx
// パターン。
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
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
  // コンポーネント → ストア → 下の subscriber がデバウンスされた重い副作用を
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

  // 入力はストア経由で届く（searchbox コンポーネントがキー入力のたびに
  // push する）。150ms でデバウンス: キー入力のたびに約9千件のレコードを
  // フィルタ＋再描画するとカクつく＝入力が止んだ後にまとめる。注記:
  // renderPosts は引数無しで呼ぶ――真値の引数は keepLimit として扱われ
  // 履歴記録をスキップしてしまう。
  //
  // _liveToken はすべての search-editing の描画（入力の同期／Enter での
  // 確定／サジェスト選択）をくくる: 描画が走っている間、tabs-builder の
  // navCoalesceKey がそのバーストのトークンを読むので、1回の入力バーストが
  // 1つの履歴エントリに畳み込まれる（#144、今では解決済みの保留決定2――
  // 確定／選択はその同じエントリの書き換えとして着地し、バーストを終わらせる。
  // 次のバーストは新しいトークン＝新しいエントリを得る）。
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
  let _searchRenderTimer: any = null;
  function handleSearchQueryStoreChange() {
    const v = searchQuery();
    if (v === _searchEcho) return; // setSearchBoxValue のエコー＝その呼び出し元が自分で再描画する
    _searchEcho = v;
    clearTimeout(_searchRenderTimer);
    _searchRenderTimer = setTimeout(() => {
      asLiveSearch(() => {
        if (store.getState().browseMode === 'posters') {
          deps.renderPosters();
          return;
        }
        searchEditing.sync(); // posts: ボックスはクエリ木の 'text' の葉を編集する
      });
    }, 150);
  }

  // ボックスの「外」から来た語句でライブラリを検索する――今のところ選択
  // テキストの右クリックメニュー（#167）。あえてエコーの印を付けずにストア
  // へ push する。これでキー入力が通るのと同じパイプラインをこれも通る:
  // コンポーネントはストアから入力欄を再描画し、上の
  // handleSearchQueryStoreChange が今表示中のブラウズモード向けにデバウンス
  // されたフィルタ＋描画を実行する。同じ理由で、語句は（葉として確定
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

  // --- リアルタイム検索サジェスト ------------------------------------------
  // キー入力のたびに、全文検索と並んでタグ／投稿者の候補が検索ボックスの
  // すぐ下に表示される。クリック／Enter でそれを直接フィルタへ変える
  // （入力済みのテキストはクリアされる）。
  // searchbox コンポーネント（Base UI Autocomplete）が入力欄＋ドロップダウン
  // UI を持つ: 描画、キーボードナビ、開閉、位置決め。サジェストの「データ」
  // は今ではコマンド登録簿のもの（#28）――コンポーネントは queryEntries()
  // を直接読むので、行はパレットが見せるのと同じもの。旧 buildSuggest は
  // 無くなった。選択が「何をするか」は依然として searchEditing.pick で、
  // 登録簿のジャンプエントリもそれを呼ぶのでこのブリッジに残っている
  // ――1つの選択、2つの顔。onConfirmText は素の Enter の旧挙動を再現する:
  // posts モードだけがテキストの葉を確定する（poster／コレクションは
  // ボックスの値からライブにフィルタし、そこでは Enter は no-op）。
  initSearchBox({
    // pick/confirm も live-search として走る: それらの描画は入力バーストの
    // 履歴エントリを「書き換え」（入力されたテキストはフィルタを探すため
    // だったが、確定／選択された状態こそがそのエントリが持つべきもの）、
    // それからバーストを「終わらせる」。
    onPick: (it) => asLiveSearch(() => searchEditing.pick(it), true),
    onConfirmText: () => {
      if (store.getState().browseMode === 'posts' && searchQuery().trim()) {
        clearTimeout(_searchRenderTimer); // デバウンスより先に確定させ、葉が最新の値を持つようにする
        asLiveSearch(() => searchEditing.confirm(), true);
      }
    },
  });

  // `/` は検索ボックスへフォーカスする（ライブラリアプリの標準ショート
  // カット）。Ctrl+A（selection-builder.ts）と同じガード: フィールドや
  // 開いているオーバーレイからキーを奪うことは決してしない。旧 viewer.ts
  // のモノリスからの抽出はこれが最後になった――他の5つのグローバル
  // ショートカットハンドラ（nav／mouse-nav／undo／select-all／size）は
  // すでにそれぞれ自然なドメインの群れに吸収されていて、この検索ボックス
  // フォーカスのハンドラだけが動かないまま残っていた。登録は
  // GlobalShortcuts コンポーネント（app/App.tsx）にある。
  //
  // かつては Ctrl/Cmd+K もここに着地していたが、今ではコマンドパレットの
  // もの（#28、services/command-registry.ts）。この分割は意図的かつ固定:
  // `/` = このフィールドへフォーカス、Ctrl+K = パレットを開く。フィールドの
  // 右端のバッジがそれを教える。
  // #246: このコード（/、Shift は無視――元々 e.shiftKey もチェックして
  // いなかった。shortcut-registry.ts の ignoreShift の doc 参照）は今では
  // 登録簿にある。ここに残るのはガードの連鎖とアクションだけ。
  function canExecuteSearchFocus(e: KeyboardEvent) {
    if (isTypingTarget(e)) return false;
    if (confirmGet() || lightboxIsOpen()) return false;
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
