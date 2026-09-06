// image view のコントローラ（Eagle 流の画面全体フィット詳細表示）――#144 が
// 旧来の image タブ（type:'image'）を、統一されたタブごとの戻る／進む
// スタック上の 'image' 履歴エントリへ作り替えた: ダブルクリックは現在の
// タブに image エントリを push する（離れるのはナビの戻る）。中クリックは
// 履歴が単一の image エントリであるバックグラウンドタブを開く（戻るは
// 無効のまま――確認済み（保留項目1））。このモジュールが持つのは view の
// 表示・非表示（hologramStore の 'activeImageTab' → ImageTabHost
// コンポーネントが React モデル全体をそこから導出する）、ギャラリー索引
// （push ではなく replace――確認済み（保留項目2））、タブタイトルの刻印
// （_autoTitle）。スタック自体は tabs-builder.ts の nav にある（deps として
// 渡される）。
import { imageEntrySelection } from './reply-thread.ts';
import { imageTabGroup, imageTabTitleOf, postKeyOf } from './records.ts';
import { isVisible as panelIsVisible, setOpen as panelSetOpen } from './inspector-panel.ts';
import { reveal as panelsReveal } from './panels.ts';
import { genTabId, navEntryUrl } from './tab-state.ts';
import { store } from './store.ts';

export interface ImageTabBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getPostById(id: string): HologramPost | undefined;
  viewedPostIdAt(g: HologramPostGroup, idx: number): string | null;
  recordView(captureId: string): void;
  showDetail(g: HologramPostGroup): void;
  dismissDetail(): void;
  closeTab(id: string | null | undefined): void;
  getActiveTabId(): string | null;
  setActiveTabId(id: string | null): void;
  mutateTabs(fn: (arr: HologramTab[]) => HologramTab[] | undefined): void;
  saveActiveTabState(): void;
  nav: {
    adopt(t: HologramTab | null | undefined): void;
    applyCurrent(): void;
    push(e: HologramNavEntry): void;
    replace(e: HologramNavEntry): void;
    current(): HologramNavEntry | null;
    canBack(): boolean;
  };
  navBack(): void;
  persistTabsDebounced(): void;
}

type ImageEntry = { kind?: string; state?: { recs?: unknown; idx?: unknown } };

function imageEntryFor(t: HologramTab): ImageEntry | null {
  const hist = t._navHist;
  if (!Array.isArray(hist) || !hist.length) return null;
  const idx = typeof t._navIdx === 'number' ? t._navIdx : hist.length - 1;
  try {
    const entry = JSON.parse(hist[idx]) as ImageEntry;
    return entry?.kind === 'image' && Array.isArray(entry.state?.recs) ? entry : null;
  } catch (_e) {
    return null;
  }
}

// 画像ビューへの入場は毎回1閲覧。ビューの中のページめくりは、表示対象の投稿が
// 変わった時だけ1閲覧。同じ投稿に属する2枚目、3枚目では増やさない。
export function makePostViewRecorder(recordView: (captureId: string) => void) {
  let visiblePostId: string | null = null;
  return {
    enter(postId: string | null) {
      if (!postId) return;
      visiblePostId = postId;
      recordView(postId);
    },
    move(postId: string | null) {
      if (!postId || postId === visiblePostId) return;
      visiblePostId = postId;
      recordView(postId);
    },
    leave() {
      visiblePostId = null;
    },
  };
}

// タブの image 名は、保存されたラベルではなく今の image エントリの投影。
// ライブラリが変わった後は開いているすべての image タブを再評価し、削除は
// 中立の名前へフォールバックし、レコードの復元はその名前を復元する。
export function refreshImageTabTitles(tabs: HologramTab[], activeTabId: string | null, activeEntry: HologramNavEntry | null, getPostById: (id: string) => HologramPost | undefined, fallback: string): boolean {
  let changed = false;
  for (const t of tabs) {
    const entry = t.id === activeTabId ? activeEntry : imageEntryFor(t);
    const state = entry?.state as { recs?: unknown } | undefined;
    if (entry?.kind !== 'image' || !Array.isArray(state?.recs)) continue;
    const g = imageTabGroup({ id: t.id, recs: state.recs as string[] }, getPostById);
    const title = g ? imageTabTitleOf(g, fallback) : fallback;
    if (t.title !== title || !t._autoTitle) {
      t.title = title;
      t._autoTitle = true;
      changed = true;
    }
  }
  return changed;
}

