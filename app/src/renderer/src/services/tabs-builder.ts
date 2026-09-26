import type { Translate } from './translation.ts';
import { isEditing as isImageEditing } from './image-edit-controls.ts';
// nav の履歴（ブラウザ風の戻る／進む）と、ウィンドウのタブの CRUD ／バーとのやり取り＝
// 旧 viewer.ts のモノリスから切り出したもの。undo-builder.ts ／ selection-builder.ts と
// 同じ形をしている。状態機械（makeNavHistory と、tabs.json の直列化・復元の対）は
// tab-state.ts に手を触れず置いたまま＝このモジュールはその使い手で、viewer.ts の
// 埋め込みの結線を置き換える。加えて、hologramStore に載った tabs/activeTabId の
// アクセサ（かつての viewer.ts のローカル）と、ストリップが呼ぶタブの操作
// （switchTab/addTab/closeTab/duplicateTab/showTabMenu）も持つ。ストリップ自身は
// 今や自分の DOM イベントを自分で持つ＝ここからバーを見張っているものは何も無い（#621）。
//
// 画像ビューのまとまり（showImageView/hideImageView/openImageEntry/
// setImageTabIndex/toggleImageTabInspector/closeImageTab/addImageTab）は
// image-tab-builder.ts にある（#144 で type:'image' のタブを、タブごとに統一した履歴の
// 'image' エントリへ作り替えた）。このモジュールは showImageView/hideImageView を依存として
// 受け取り（遅らせた前方参照。undo-builder.ts の showToast/postGrid と同じ形）、まだ
// ローカルに残っているコードのために＝そして viewer.ts の別の場所で宣言している
// bootApp/postGrid 自身の依存のために＝タブの状態を呼び続けられるだけの面
// （getTabs/mutateTabs/getActiveTabId/setActiveTabId/activeTab/
// saveActiveTabState/nav/persistTabsDebounced/persistTabsNow/closeTab）を export する。
import { genTabId, makeNavHistory, navEntryUrl, sanitizeSavedTabs, loadTabs, persistTabs } from './tab-state.ts';
import { isOpen as fulltextIsOpen } from './fulltext-dialog.ts';
import { get as confirmGet } from './confirm.ts';
import { recordPush } from './history.ts';
import { cloneTree, facetTreeFrom } from './query.ts';
import { open as menuOpen } from './menu.ts';
import { imageTabGroup, imageTabTitleOf } from './records.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { registerShortcut, tryRun } from './shortcut-registry.ts';
import { store } from './store.ts';
import { hologramTabsSource } from './tabs.ts';

export interface TabsBuilderDeps {
  t: Translate;
  tabTitleOf(state: HologramTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string };
  postQB: { getTree(): HologramQueryGroup; setTree(t: HologramQueryGroup | null | undefined): void; shadow(): HologramQueryLeaf[] };
  getActiveFolderId(): string | null;
  setActiveFolderId(id: string | null | undefined): void;
  getSortValue(): string;
  setSortValue(v: string): void;
  getShuffleSeed(): string;
  setShuffleSeed(v: string): void;
  searchQuery(): string;
  setSearchBoxValue(v: string | null | undefined): void;
  rebindEditingTextLeaf(): void;
  renderPosts(keepLimit?: boolean): void;
  setLastRenderedState(json: string): void;
  getAllPostsCount(): number;
  resetAllFilters(): void;
  setBrowseModeLite(mode: 'posts' | 'posters'): void;
  contentScrollTop(): number;
  scrollContentTo(y: number): void;
  // 'posters' のエントリ向けの、投稿者側のビューの状態（#144 保留の判断3＝モードは今や
  // タブごとなので、投稿者の絞り込みの木／並び順／実時間の検索が履歴のエントリに乗る）。
  getPosterTree(): HologramQueryGroup;
  setPosterTree(t: HologramQueryGroup | null | undefined): void;
  getPosterSort(): string;
  setPosterSort(v: string): void;
  renderPosters(): void;
  restorePosterSelection(key: string | null): void;
  // 画像ビュー（画面に合わせて出す詳細）＝もうタブの種類ではなく、履歴の 'image' の
  // エントリ（#144 保留の判断1: 画像タブの統合）。
  showImageView(recs: string[], idx: number): void;
  hideImageView(): void;
  // #145: image のエントリの recs を、生きている投稿のレコードへ解決する。全体の履歴
  // ページのタイトル（imageTabTitleOf）のため＝image-tab-builder.ts 自身の
  // showImageView/openImageEntry が既に使っているのと同じ引き方。
  getPostById(id: string): HologramPost | undefined;
  // record() 向けの、まとめる時の手がかり。1回の編集のまとまりが進んでいる間（実時間の
  // 検索の打ち込み中や、ファセットエディタのセッションが開いている間）は null でない
  // 安定したキーを返し、後続の記録を push ではなく置き換えにする＝「1セッション、
  // 1エントリ」（保留の判断2）。
  navCoalesceKey(): unknown;
}

