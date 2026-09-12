import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { t } from '../_shared/i18n.ts';
import { InspectorRail } from './InspectorRail.tsx';
import { type PanelResize, resolveCssLength, usePanelResize } from './use-panel-resize.ts';
import { LIMITS, type PanelKey, cachedWidth, clampWidth, loadWidth, persistWidth } from '../services/panel-width-pref.ts';
import { isVisible as inspectorIsVisible, load as inspectorLoad, subscribeVisible as subscribeInspectorVisible } from '../services/inspector-panel.ts';
import { registerScroller } from '../services/content-area.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { load as panelsLoad } from '../services/panels.ts';
import { load as shortcutOverridesLoad } from '../services/shortcut-registry.ts';
import { store, subscribeKey, subscribeKeys } from '../services/store.ts';
import { signalShellReady } from '../services/shell-ready.ts';
import { AppToolbar, TabNavigation } from './AppToolbar.tsx';
import { InspectorToggle } from './InspectorToggle.tsx';
import { LeftSidebar } from './LeftSidebar.tsx';
import { EmptyState } from '../empty/EmptyState.tsx';
import { LibraryLoading } from '../empty/LibraryLoading.tsx';
import { LibraryMissingState } from '../empty/LibraryMissingState.tsx';
import { FloatingBar } from '../selection/FloatingBar.tsx';
import { ScrollToTop } from './ScrollToTop.tsx';
import { ImageTabHost } from '../image-tab/index.tsx';
import { Inspector } from '../inspector/Inspector.tsx';
import { PostGrid, PostGridSlot } from '../grid/index.tsx';
import { PosterGrid, PosterGridSlot } from '../posters/index.tsx';
import { TabsHost } from '../tabs/index.tsx';
import { TrashGrid } from '../trash/TrashGrid.tsx';
import { TrashView } from '../trash/TrashView.tsx';
import { TagManagementPage } from '../tag-management/TagManagementPage.tsx';
import { Titlebar } from './Titlebar.tsx';

// サイドバーには、ここで保つべき開閉の状態がもう無い（#981）＝サイドバーはレールそのもので、
// これを画面から外すのは #245 の一括のマスクだけ。それは他のパネルの状態と同じように下で読む。
// かつてここにあったのは #149 の保存された設定と、#259 の幅に連動した引っ込み（状態の、幅が
// 狭い間だけの写し。小さいウィンドウを通り抜けても設定が生き残るようにするため）。広がる列ごと
// どちらも無くなった。

// コンテンツの列が3つの行き先のどれを見せるか（投稿／投稿者／ゴミ箱）。
const subBrowseMode = (cb: () => void) => subscribeKey('browseMode', cb);
const getBrowseMode = () => store.getState().browseMode;
// #21: browseMode とは直交する4つ目の行き先＝アクティブなタブが、閲覧のビューではなくタグ
// 管理のタブかどうか（タブごとのフラグで、tabs-builder.ts の openTagManagementTab）。
// services/tabs.ts のモデルが自分のタブストリップの項目を導くのに使っているのと同じ
// 'tabs'/'activeTabId' のストアのキーを読む。
const subIsTagsTab = (cb: () => void) => subscribeKeys(['tabs', 'activeTabId'], cb);
const getIsTagsTab = () => {
  const { tabs, activeTabId } = store.getState();
  return tabs.find((t) => t.id === activeTabId)?.specialKind === 'tags';
};
// #37: 今この時点で保存フォルダがディスク上に無いか。起動時に App.tsx の LibraryStatusGate が
// 種を入れる。true なら、下の3つの行き先を LibraryMissingState が置き換える。そうしないと、
// メディアのファイルが実際にはそこに無い、DB に載った投稿をグリッドが描いてしまう（#302 以降、
// DB は保存フォルダから独立している）。
const subLibraryMissing = (cb: () => void) => subscribeKey('libraryMissing', cb);
const getLibraryMissing = () => store.getState().libraryMissing;

// パネルの幅。上の開閉の状態と同じ2段構え（まずキャッシュ、1ティックあとに config.json と
// 突き合わせる）。既定値が数値ではなく関数なのは、コンポーネント自身のトークンから測れる
// ようにするため＝resolveCssLength を参照。
function usePanelWidth(key: PanelKey, defaultWidth: () => number): { width: number; fallback: number; commit: (px: number) => void } {
  // 最初の描画で一度だけ測る＝ドラッグがトークンを上書きし得るより前に。
  const [fallback] = useState(defaultWidth);
  const [width, setWidth] = useState(() => cachedWidth(key) ?? fallback);
  const resized = useRef(false);

  useEffect(() => {
    loadWidth(key).then((saved) => {
      if (saved !== null && !resized.current) setWidth(saved);
    });
  }, [key]);

  const commit = useCallback(
    (px: number) => {
      resized.current = true;
      setWidth(px);
      persistWidth(key, px);
    },
    [key],
  );

  return { width, fallback, commit };
}