export function makeImageTabController(deps: ImageTabBuilderDeps) {
  // recs は使うたびに生きたライブラリに照らして解決される（imageTabGroup、
  // records.ts）ので、削除は壊れた画像ではなく「missing」の空状態に落ち
  // 着く。キャッシュされたグループ（_g）はもう無い――解決はマップ検索。
  const resolveGroup = (recs: string[]) => imageTabGroup({ id: deps.getActiveTabId() || '', recs }, (id) => deps.getPostById(id));

  const imageEntry = (recs: string[], idx: number): HologramNavEntry => ({ u: navEntryUrl('image', { recs, idx }), kind: 'image', state: { recs, idx } });

  // view の identity を hologramStore へ公開する――services/image-tab.ts が
  // React モデル全体をここから導出する（ライブラリの変化については
  // posts-data.ts と、インスペクタの状態については 'inspectedKey' と
  // 掛け合わせて）。
  function publish(recs: string[], idx: number) {
    store.setState({ activeImageTab: { id: deps.getActiveTabId() || '', recs, idx } });
  }

  // image のタイトルをアクティブなタブに刻む（自動タイトル――グリッドの
  // エントリが再びカレントになったとき tabs-builder がクリアする）。
  function stampTabTitle(title: string) {
    const id = deps.getActiveTabId();
    deps.mutateTabs((arr) => {
      const t = arr.find((x) => x.id === id);
      if (t) {
        t.title = title;
        t._autoTitle = true;
      }
    });
  }

  function refreshTitlesAfterPostsChange() {
    const fallback = deps.t('imgTabFallback');
    const activeEntry = deps.nav.current();
    let activeTitle: string | null = null;
    let changed = false;
    deps.mutateTabs((arr) => {
      changed = refreshImageTabTitles(arr, deps.getActiveTabId(), activeEntry, deps.getPostById, fallback);
      const active = arr.find((t) => t.id === deps.getActiveTabId());
      if (active && activeEntry?.kind === 'image') activeTitle = active.title;
      return changed ? arr : undefined;
    });
    if (!changed) return;
    if (activeTitle) document.title = activeTitle + ' — Hologram';
    deps.persistTabsDebounced();
  }

  // 「image view が表示中か」は React が描き services/image-tab.ts が答える
  // もの（isActive() ⟺ モデルがある）。この閉包が保つのは、再入防止ガード
  // ＋コマンドのゲーティング用のこのローカルフラグだけ。
  let imageViewShowing = false;
  const postViewRecorder = makePostViewRecorder(deps.recordView);
  function recordVisiblePost(g: HologramPostGroup | null, idx: number, force: boolean) {
    const postId = g ? deps.viewedPostIdAt(g, idx) : null;
    if (force) postViewRecorder.enter(postId);
    else postViewRecorder.move(postId);
  }
  function showVisibleDetail(g: HologramPostGroup, idx: number) {
    const id = deps.viewedPostIdAt(g, idx);
    const post = g.records.find((p) => p.captureId === id) || g.rep;
    const key = postKeyOf(post.url);
    const records = g.records.filter((p) => (key ? postKeyOf(p.url) === key : p.captureId === post.captureId));
    const detail = resolveGroup(records.map((p) => p.captureId));
    if (detail) deps.showDetail(detail);
  }
  function showImageView(recs: string[], idx: number) {
    imageViewShowing = true;
    publish(recs, idx); // → ImageTabHost がモデルを導出しステージを描く
    const g = resolveGroup(recs);
    // showImageView は画像ビューへの遷移そのもの。同じ投稿を別タブで開き直した場合も
    // 新しい閲覧として数える。ページめくりは下で、投稿が変わった時だけ数える。
    recordVisiblePost(g, idx, true);
    // インスペクタは view と一緒に開く（Eagle 流の詳細画面）。
    if (g) showVisibleDetail(g, idx);
    else deps.dismissDetail();
    const title = g ? imageTabTitleOf(g, deps.t('imgTabFallback')) : deps.t('imgTabFallback');
    stampTabTitle(title);
    document.title = title + ' — Hologram';
  }
  function hideImageView() {
    if (!imageViewShowing) return;
    imageViewShowing = false;
    postViewRecorder.leave();
    store.setState({ activeImageTab: null }); // → ImageTabHost は何も描画せず、コンテンツ列が戻ってくる
    deps.dismissDetail(); // 開いていた詳細は image view に属していた。グリッドのタブはカードごとにそれを開き直す
  }

  function openImageEntry(g: HologramPostGroup) {
    const { recs, idx } = imageEntrySelection(g);
    if (!recs.length) return;
    deps.nav.push(imageEntry(recs, idx));
    showImageView(recs, idx);
    deps.persistTabsDebounced();
  }

  // ギャラリー索引の1ステップ――現在の image エントリをその場で書き換える
  // （1つの image view の中でのページめくりはナビゲーションではない――
  // 確認済み（保留項目2）の replace 一覧）。
  function setImageTabIndex(i: number) {
    const cur = deps.nav.current();
    if (!imageViewShowing || !cur || cur.kind !== 'image') return;
    const st = cur.state as { recs: string[]; idx: number };
    deps.nav.replace(imageEntry(st.recs, i));
    publish(st.recs, i);
    const g = resolveGroup(st.recs);
    recordVisiblePost(g, i, false);
    if (g && panelIsVisible() && deps.viewedPostIdAt(g, st.idx) !== deps.viewedPostIdAt(g, i)) showVisibleDetail(g, i);
    deps.persistTabsDebounced();
  }
  // image view 自身のインスペクタボタン――タブ帯のトグル
  // （shell/InspectorToggle.tsx）と同じ動作を、ウィンドウを埋めるこの
  // view から手が届くようにしたもの。「画面に出ているか」は要素の
  // `hidden` を読むのではなくパネルストアから来て（P2⑦／#153 ⑤）、
  // どちらの分岐もパネル自身の状態を動かす:
  // - 表示: このボタンはパネルへの要求そのものなので、閉じたものを開く。
  //   隠れたままそれを埋めるだけ――利用者がそれを閉じていたときに旧コード
  //   がしていたこと――は、ボタンを死んでいるように見せていた。#245 の
  //   一括マスクは利用者が見える「閉じた」状態なので、タブ帯のトグルが
  //   そうするのとまったく同じく、まずそれが外れる。
  // - 非表示: 中身を解除するのではなくパネルを閉じる。dismissDetail() は
  //   検査中のキーをクリアするだけで、それは広い幅では docked された
  //   カラムを画面に残す――だからこのボタンはパネルを ON にはできても
  //   OFF にはできなくなってしまう。閉じればどのみち中身もクリアされる
  //   （inspector-builder のパネル subscriber）。
  function toggleImageTabInspector() {
    const cur = deps.nav.current();
    if (!imageViewShowing || !cur || cur.kind !== 'image') return;
    if (panelIsVisible()) {
      panelSetOpen(false);
      return;
    }
    const g = resolveGroup((cur.state as { recs: string[] }).recs);
    if (!g) return;
    panelsReveal();
    panelSetOpen(true);
    showVisibleDetail(g, (cur.state as { idx: number }).idx);
    // inspectorOpen は hologramStore の 'inspectedKey' からリアクティブに導出する――repaint の呼び出しは不要。
  }
  // view の閉じるコマンド: ブラウザの意味論――グリッドから到達した image
  // エントリは「戻る」。それ自身の image エントリしか持たないタブ
  // （中クリック）はそのまま閉じる。
  function closeImageTab() {
    if (deps.nav.canBack()) deps.navBack();
    else deps.closeTab(deps.getActiveTabId());
  }

  // 投稿グループをそれ自身のタブとして開く: 履歴が1つの image エントリで
  // ある普通のタブ（中クリック＝「image view を直接開いた新しいタブ」＝
  // 履歴1件――確認済み（保留項目1））。既定ではバックグラウンド
  // （ブラウザ流: 中クリックはグリッドに留まらせる）。
  function addImageTab(g: HologramPostGroup, opts?: { activate?: boolean }) {
    const { recs, idx } = imageEntrySelection(g);
    if (!recs.length) return;
    const id = genTabId();
    const t = {
      id,
      pinned: false,
      title: imageTabTitleOf(g, deps.t('imgTabFallback')),
      _autoTitle: true,
      state: null,
      _navHist: [JSON.stringify(imageEntry(recs, idx))],
      _navIdx: 0,
    } as HologramTab;
    // 現在のタブの隣に挿入する（ブラウザ流）。ピン留めの連なりの中には決して入れない。
    deps.mutateTabs((arr) => {
      const ai = arr.findIndex((tt) => tt.id === deps.getActiveTabId());
      let pos = ai >= 0 ? ai + 1 : arr.length;
      const lastPinned = arr.reduce((acc, tt, i) => (tt.pinned ? i : acc), -1);
      if (pos <= lastPinned) pos = lastPinned + 1;
      arr.splice(pos, 0, t);
    });
    if (opts && opts.activate) {
      deps.saveActiveTabState();
      deps.setActiveTabId(id);
      deps.nav.adopt(t);
      deps.nav.applyCurrent();
    }
    deps.persistTabsDebounced();
  }

  return {
    showImageView,
    hideImageView,
    openImageEntry,
    setImageTabIndex,
    toggleImageTabInspector,
    closeImageTab,
    addImageTab,
    refreshTitlesAfterPostsChange,
    isShowing: () => imageViewShowing, // プリミティブな読み取り――生きた値であってスナップショットではない
  };
}