const NAV_CAP = 60;

export function makeTabsController(deps: TabsBuilderDeps) {
  // --- hologramStore に載ったタブの一覧（tabs/activeTabId） ---
  const getTabs = (): HologramTab[] => store.getState().tabs;
  const setTabs = (arr: HologramTab[]) => store.setState({ tabs: arr });
  function mutateTabs(fn: (arr: HologramTab[]) => HologramTab[] | undefined) {
    const copy = getTabs().slice();
    const result = fn(copy);
    setTabs(result || copy);
  }
  const getActiveTabId = (): string | null => store.getState().activeTabId;
  const setActiveTabId = (id: string | null) => store.setState({ activeTabId: id });
  const activeTab = () => getTabs().find((t) => t.id === getActiveTabId());
  let appBooted = false; // initTabs が保存したビューを適用するまで履歴をゲートで止める（早い段階の設定の描画から空のエントリが紛れ込むのを避ける）
  function markBooted() {
    appBooted = true;
  }
  let _tabPersistTimer: any = null;
  let restoringState = false;
  const closedTabs: { tab: HologramTab; index: number }[] = [];

  function snapshotState(): HologramTabSnapshot {
    return {
      // 正本は queryTree。f（影）はタブのタイトル（tabTitleOf が state.f を読む）と、
      // 古い形式で保存された状態を移行するために残してある。
      f: JSON.parse(JSON.stringify(deps.postQB.shadow())),
      tree: cloneTree(deps.postQB.getTree()),
      folderId: deps.getActiveFolderId(),
      search: deps.searchQuery(),
      sort: deps.getSortValue(),
      // 並び順のキーと一緒に運ばれる。復元したタブがシャッフルを再現できるように（#118）。
      shuffleSeed: deps.getShuffleSeed(),
      multi: store.getState().multiOnly,
    };
  }
  // 投稿者側のビューの状態＝'posters' のエントリの中身（snapshotState の鏡）。
  function snapshotPosterState() {
    const selectedPosterKey = store.getState().selectedPosterKey;
    return {
      tree: cloneTree(deps.getPosterTree()),
      sort: deps.getPosterSort(),
      search: deps.searchQuery(),
      inspectedPosterKey: selectedPosterKey,
    };
  }
  const entryOf = (kind: HologramNavEntry['kind'], state: any): HologramNavEntry => ({ u: navEntryUrl(kind, state), kind, state });
  // 今のビューを履歴のエントリとして表したもの＝image がモードに勝つ（画像ビューは、
  // そのタブが見ていたどのグリッドの上にも重なるため）。引き取り時に新しい履歴へ種を
  // 入れるのに使う。
  function snapshotEntry(): HologramNavEntry {
    const iv = store.getState().activeImageTab;
    if (iv) return entryOf('image', { recs: iv.recs, idx: iv.idx });
    if (store.getState().browseMode === 'posters') return entryOf('posters', snapshotPosterState());
    return entryOf('posts', snapshotState());
  }
  // nav.record を包む push／置き換えの振り分け。1回限りの置き換えフラグ（並び順の変更＝
  // 決着済みの保留の判断2の置き換え一覧）が、まとめる時のキー（実時間の打ち込み／
  // ファセットエディタ）に勝つ。
  let _navReplaceNext = false;
  function setNavReplaceNext() {
    _navReplaceNext = true;
  }
  function recordEntry(e: HologramNavEntry) {
    if (_navReplaceNext) {
      _navReplaceNext = false;
      nav.replace(e);
      return;
    }
    nav.record(e, deps.navCoalesceKey());
  }
  // 新しい renderPosts() のたびに呼ばれる。タブのタイトルと永続化を今の状態に揃え、下の
  // stickyRecs の変化の検出のためにそれを記録し、さらにタブごとの戻る／進むの履歴へも
  // 記録する（recordEntry を参照）。
  function syncTitleAndPersist() {
    if (store.getState().activeImageTab) return; // 画像ビューの下でのグリッドの描画は背面での更新
    const mode = store.getState().browseMode;
    if (mode !== 'posts') return; // 投稿者を見ている間の、隠れたグリッドの描画
    const snap = snapshotState();
    deps.setLastRenderedState(JSON.stringify(snap));
    if (restoringState) return;
    recordEntry(entryOf('posts', snap));
    clearAutoTitle();
    document.title = deps.tabTitleOf(snap, { allCount: deps.getAllPostsCount() }).text + ' — Hologram';
    persistTabsDebounced();
  }
  // 投稿者グリッド側の鏡（poster-grid-builder の deps.onPosterRendered）。新しい
  // renderPosters() のたびに 'posters' のエントリを記録する＝モードがタブごとになった今、
  // 投稿者の絞り込み／並び順／検索も履歴になった（#144 保留の判断3）。
  function syncPosterTitleAndPersist() {
    if (store.getState().activeImageTab) return;
    if (store.getState().browseMode !== 'posters') return;
    if (restoringState) return;
    recordEntry(entryOf('posters', snapshotPosterState()));
    clearAutoTitle();
    document.title = deps.t('browsePosters') + ' — Hologram';
    persistTabsDebounced();
  }
  // 投稿者カードの選択は一覧の絞り込みを変えないが、画像ビューから戻ったときに
  // 復元すべき投稿者を決めるビュー状態ではある。現在の履歴項目を置き換えて、
  // カードを選ぶたびに「戻る」を一段増やすことなく、その投稿者を保存する。
  function syncPosterInspection() {
    if (store.getState().activeImageTab) return;
    if (store.getState().browseMode !== 'posters') return;
    if (restoringState) return;
    nav.replace(entryOf('posters', snapshotPosterState()));
    persistTabsDebounced();
  }
  function applyState(s: HologramTabSnapshot) {
    restoringState = true;
    // 木（正本）を戻す。必要なら古い形式の状態（f と ops があって tree が無い）を移行する。
    deps.postQB.setTree(s.tree ? s.tree : facetTreeFrom(s.f || [], s.ops || {}));
    deps.setActiveFolderId(s.folderId);
    deps.setSearchBoxValue(s.search);
    deps.rebindEditingTextLeaf(); // 復元した語を複製せず、その編集を再開する
    deps.setSortValue(s.sort ?? 'date-desc');
    deps.setShuffleSeed(s.shuffleSeed || ''); // #118 より前の状態には種が無い＝random はその場合、選択時に種を作り直す
    store.setState({ multiOnly: !!s.multi });
    deps.renderPosts();
    restoringState = false;
    document.title = deps.tabTitleOf(s, { allCount: deps.getAllPostsCount() }).text + ' — Hologram';
  }
  // 種別による振り分け（#144 の核）。エントリが記述しているビューを復元する。
  // posts/posters は、setBrowseMode の描画のデバウンスを通さずに閲覧モードを入れ替える
  // （下のエントリ自身の描画がその描画そのもの）。image はグリッドの上にそのまま重なる。
  function applyEntry(e: HologramNavEntry) {
    _navReplaceNext = false; // 復元は、保留中の置き換えの手がかりを消費しない
    if (e.kind === 'image') {
      const st = e.state as { recs: string[]; idx: number };
      deps.showImageView(st.recs, st.idx);
      return;
    }
    deps.hideImageView();
    restoreScrollTop(e.scrollTop ?? 0);
    deps.setBrowseModeLite(e.kind === 'posters' ? 'posters' : 'posts');
    if (e.kind === 'posters') {
      const st = e.state as { tree?: any; sort?: string; search?: string; inspectedPosterKey?: string | null };
      restoringState = true;
      try {
        deps.setPosterTree(st.tree || null);
        deps.setPosterSort(st.sort || 'count');
        deps.setSearchBoxValue(st.search || '');
        deps.renderPosters();
        deps.restorePosterSelection(st.inspectedPosterKey || null);
      } finally {
        restoringState = false;
      }
      clearAutoTitle();
      document.title = deps.t('browsePosters') + ' — Hologram';
      return;
    }
    clearAutoTitle();
    applyState(e.state as HologramTabSnapshot);
  }
  // image のエントリは自分のタイトルをタブへ刻む（自動タイトル）。image のエントリを離れると、
  // それを消して、導出したグリッドのタイトルへ戻す。手での改名は撤去したので、タブが持てる
  // タイトルは自動タイトルだけ＝_autoTitle フラグは「タブが image を離れた時点でこの
  // タイトルは古くなる」という印として残っている。
  function clearAutoTitle() {
    const id = getActiveTabId();
    const t = getTabs().find((x) => x.id === id);
    if (!t || !t._autoTitle) return;
    mutateTabs((arr) => {
      const tt = arr.find((x) => x.id === id);
      if (tt) {
        tt.title = null;
        tt._autoTitle = false;
      }
    });
  }

  function entryTitleOf(e: HologramNavEntry): string {
    if (e.kind === 'image') {
      const st = e.state as { recs: string[]; idx: number };
      const g = imageTabGroup({ id: getActiveTabId() || '', recs: st.recs }, deps.getPostById);
      return g ? imageTabTitleOf(g, deps.t('imgTabFallback')) : deps.t('imgTabFallback');
    }
    if (e.kind === 'posters') return deps.t('browsePosters');
    return deps.tabTitleOf(e.state as HologramTabSnapshot, { allCount: deps.getAllPostsCount() }).text;
  }

  // --- ビューの履歴（ブラウザ風の戻る／進む） ---
  // 状態機械（hist/idx/上限/重複除去/進む側の枝の破棄/引き取り/置き換え/まとめ）は
  // tab-state.ts にある（makeNavHistory）。このモジュールが持つのは、エントリの組み立て、
  // 種別による振り分け、ストアのボタンの同期、永続化のためのフック。再 push は applyState の
  // restoringState が防ぐ。
  const nav = makeNavHistory({
    cap: NAV_CAP,
    enabled: () => appBooted,
    snapshot: snapshotEntry,
    apply: applyEntry,
    onChange: updateNavButtons,
    // #145: 本物の push の時にだけ発火する唯一のフック（置き換えでは発火しない）＝
    // tab-state.ts の onPush の doc を参照。recordPush 自身が、同じ u が連続する訪問を
    // アプリ全体で重複除去する（services/history.ts）。
    onPush: (e) => recordPush(e, entryTitleOf(e)),
  });
  // nav の戻る／進むの無効状態は、以前は押し込み型の activebar のモデルの一部だった。今の
  // activebar コンポーネントは、他のすべてを hologramStore から自分で導く。ただし nav の
  // canBack/canForward はストアではなく閉包（履歴のスタック）にある＝だからこれが、変化の
  // たびに写す処理として1つだけ残っている。
  function updateNavButtons() {
    store.setState({ navCanBack: nav.canBack() });
    store.setState({ navCanForward: nav.canForward() });
  }
  function navBack() {
    nav.saveScrollTop(deps.contentScrollTop());
    if (nav.back()) persistTabsDebounced();
  }
  function navForward() {
    nav.saveScrollTop(deps.contentScrollTop());
    if (nav.forward()) persistTabsDebounced();
  }
  // nav が譲るのは、打ち込み中と、オーバーレイが開いている時だけ＝投稿者も画像ビューも今は
  // 履歴の上にある（#144）ので、モードが戻る／進むのゲートになることはもう無い。
  function navAllowed() {
    if (confirmGet()) return false;
    if (settingsIsOpen()) return false;
    if (fulltextIsOpen()) return false;
    return true;
  }

  // マウスの戻る／進む（ボタン 3/4）。たいていのプラットフォームでは DOM のイベントが
  // レンダラーで発火する。preventDefault が、ページ内での余計な移動を止める。
  function handleShortcutMouseNav(e: MouseEvent) {
    if (isImageEditing()) return;
    if (e.button !== 3 && e.button !== 4) return;
    if (!navAllowed()) return;
    e.preventDefault();
    if (e.button === 3) navBack();
    else navForward();
  }

  // --- ウィンドウのタブ ---
  const TAB_ICONS = {
    all: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
    hashtag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    users:
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></svg>',
    platform: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    postType: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    media: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    date: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    kind: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    // ゴミ箱（#268）＝lucide の trash-2 で、サイドバーの項目が付けているのと同じグリフ。
    trash:
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  };
  function persistTabsNow() {
    clearTimeout(_tabPersistTimer);
    saveActiveTabState(); // スナップショットを取り、生きている履歴も運ぶ（今は永続化する＝#144 保留の判断5）
    persistTabs(getTabs(), getActiveTabId());
  }
  function persistTabsDebounced() {
    clearTimeout(_tabPersistTimer);
    _tabPersistTimer = setTimeout(persistTabsNow, 800);
  }
  function saveActiveTabState() {
    const t = getTabs().find((t) => t.id === getActiveTabId());
    if (!t) return;
    const cur = nav.current();
    if (!cur || cur.kind === 'posts') {
      t.state = snapshotState();
      t._scrollTop = deps.contentScrollTop(); // コンテンツのスクロール位置をタブごとに覚える（これも永続化する）
    }
    nav.saveInto(t); // 戻る／進むの履歴をタブと一緒に運ぶ
  }
  // タブが覚えているコンテンツのスクロール位置を戻す。描画したばかりのグリッドの配置が
  // 済むよう rAF を2回挟む。仮想化するグリッドは、自分の窓を scrollTop だけから
  // 導く（推定した入れ物の高さは既に全項目分ある）。
  let scrollRestoreFrame = 0;
  function restoreScrollTop(y: number) {
    cancelAnimationFrame(scrollRestoreFrame);
    scrollRestoreFrame = requestAnimationFrame(() => {
      scrollRestoreFrame = requestAnimationFrame(() => deps.scrollContentTo(y));
    });
  }
  function restoreTabView(t: HologramTab | null | undefined) {
    if (!t) return;
    const y = typeof t._scrollTop === 'number' ? t._scrollTop : 0;
    restoreScrollTop(y);
  }
  // モデルの導出（タイトルとアイコン）は services/tabs.ts の hologramTabsSource にある＝
  // あちらは、下のどの書き換えも書き込むのと同じ hologramStore のキーから引く
  // （tabs/activeTabId と、今のタブの導出タイトルのための
  // postQueryTree/searchQuery/sortPost/multiOnly/allPostsCount）。だからここでモデルを
  // 組むことも、押し込むこともない。あちらが必要とするピンのグリフと、閉じる／新規の
  // i18n の文字列は、下で一度だけ渡す。
  hologramTabsSource.configure({
    tabTitleOf: deps.tabTitleOf,
    tabIcons: TAB_ICONS,
    closeTitle: deps.t('tabClose'),
    newTitle: deps.t('tabNew'),
    postersTitle: deps.t('browsePosters'),
    trashTitle: deps.t('trashTitle'),
    imageFallbackTitle: deps.t('imgTabFallback'),
  });
  // タブのオブジェクトを選択状態にする。その履歴を引き取り、今のエントリを適用し直す
  // （スタックは、そのタブがどのビュー＝posts/posters/image＝にいたかを知っている）。
  // 使えるスタックが無いタブ（新しいタブ、または永続化した nav の行がすべて不正として
  // 落とされた場合）は素朴な状態の経路を代わりに使い、その後、適用したビューから新しい
  // 履歴へ種を入れる。
  function activateTab(t: HologramTab) {
    if (Array.isArray(t._navHist) && t._navHist.length) {
      nav.adopt(t);
      nav.applyCurrent();
    } else {
      deps.hideImageView();
      deps.setBrowseModeLite('posts');
      if (t.state) applyState(t.state);
      else deps.renderPosts();
      nav.adopt(t);
    }
  }
  function switchTab(id: string) {
    if (id === getActiveTabId()) return;
    saveActiveTabState();
    setActiveTabId(id);
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    activateTab(t);
    restoreTabView(t);
    persistTabsDebounced();
  }
  function addTab() {
    saveActiveTabState();
    deps.hideImageView(); // 画像ビューからの Ctrl+T は、新しいグリッドのタブに着く
    deps.setBrowseModeLite('posts'); // 新しいタブは必ず投稿グリッドで開く（まっさらなビュー）
    const id = genTabId();
    mutateTabs((arr) => {
      arr.push({ id, pinned: false, title: null, state: { f: [], ops: {}, tree: null, search: '', sort: 'date-desc', multi: false } });
    });
    setActiveTabId(id);
    applyState({ f: [], ops: {}, folderId: null, search: '', sort: deps.getSortValue(), shuffleSeed: deps.getShuffleSeed(), multi: false });
    nav.adopt(getTabs().find((t) => t.id === id)); // 新しいタブ → 新しい履歴（空のビューを種として入れる）
    requestAnimationFrame(() => deps.scrollContentTo(0)); // 新しいタブは先頭から始まる
    persistTabsDebounced();
  }
  function openTextSearchTab(query: string) {
    saveActiveTabState();
    deps.hideImageView();
    deps.setBrowseModeLite('posts');
    const id = genTabId();
    const state: HologramTabSnapshot = { f: [{ type: 'text', value: query }], ops: {}, tree: null, folderId: null, search: query, sort: 'date-desc', multi: false };
    mutateTabs((arr) => {
      arr.push({ id, pinned: false, title: null, state });
    });
    setActiveTabId(id);
    applyState(state);
    nav.adopt(getTabs().find((t) => t.id === id));
    requestAnimationFrame(() => deps.scrollContentTo(0));
    persistTabsDebounced();
  }
  // #145: 履歴行の左クリック＝「現在タブで復元してパネルを閉じる」。復元は意図して、戻る／
  // 進むの移動ではなく新規の訪問として扱う。applyEntry() だけなら（自身の restoringState の
  // 防ぎの下で）何も記録せずにビューを戻す。タブの切り替えと同じ挙動になる。だが設計の
  // 受け入れ条件は、復元それ自体が push だと言っている（「復元による遷移は当然 push＝
  // 履歴にも1行増える」）。だから restoringState が false に戻った直後に、recordEntry() を
  // 明示的に走らせる。
  function openHistoryEntry(e: HologramNavEntry) {
    applyEntry(e);
    recordEntry(e);
    persistTabsDebounced();
  }
  // #145: 履歴行の中クリック＝「バックグラウンド新タブ」（Chrome のリンク中クリックの
  // 作法）。addTab()／switchTab() は意図して通さない。あちらは必ず新しいタブを選択状態に
  // するので、中クリックのたびに、利用者が見ていたものから焦点をもぎ取ってしまう。タブは
  // nav のスタックに種を入れた状態（_navHist/_navIdx）で組む。duplicateTab() が作るのと
  // 同じ形＝利用者が実際にそのタブへ切り替えた最初の時に、activateTab() が nav.adopt()
  // 経由で拾う。だからここは、生きている `nav` の閉包（今選択されているタブのもの）に
  // 一切触れない。
  function openHistoryEntryInBackgroundTab(e: HologramNavEntry, title: string) {
    const isGrid = e.kind === 'posts';
    const t: HologramTab = {
      id: genTabId(),
      pinned: false,
      title: e.kind === 'image' ? title : null,
      _autoTitle: e.kind === 'image',
      state: isGrid ? (e.state as HologramTabSnapshot) : null,
      _navHist: [JSON.stringify(e)],
      _navIdx: 0,
    };
    mutateTabs((arr) => {
      arr.push(t);
    });
    persistTabsDebounced();
  }

  function closeTab(id: string | null | undefined) {
    const idx = getTabs().findIndex((t) => t.id === id);
    if (idx < 0) return;
    saveActiveTabState();
    closedTabs.push({ tab: JSON.parse(JSON.stringify(getTabs()[idx])), index: idx });
    if (closedTabs.length > 20) closedTabs.shift();
    if (getTabs().length <= 1) {
      // ウィンドウには空のタブを1枚残す。閉じたタブは復元用に別に保持する。
      addTab();
    }
    const wasActive = getActiveTabId() === id;
    mutateTabs((arr) => {
      arr.splice(idx, 1);
    });
    const nextActive = wasActive ? getTabs()[Math.min(idx, getTabs().length - 1)] : null;
    if (nextActive) {
      setActiveTabId(nextActive.id);
      activateTab(nextActive);
      restoreTabView(nextActive);
    }
    persistTabsDebounced();
  }
  function reopenClosedTab() {
    const closed = closedTabs.pop();
    if (!closed) return;
    saveActiveTabState();
    mutateTabs((arr) => {
      const index = Math.min(closed.index, arr.length);
      arr.splice(index, 0, closed.tab);
    });
    setActiveTabId(closed.tab.id);
    activateTab(closed.tab);
    restoreTabView(closed.tab);
    persistTabsDebounced();
  }
  function duplicateTab(id: string) {
    saveActiveTabState(); // src が選択中なら、生きている履歴を src へ書き出す
    const src = getTabs().find((t) => t.id === id);
    if (!src) return;
    const idx = getTabs().indexOf(src);
    const nt: HologramTab = {
      id: genTabId(),
      pinned: false,
      title: src.title,
      _autoTitle: src._autoTitle,
      state: JSON.parse(JSON.stringify(src.state || {})),
      // Chrome 風。複製したタブは、戻る／進むのスタックを丸ごと持っていく。
      _navHist: Array.isArray(src._navHist) ? src._navHist.slice() : undefined,
      _navIdx: src._navIdx,
    };
    mutateTabs((arr) => {
      arr.splice(idx + 1, 0, nt);
    });
    setActiveTabId(nt.id);
    if (Array.isArray(nt._navHist) && nt._navHist.length) {
      nav.adopt(nt);
      nav.applyCurrent();
    } else {
      deps.hideImageView();
      deps.setBrowseModeLite('posts');
      if (nt.state && Object.keys(nt.state).length) applyState(nt.state);
      else deps.renderPosts();
      nav.adopt(nt);
    }
    persistTabsDebounced();
  }

  async function initTabs() {
    try {
      const saved = await loadTabs();
      const st = sanitizeSavedTabs(saved, genTabId); // 使えるものが何も保存されていなければ null
      if (st) {
        setTabs(st.tabs);
        setActiveTabId(st.activeTabId);
      } else {
        const id = genTabId();
        setTabs([{ id, pinned: false, title: null, state: null }]);
        setActiveTabId(id);
      }
      const at = getTabs().find((t) => t.id === getActiveTabId());
      // 選択中のタブのビューの状態を、描画せずに戻す（初回の描画は bootApp の loadPosts が
      // 走らせる）。ビューを決めるのは今の履歴のエントリ（#144 のモードのタブごと化）。
      // posters なら投稿者の木とモードを戻す。image のエントリなら、その下にある投稿側の
      // 欄を戻し（image から戻るとそこに着く）、ライブラリが読み込まれた後で bootApp が
      // 画像ビューを開く。
      const cur = at && Array.isArray(at._navHist) && at._navHist.length ? (JSON.parse(at._navHist[Math.max(0, Math.min(at._navIdx ?? at._navHist.length - 1, at._navHist.length - 1))]) as HologramNavEntry) : null;
      if (cur && cur.kind === 'posters') {
        const st = cur.state as { tree?: any; sort?: string; search?: string };
        restoringState = true; // sortPoster へのストアの書き込みが、利用者による並び順の変更として読まれてはいけない
        deps.setPosterTree(st.tree || null);
        deps.setPosterSort(st.sort || 'count');
        deps.setSearchBoxValue(st.search || '');
        restoringState = false;
        deps.setBrowseModeLite('posters');
      } else if (at && at.state) {
        // 正本は queryTree。古い形式の状態（f と ops があって tree が無い）は移行する。
        deps.postQB.setTree(at.state.tree ? at.state.tree : facetTreeFrom(at.state.f || [], at.state.ops || {}));
        deps.setActiveFolderId(at.state.folderId);
        deps.setSearchBoxValue(at.state.search || '');
        deps.rebindEditingTextLeaf();
        deps.setSortValue(at.state.sort || 'date-desc');
        deps.setShuffleSeed(at.state.shuffleSeed || ''); // #118＝シャッフルの順序を、その並び順と一緒に戻す
        store.setState({ multiOnly: !!at.state.multi });
      }
      nav.adopt(at); // 永続化したスタックを引き取る（または、戻したビューから種を入れる）
    } catch (err) {
      console.error('initTabs error:', err);
      const id = genTabId();
      setTabs([{ id, pinned: false, title: null, state: null }]);
      setActiveTabId(id);
      nav.adopt(getTabs()[0]);
    }
  }
  // タブの右クリックメニュー（タブを右クリック）＝複製／閉じる／他を閉じる。
  // すりガラスのメニューは React 側（menu.ts）が持ち、このモジュールは項目と操作を持つ。
  // ストリップが自分の onContextMenu から直接呼ぶ＝バーに委譲リスナーはもう無い（#621）。
  //
  // 「名前を変更」の行は無い。手でタブの名前を変える機能は再設計で撤去した（2026-07-13）。
  // Chrome も VS Code も改名を持たないのと同じで、タブの名前は、そこが何を出しているかから
  // 導く（tabTitleOf）。
  function showTabMenu(id: string, e: { clientX: number; clientY: number }) {
    const t = getTabs().find((t) => t.id === id);
    if (!t) return;
    const items: any[] = [{ label: deps.t('tabDuplicate'), act: 'duplicate' }];
    if (getTabs().length > 1) {
      items.push({ label: deps.t('tabClose'), act: 'close' });
      items.push({ label: deps.t('tabCloseOthers'), act: 'close-others', danger: true });
    }
    menuOpen({ items, x: e.clientX, y: e.clientY + 4 }, (item) => {
      const tid = id;
      const act = item.act;
      if (act === 'duplicate') duplicateTab(tid);
      else if (act === 'close') closeTab(tid);
      else if (act === 'close-others') {
        switchTab(tid);
        for (const tab of [...getTabs()].reverse()) {
          if (tab.id !== tid) closeTab(tab.id);
        }
      }
    });
  }
  // 中クリック（ホイール）でタブを閉じる。規則は ✕ ボタンと同じで、最後に残った1枚はそのまま残る。どのタブが当たったかを決めるのはストリップ（描いている
  // のがそちらだから）。ここにあるのは規則。
  function closeTabByGesture(id: string) {
    const t = getTabs().find((x) => x.id === id);
    if (t && getTabs().length > 1) closeTab(t.id);
  }
  function canExecuteTabShortcut() {
    return !fulltextIsOpen();
  }

  registerShortcut({ id: 'tabs.new', titleKey: 'shortcutNewTab', defaultCombo: 'Ctrl+t', canExecute: canExecuteTabShortcut, perform: addTab });
  registerShortcut({ id: 'tabs.reopen', titleKey: 'shortcutReopenTab', defaultCombo: 'Ctrl+Shift+t', canExecute: canExecuteTabShortcut, perform: reopenClosedTab });
  registerShortcut({ id: 'tabs.close', titleKey: 'shortcutCloseTab', defaultCombo: 'Ctrl+w', ignoreShift: true, canExecute: canExecuteTabShortcut, perform: () => closeTab(getActiveTabId()) });

  function handleGlobalTabShortcut(e: KeyboardEvent) {
    if (tryRun('tabs.new', e)) return;
    if (tryRun('tabs.reopen', e)) return;
    tryRun('tabs.close', e);
  }

  return {
    getTabs,
    setTabs,
    mutateTabs,
    getActiveTabId,
    setActiveTabId,
    activeTab,
    markBooted,
    nav,
    snapshotState,
    syncTitleAndPersist,
    syncPosterTitleAndPersist,
    syncPosterInspection,
    setNavReplaceNext,
    isRestoring: () => restoringState,
    navBack,
    navForward,
    navAllowed,
    handleShortcutMouseNav,
    persistTabsNow,
    persistTabsDebounced,
    saveActiveTabState,
    restoreTabView,
    switchTab,
    addTab,
    openTextSearchTab,
    openHistoryEntry,
    openHistoryEntryInBackgroundTab,
    closeTab,
    closeTabByGesture,
    duplicateTab,
    showTabMenu,
    initTabs,
    handleGlobalTabShortcut,
  };
}