// パネル1つの幅を、ハンドルに結線する。`write` は生きた経路＝パネルの幅が実際に読む CSS
// 変数であり、ドラッグの毎フレーム呼ばれるので、React の状態から外しておかなければならない
// （use-panel-resize を参照）。
function usePanelWidthResize(key: PanelKey, label: string, side: 'left' | 'right', defaultWidth: () => number, write: (px: number) => void): { width: number; resize: PanelResize } {
  const { width, fallback, commit } = usePanelWidth(key, defaultWidth);
  const clamp = useCallback((px: number) => clampWidth(key, px, window.innerWidth), [key]);
  // 確定した幅は React のものだが、ドラッグの間 CSS 変数は手で書かれる。これは、そのあとで
  // 両者の歩調を揃え直し、起動時には config.json から復元した幅を当てる。effect ではなく
  // layout effect なのは、キャッシュから読んだ幅が最初の描画より前に要素へ載っていなければ
  // ならないため。そうしないと起動時に既定の幅が一瞬見える。
  useLayoutEffect(() => {
    write(width);
  }, [width, write]);
  const resize = usePanelResize({
    side,
    width,
    min: LIMITS[key].min,
    max: LIMITS[key].max,
    label,
    clamp,
    onLive: write,
    onCommit: commit,
    onReset: () => commit(clamp(fallback)),
  });
  return { width, resize };
}

export function AppShell() {
  // --inspector-w はグローバルなトークンで、パネル自身と、それを避けて位置を取るフローティング
  // バーの両方が読むので、document の要素に置く。サイドバーには、もう書くべき幅の変数が無い
  // （#981）＝レールの幅はコンポーネント自身の定数で、#30 のドラッグでの幅変更は今では詳細
  // パネルだけに効く。
  const writeInspectorWidth = useCallback((px: number) => {
    document.documentElement.style.setProperty('--inspector-w', `${px}px`);
  }, []);
  // インスペクタの既定値は、そのトークン自身の値。ここの何かがそれを上書きし得るより前に測る。
  const inspector = usePanelWidthResize('inspectorWidth', t('resizeInspector'), 'right', () => resolveCssLength(getComputedStyle(document.documentElement).getPropertyValue('--inspector-w')), writeInspectorWidth);
  // #245 の一括での非表示は、ここではもう読まない。マスクの読み手は2つとも自分で聞くように
  // なった＝inspector-panel.ts の isVisible() がそれを AND で畳み込み、LeftSidebar は畳み方の
  // モードを選ぶために読む。このファイルがすべきなのは、その状態が読み込まれるようにすること
  // だけ（下）。ウィンドウの幅もここでは読まない（#988）。#981 の名残で購読が1つ残っていた
  // ＝値を誰も使わない useSyncExternalStore で、しかも下のどの形も幅に連動しなくなった今、
  // ブレークポイントを跨いだからといってシェルを描き直しても得るものは無い。#975 が詳細
  // パネルをどの幅でも据え付けにし、#981 がサイドバーをレールに固定した。ブレークポイント
  // 自体には今も持ち主が居る（services/layout-mode.ts）が、アプリの中に読み手が居ないだけ。
  // インスペクタはどの幅でも据え付けの列（#975）なので、その表示・非表示を決めるのは切り替えと
  // #245 の一括での非表示であって、ウィンドウの大きさや選択は関係ない。式そのものは
  // inspector-panel.ts にある（P2⑦）。React の外のレンダラーのモジュールも同じことを尋ねる
  // のに、かつてはこの要素の `hidden` を DOM から読み返して答えていた。写しは1つ、読み手は2つ。
  const inspectorVisible = useSyncExternalStore(subscribeInspectorVisible, inspectorIsVisible);
  // パネルの最初の描画を推測した localStorage のキャッシュより、config.json の方が上位
  // （サイドバーと同じ2段構えの突き合わせだが、状態を持つのはストア＝そうせざるを得ない理由は
  // inspector-panel.ts を参照）。
  useEffect(() => {
    inspectorLoad();
    panelsLoad();
    // #246: このアプリの、割り当てを変えられるショートカットを config.json の内容と突き合わせる。
    // 上の2つと違いキャッシュの段は無い。ここでは最初の描画より前に答えが要るものが無く、割り当て
    // の変更が効いてくるのは、次に実際にキーが押される時だけだから。
    shortcutOverridesLoad();
  }, []);
  // シェルの DOM が document に入ったことを orchestrator に伝える（orchestrator は、委譲する
  // #postGrid/#emptyState 等のリスナーを結線する前に shellReady を待つ＝それらの要素は下で
  // React が描画するもので、もう index.html の静的なマークアップではない）。
  useEffect(() => {
    signalShellReady();
  }, []);
  // コンテンツの列がどの行き先を見せているか。3つとも載ったまま（下を参照）なので、これが
  // 決めるのはどれに `hidden` が付くかだけ。
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  const isTagsTab = useSyncExternalStore(subIsTagsTab, getIsTagsTab);
  const libraryMissing = useSyncExternalStore(subLibraryMissing, getLibraryMissing);
  // 画像タブは、閲覧の外装をメディアの舞台に入れ替える（P2⑫）。入れ替えはここでの描画上の
  // 判断＝コンテンツの列に付ける `hidden` と、下にある舞台自身のコンポーネント。かつては
  // `body.image-tab-active` と index.html の3つの CSS 規則だった。ツールバーが自分の
  // コントロールを入れ替えるのと同じ述語なので、2つの半分が食い違うことはあり得ない。
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  // スクロール根を、そのスクロール位置を読み書きする React の外のモジュールへ手渡す
  // （services/content-area.ts）。かつては、ツールバーの下から始まらねばならない浮いた
  // パネルのために、この要素の上端を測って --content-top へ入れることもしていた。据え付けの
  // 列は行の中に自分の場所を取るので、そういう数値は要らない（#975）。
  const setContentEl = useCallback((el: HTMLDivElement | null) => {
    registerScroller(el);
  }, []);
  return (
    // TooltipProvider は今では App.tsx のもの。ツールチップのトリガーは、このシェルの外に座る
    // body レベルのオーバーレイにも居るし（種別メニューの名前変更ボタン）、遅延を共有すると
    // 言えるのは、1つのプロバイダがそれら全部を覆っているときだけだから。
    <>
      <div className="flex h-svh flex-col overflow-hidden bg-[var(--tabbar-bg)]">
        <Titlebar />
        <header data-slot="tabs-band" className="app-drag flex h-[var(--tabbar-h)] shrink-0 items-center">
          <TabNavigation />
          <TabsHost />
          <InspectorToggle />
        </header>
        <SidebarProvider className="relative min-h-0 flex-1">
          <LeftSidebar />
          {/* ページと詳細パネルは、タブ列の下の内容領域に収める。 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl mr-2 mb-2">
              <SidebarInset className="min-w-0 overflow-hidden">
                <AppToolbar />
                {/* コンテンツ領域のスクロール根。その要素は、id で引かれるのではなく、それを
                    計測したり動かしたりするモジュール（services/content-area.ts）へ手渡される
                    ＝そのファイルを参照。 */}
                {/* scrollbar-gutter:stable は、バーの出入りに合わせて列の幅が跳ぶのを
                    防ぐ（サイズスライダーの列合わせの計算は幅が安定していることに依る）。
                    overflow-anchor:none は、ビューポートより上でセルがマウントされたときに
                    ブラウザが位置を補正するのを止める。あれはグリッドが揺れているように見える。 */}
                <div ref={setContentEl} data-slot="content-scroll" hidden={imageView} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pt-2 pb-4 [overflow-anchor:none] [scrollbar-gutter:stable]">
                  {/* #37: 保存フォルダがディスク上に無い＝下の3つの行き先の代わりにそれを
                      見せる（3つの `hidden` の条件は、新しい要素で包むのではなく、それぞれに
                      `|| libraryMissing` を足してある。こうすれば、仮想化のホスト＝この
                      コンポーネントの末尾でマウントする PostGrid/PosterGrid/TrashGrid が、
                      まったく同じ枠へ、同じ DOM の深さで ref 経由で取り付き続ける）。 */}
                  <LibraryMissingState />
                  {/* 3つの行き先に、スクロール根は1つ。3つとも載ったままで、有効でないものに
                      `hidden` が付く。そうすれば仮想化のホストは計測済みのレイアウトを保てる
                      し、「どれが画面に出ているか」は、body のクラスとインラインのスタイルが
                      競り合うのではなく、React の1つの判断になる。 */}
                  <PostGridSlot hidden={mode !== 'posts' || libraryMissing || isTagsTab} />
                  <PosterGridSlot hidden={mode !== 'posters' || libraryMissing || isTagsTab} />
                  {mode !== 'trash' && !libraryMissing && !isTagsTab && <EmptyState />}
                  {!libraryMissing && !isTagsTab && <LibraryLoading />}
                  {/* ゴミ箱（#268）＝3つ目の行き先。 */}
                  <div hidden={mode !== 'trash' || libraryMissing || isTagsTab}>
                    <TrashView />
                  </div>
                  {/* タグ管理（#21）＝4つ目の行き先。browseMode ではなく、アクティブなタブの
                      specialKind がゲートになる（上の subIsTagsTab を参照）。 */}
                  <div hidden={!isTagsTab || libraryMissing}>
                    <TagManagementPage />
                  </div>
                </div>
                {/* 画像タブの詳細表示（Eagle 風の画面に合わせる表示）。見せるものがあるときは
                    自前のコンテナを描き、無ければ何も描かない（P2⑫）ので、「inset を2つの
                    どちらが埋めるか」の判断は、上の `hidden` とこの行だけ＝id も、index.html の
                    display の規則も要らない。 */}
                <ImageTabHost />
                {/* 画面下の、浮いた選択バー（redesign §3-4 / P2⑥）。body レベルのオーバーレイ
                    ではなく inset の中に置くので、コンテンツの列を基準に中央へ寄り、右の詳細
                    パネルを避ける。詳細パネルは flex の兄弟で、開くと inset を狭める。 */}
                <FloatingBar />
                {/* 「先頭へ戻る」（#606）。ウィンドウの階層ではなくここに居る理由も同じで、
                    詳細パネルが狭めるのは inset だから、この箱の右下が、利用者がスクロール
                    している内容の右下になる。 */}
                <ScrollToTop />
              </SidebarInset>
              {/* 右のインスペクタ＝帯の下に立つ列で、Chrome のサイドパネルと同じ形（#518）。
                  表示・非表示は利用者自身の切り替え（#243）＝カードを選んだ副作用として
                  開いたり閉じたりすることはもう無く、何も選ばれていない間、中身（Inspector）は
                  プレースホルダを出す（#244）。 */}
              {/* どの幅でも列（#975）。#259 は、グリッドが押し潰されないように 1280px 未満で
                  これをグリッドの上へ浮かせていた。だが覆われた帯は、利用者が使えるグリッド
                  ではなく、見えないグリッドだ。つまりあのパネルは何も得ず、半分隠れたカードの
                  列を代償に払っていた。画像ビューはどのみち、どの幅でも据え付けの形に頼って
                  いた（スライドオーバーでは、まさに調べている絵を覆ってしまう）。今ではそれが
                  ただのパネルの姿になった。 */}
              {/* [&[hidden]]:hidden は念のためではなく必須。この要素自身のクラスが持つ
                  `display: flex` が UA のシートの [hidden] { display: none } に勝つので、
                  属性だけではパネルが画面に残ってしまう。 */}
              {/* 出現のアニメーションは付けない（#583）。このパネルの表示は即座だし、
                  Ctrl+Shift+B はこれをサイドバーと歩調を合わせて動かすが、そちらも即座。
                  即時に切り替える。 */}
              <aside data-slot="inspector" className="relative z-25 flex h-full w-[var(--inspector-w)] shrink-0 flex-col border-l border-border bg-[var(--surface)] text-[12px] [&[hidden]]:hidden" hidden={!inspectorVisible}>
                {/* ドラッグ用の縁（#30）＝これを持つパネルは、今ではインスペクタだけ（#981）。 */}
                <InspectorRail resize={inspector.resize} />
                {/* flex-1 がここに確定した高さを与えるので、空状態のプレースホルダは今も列の
                    中央に自分を置ける。中身が入ったパネルは、これまでどおりそこから溢れて
                    スクロールになるだけ。 */}
                <div data-slot="inspector-body" className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-[18px] py-4 [overflow-wrap:anywhere]">
                  <Inspector />
                </div>
              </aside>
            </div>
          </div>
        </SidebarProvider>
      </div>
      {/* 仮想化のグリッドは、GridMount の effect 経由で上の枠に取り付く。masonic のホストへの
          取り付けと flushSync の経路を変えずに済むよう、コンテンツの列の外に置いてある。 */}
      <PostGrid />
      <PosterGrid />
      <TrashGrid />
    </>
  );
}
