// viewer.ts から改名（2026-07-11）。このファイルはアプリの起動オーケストレータ＝
// 旧モノリスから切り出したコントローラ／ビルダーのクラスタすべてについて、生成と
// 依存の結線を担う。App.tsx の effect に畳まず独立したモジュールのままにしてあるのは
// 意図してそうしている（専用の bootstrap モジュールを置くのが実在の React アプリでの
// 通例）。以下のコメントに出てくる「viewer.ts decomposition」は過去の移行
// プロジェクトの名前であって、このファイルの現在の名前ではない＝そのまま残してある。
// レンダラーの service は共有グローバルのブリッジから本物の ES モジュールへ、
// 波ごとに移行している最中。下で import しているものは変換済みで、残りは呼び出し時に
// そのブリッジ経由で読んでいる。
import { treeLeaves, evalNode, hostOf, userKey, facetViewOf, facetSetOp, facetSetNeg, facetDefaultOp, removeCondsMatching as removeCondsMatchingIn } from './query.ts';
import { makeListing, bindNamedPosters } from './listing.ts';
import { newShuffleSeed } from './shuffle.ts';
import { formatCount, formatShortDate } from './format.ts';
import { makeUndoController } from './undo-builder.ts';
import { makeUsers } from './users.ts';
import * as aliases from './aliases.ts';
import { notify } from './ui.ts';
import { makeQfPop } from './qf-pop-builder.ts';
import { makeFacets } from './facets.ts';
import { makeCooc } from './cooc.ts';
import { mediaFilesOf, densityImage, percentileFn, makeGallery, loadUngrouped, loadManualGroups, postIdKey } from './records.ts';
import { fileSrc } from './asset-src.ts';
import { makeTags, bindTagKindOf, bindPosterFilterVocab, getTagTypes, getTagLabels, getPosterTags, load as loadTags } from './tags.ts';
import { makeTabLabels } from './tab-state.ts';
import { hologramI18n } from './i18n.ts';
import * as folders from './folders.ts';
import { open as lightboxOpen } from './lightbox.ts';
import { open as compareOpen, type CompareItem } from './compare.ts';
import { open as menuOpen } from './menu.ts';
import { shellReady } from './shell-ready.ts';
import { scroller as contentScroller } from './content-area.ts';
import { currentShape } from './display.ts';
import * as selection from './selection.ts';
import { hologramPostGridSource, hologramPosterGridSource, hologramTrashGridSource } from './grid.ts';
import { clickCard as trashClickCard, configure as configureTrashView, preview as trashPreview, refresh as trashRefresh } from './trash-view.ts';
import { makePostQueryBuilder, makePosterQueryBuilder, POST_FACET_OPTS, POSTER_FACET_OPTS } from './query-builder.ts';
import { makeKindMenu } from './kind-menu-builder.ts';
import { makeSearchBox } from './search-box-builder.ts';
import { makeCommands } from './command-builder.ts';
import { initFullTextBridge } from './fulltext.ts';
import { makePostGridBuilder, bindLoadPosts, bindConfirmClearAll, bindGetSkipDeleteConfirm, bindSetSkipDeleteConfirm } from './post-grid-builder.ts';
import { makePosterGridBuilder } from './poster-grid-builder.ts';
import { makeGridDensity, type HologramSizeTrack } from './grid-density-builder.ts';
import { makeInspector } from './inspector-builder.ts';
import { makeSelectionBar } from './selection-builder.ts';
import { makeSelectionMenu, selectionTextAt } from './selection-menu.ts';
import { makeBulkTag } from './bulk-tag-builder.ts';
import { makeTabsController } from './tabs-builder.ts';
import { makeImageTabController } from './image-tab-builder.ts';
import { hologramImageTabSource } from './image-tab.ts';
import { subscribe as subscribePostsData } from './posts-data.ts';
import { store, subscribeKey } from './store.ts';
import type { HologramBrowseMode } from './store.ts';
import { hologramIpc } from './ipc.ts';
import { recordPostView } from './posts.ts';

// 起動完了の合図と、下にある起動／購読のハンドラ。旧来の共有ブリッジではなく本物の
// ES の export になっている＝App.tsx の AppBoot／StoreSubscriptions がこれらを直接
// import する。`export` が書けるよう、ここ＝本当のモジュールスコープで宣言し、下の
// async IIFE がそれぞれ一度だけ代入する（viewerReady は IIFE の最初の同期文で、
// ハンドラは閉じ込める対象がすべて定義された時点で）。ESM の import は、import した
// 側のコードがこれらの束縛を読むより先に必ずこのモジュールの評価を終える。だから
// React がこれらに触れる時点では本物の関数が既に入っている。
export let viewerReady: Promise<void>;
export let bootApp: () => Promise<void>;
export let handleFolderChange: (kind?: string) => void;
export let handlePostsChanged: () => Promise<void>;

// グローバルのキーボード／マウスショートカット、タブバーのイベント、インスペクタを
// 引っ込める処理、ストア／IPC の購読ハンドラ。旧来の共有ブリッジの残り全部を、同じ
// やり方で本物の ES の export に変換したもの。それぞれ、旧 Object.assign での登録が
// 置かれていたのと同じ生成場所で、下で一度だけ代入する。
export let handleShortcutNavKey: (e: KeyboardEvent) => void;
export let handleShortcutMouseNav: (e: MouseEvent) => void;
export let handleShortcutUndoKey: (e: KeyboardEvent) => void;
export let handleShortcutSelectAllKey: (e: KeyboardEvent) => void;
export let handleShortcutCopyKey: (e: KeyboardEvent) => void;
export let handleShortcutQuickView: (e: KeyboardEvent) => void;
export let handleShortcutArrowNav: (e: KeyboardEvent) => void;
export let handleShortcutSearchFocusKey: (e: KeyboardEvent) => void;
export let handleShortcutSizeKey: (e: KeyboardEvent) => void;
export let handleZoomWheel: (e: WheelEvent) => void;
export let handleEscDismissDetail: (e: KeyboardEvent) => void;
// 選択テキストに対する document レベルの右クリックの受け皿（#167）。バブリング相で
// 最後に登録し、defaultPrevented なら何もせず抜ける＝自前のメニューを持つ画面は
// その時点で既にイベントを取っている。
export let handleSelectionContextmenu: (e: MouseEvent) => void;
// タブストリップの操作（#621）。ストリップ（tabs/Tabs.tsx）が自身の onClick /
// onAuxClick / onContextMenu からこれらを呼ぶ＝#tabBarInner に載って
// `closest('.tab-item[data-tab]')` で振り分けていた委譲リスナーは無くなり、
// ストリップにそのクラス名を出し続けさせていた DOM の取り決めも一緒に消えた。
export let switchTab: (id: string) => void;
export let addTab: () => void;
// #145: 履歴行のクリック＝現在のタブ（新規訪問として push）／中クリック（背面タブ、
// nav スタックに種を入れた状態）。それぞれ tabs-builder.ts の doc コメントを参照。
export let openHistoryEntry: (e: HologramNavEntry) => void;
export let openHistoryEntryInBackgroundTab: (e: HologramNavEntry, title: string) => void;
/** #145: 履歴パネルが image 種別の行のサムネイルを引くための関数。 */
export let getPostById: (id: string) => HologramPost | undefined;
export let closeTab: (id: string) => void;
/** 中クリックで閉じる。ピン留めしたタブと最後に残った1枚では何もしない。 */
export let closeTabByGesture: (id: string) => void;
export let showTabMenu: (id: string, at: { clientX: number; clientY: number }) => void;
// Ctrl+T / Ctrl+W / Ctrl+Tab は document レベル＝ストリップが持つのではなく
// GlobalShortcuts の登録のままにしてある。
export let handleGlobalTabShortcut: (e: KeyboardEvent) => void;
export let handleDisplayStoreChange: () => void;
export let handlePosterDisplayStoreChange: () => void;
export let handleSearchQueryStoreChange: () => void;
export let navBack: () => void;
export let navForward: () => void;
export let resetAllFilters: () => void;
export let resetPosterFilters: () => void;
// 画面下のフローティングバー向けの一括選択操作（redesign §3-4 / P2⑥）。FloatingBar
// コンポーネントがこれらを直接呼ぶ（onClick → 関数）ので、旧 data-act による
// #selectionBar の委譲は無くなった。folder は押されたボタンの矩形を受け取り、メニューを
// バーに対して位置決めする。tag は中央に Dialog を開くだけなので矩形は要らない。
export let selectionSelectAll: () => void;
export let selectionTag: () => void;
export let selectionFolder: (anchorEl: HTMLElement) => void;
export let selectionGroup: () => void;
export let selectionDelete: () => void;
export let selectionClear: () => void;
// ドラッグによる範囲選択（#484）。ラバーバンドと当たり判定は仮想化するグリッドのホストが
// 持つ（masonic の positioner を握っているのがそちら）。ここにあるのは、それが駆動する
// 選択側の半分。
export let selectionMarquee: HologramMarqueeSink;
// 同じ押下のクリック側の半分で、グリッドごとに束縛が1つずつある（#242）。投稿グリッド
// では選択を空にし、インスペクタも一緒に空にする。投稿者グリッドには選択が無いので、
// 両グリッドが共有するインスペクタだけをプレースホルダに戻す。
export let selectionClickBackground: () => void;
export let posterClickBackground: () => void;
// 表示ポップオーバー向けのサイズスライダーの束縛（P2②）。現在のビューのサイズトラック
// （列数または px）を読み、スライダーの値を適用する。座標の計算は gridDensity が持つ。
// ポップオーバーはこの live binding を import して、開いた時／ドラッグ中／確定時に呼ぶ。
export let getPostSizeTrack: () => HologramSizeTrack | null;
export let applyPostSize: (value: number, min: number, max: number, commit: boolean) => void;
export let getPosterSizeTrack: () => HologramSizeTrack | null;
export let applyPosterSize: (value: number, min: number, max: number) => void;
// シャッフル順を振り直す（#118）。'random' の並び順は種の純粋関数なので、新しい順序は
// 新しい種を意味する＝ここで種を置き換えて描画し直す。表示ポップオーバーの
// シャッフルし直すボタンが呼ぶ。'random' を選んだ時は自分で種を作る（setPostSort を参照）。
export let rerollShuffle: () => void;
// 投稿の並び順。表示ポップオーバーの Select がこれを呼び、読み戻す値は hologramStore の
// 'sortPost'。（投稿者の並び順には専用の操作が無い＝'sortPoster' を書くことが全部で、
// orchestrator がそのキーを購読している。）
export let setPostSort: (value: string) => void;
// 左サイドバーから閲覧先（投稿グリッド／投稿者グリッド）へ移動する。サイドバーは
// 「別の場所へ行く」軸（ブラウザのアドレスバーやブックマークにあたる）なので、画像
// ビューが開いている状態で行き先を選ぶとビューを離れてそのグリッドに着く＝モードが
// 変わらない場合でもそうする（#312）。画像ビューの外では単なるモード切り替えなので、
// 今いる行き先を選んでも何もしないままになる。LeftSidebar の2つのモードボタンが呼ぶ。
// フォルダ／保存した検索の行は下の openFolder／applySavedSearch 経由で離れる。
// どちらもクエリを書き換える前に同じことをしている。
export let browseTo: (mode: string) => void;
// ライブラリのフォルダを現在地として開く（redesign §3-1）。投稿クエリには触れず、
// activeFolderId を切り替えてから描画し直す。新しい左サイドバーのフォルダ行がこれを直接呼ぶ。
export let openFolder: (id: string) => void;
// 投稿者フォルダのサイドバー群（#6 の残り項目1）。LeftSidebar の投稿者モードの
// フォルダ行が直接呼ぶ、平たい CRUD の面（作成は posterFolderStore.create をそのまま
// 通し、改名・並べ替えも同様。削除は removePosterFolder を通して、宙に浮いた絞り込みの
// 葉も片付ける）。投稿者用の管理モーダルはもう無い（FolderManagerModal は撤去済み）＝
// #41／確定 D がライブラリのフォルダで既にそうしたのと同じで、サイドバーの一覧そのものが
// 管理画面。posterGrid／posterQB が出来た時点で代入する（TDZ に対して安全＝載せた後に
// しか読まない。上の openFolder と同じ形）。
export let posterFolderStore: HologramPersistedFolderStore;
export let removePosterFolder: (id: string) => void;
export let applyPosterFolderFilter: (id: string) => void;
// 保存した検索（#40）は切り替えではなく適用する。1つ押すと現在のタブのクエリ全体が
// 保存された条件に置き換わるので、条件がすべてチップバーに並んで編集可能なまま残る。
// フォルダの方は、多くある葉のうちの1つに過ぎない。入れ子にせず適用にしてあることが、
// 保存した検索が別の保存した検索を含まない理由でもある＝クエリの中にクエリが無いので、
// 循環を防ぐ番人が要らない。
export let applySavedSearch: (id: string) => void;
// 今の投稿クエリを新しい保存した検索として保存する。新しいフォルダを返し、名前が空の
// ときは null を返す（ストア自身の規則）。
export let saveCurrentSearch: (name: string) => HologramFolder | null;

// --- 絞り込みバー（redesign §3-2 / P2③） ----------------------------------
// 値フライアウトの1行（facets.ts の qfValues が作る）＝filterbar コンポーネントが
// 描画する構造の形。HologramQfPopItem と同じく loose（[k]:any）にしてある。qfValues が
// カテゴリごとの追加項目（type/kind/sub/sn/facetDim/ghead/dotTitle）を足すため。
export interface FilterRow {
  v?: string;
  l?: string;
  on?: boolean;
  count?: number;
  ghead?: string;
  [k: string]: unknown;
}
interface FilterCatBase {
  cat: string;
  label: string;
}
// ファセット1つの演算子／除外モード（redesign §4-2 B、Linear の「is any of /
// is all of / is not」）。'and'/'or' は肯定側の「すべて」／「いずれか」、'exclude' は
// 「〜でない」（そのファセットの値をすべて否定する）。'and' は多値型にだけ出す。
export type FacetMode = 'and' | 'or' | 'exclude';
// エディタが値の一覧になるカテゴリ（チェックリスト／タグをまとめた2ペイン）。
export interface FilterCatValues extends FilterCatBase {
  editor: 'values';
  showFind: boolean;
  // multi は「すべて」／「いずれか」を扱える型（multiValueTypes）を指す。エディタは
  // 「いずれか」「すべて」「〜でない」の3択を出す。他の値型は「含む」「〜でない」の2択。
  multi: boolean;
  values(): FilterRow[];
  pick(it: FilterRow): void;
  // ファセットの現在のモードを読み書きする（エディタのモード切り替えを駆動する）。
  // mode() は生きている木を映し、setMode() は木を書き換えて（op の切り替え／全否定）
  // 更新をかける。
  mode(): FacetMode;
  setMode(m: FacetMode): void;
  manage?: () => void;
  // manage を設定した時にフッタへ出すラベル（2026-08-02、#21）。カテゴリが違えば文言も
  // 変える必要がある（フォルダを管理… と タグを管理…）。設定が無ければフォルダ時代の
  // 汎用文字列（ctxManage）を代わりに使うので、manage だけ設定してこれを設定しないカテゴリは
  // 以前とまったく同じままになる。
  manageLabel?: string;
  // folder ファセット専用（#41）＝「このフォルダのみ」。フォルダ条件は既定で部分木
  // 全体を対象にするが、これはそのフォルダ自身の投稿だけに絞る。モードではなく条件の
  // 属性なので、「いずれか」「すべて」「〜でない」の隣に4つ目を並べるのではなく、
  // 自前のスイッチにしてある。
  only?: { get(): boolean; set(v: boolean): void };
}
// エディタが日付範囲のフォームになるカテゴリ（投稿日、または投稿者側の3次元の日付）。
export interface FilterCatDate extends FilterCatBase {
  editor: 'date';
  dimOptions: Array<{ value: string; label: string }>;
  apply(f: { dateField?: string; from?: string; to?: string }): void;
}
// エディタが反応のフォームになるカテゴリ（種類＋以上／以下＋最小値）。
export interface FilterCatEng extends FilterCatBase {
  editor: 'eng';
  typeOptions: Array<{ value: string; label: string }>;
  opGte: string;
  opLte: string;
  apply(f: { engType?: string; min?: string; op?: string }): void;
}
// #162: 寸法・サイズのファセットのエディタ＝軸（width/height/long/bytes）＋以上／以下
// ＋数値（最初の3つは px、bytes は MB）。フォームが apply() の前に MB をバイトへ換算
// する＝反応のフォームには要らない「エディタの単位と保存の単位が違う」形。
export interface FilterCatDim extends FilterCatBase {
  editor: 'dim';
  axisOptions: Array<{ value: string; label: string }>;
  opGte: string;
  opLte: string;
  apply(f: { axis?: string; value?: string; op?: string }): void;
}
export type FilterCat = FilterCatValues | FilterCatDate | FilterCatEng | FilterCatDim;
// 「絞り込みを追加」のメニュー＝今の閲覧モードが出せるファセットのカテゴリ。それぞれが
// 自前の生きた値／適用の閉包を持つ（コンポーネントは描画と振り分けだけをする）。
// 開くたびに計算し直すので、件数・ラベル・語彙が新しい。
export let filterCategories: () => FilterCat[];

// 有効な絞り込みチップ1つ（redesign §3-2 / P2③ タスク2）＝今クエリの木にあるファセットを
// Linear 風に描いたもの（1ファセット＝1チップ）。`cat` は filterCategories() の項目と
// 対応していて、チップを押すとそのファセットのエディタが開き直す。`remove` は
// ファセット全体を消す。木が変わるたびに、今の QB の木から計算し直す。
export interface ActiveFilter {
  cat: string; // filterCategories() の項目と対応（押した時に開き直すエディタ）
  type: string; // 葉の型（アイコンの手がかり）
  label: string; // カテゴリのラベル
  editor: 'values' | 'date' | 'eng' | 'dim';
  mode: FacetMode; // 肯定側の「すべて」／「いずれか」、または「〜でない」
  values: string[]; // チップの中に出す、値ごとのラベル
  remove(): void; // ファセット全体（その葉すべて）を消す
}
export let activeFilters: () => ActiveFilter[];

// チップ行のインライン入力の確定口（#148）。今画面に出ているビューへ条件を1つだけ足す
// （投稿クエリの木、投稿者を見ている間は投稿者側の木）。検索ボックスの pick とは意図して
// 別にしてある＝あちらは入力欄も空にし、書きかけの自由文の葉も捨てる。それは「入力した
// 文字は絞り込みを探すためだけのものだった」なら正しいが、チップ行に住む入力欄には合わない。
export let addFilterToCurrentView: (filter: { type: string; value: string; label?: string }) => void;

// ファセットエディタのポップアップを1回開く＝nav 履歴のエントリ1件（#144 確定
// （保留項目2）: エディタ1セッションにつき1エントリ）。filterbar の ValueEditor／
// FormEditor が、自分が載っている間をこれらで挟む。セッションのトークンが生きている間、
// tabs-builder は選択ごとの記録を、最初の選択が push したエントリへまとめる。
let _filterEditSession: object | null = null;
export function beginFilterEditSession(): void {
  _filterEditSession = {};
}
export function endFilterEditSession(): void {
  _filterEditSession = null;
}

(async () => {
  // Promise の executor は同期に走るので、これは他のどのコードよりも先に代入される。
  // `!` は executor が既に保証していることを tsc に伝えるためのもの。
  let resolveViewerReady!: () => void;
  viewerReady = new Promise<void>((r) => {
    resolveViewerReady = r;
  });

  // --- i18n ---
  // メッセージは i18n.js にある（index.html 経由でこのスクリプトより先に読み込まれる）。
  // マニフェスト階層の文字列は Chrome 経由で _locales/*/messages.json から来る。
  const { getMessage } = await hologramI18n;
  // シェルは今は React が持つ（AppShell.tsx）。下のシェル DOM の準備が走る前にその
  // マウントを待つ＝シェルが登録する要素（services/content-area.ts）と、まだ残っている
  // 少数の byId() の探索が解決するようにする。（viewerReady は今までどおりこの IIFE の
  // 最後で解決する → AppBoot の bootApp はその後に走る。）
  await shellReady;
  // 件数・日付の表示整形は今は format.ts にある（上で import 済み）。
  // エクスポート通知の表示は LibrarySafetyStatus が持つ。

  // （カーソル位置に出したポップアップをビューポートの内側へ押し戻していた手書きの
  // clampIntoView は無くなった。メニューはすべて Base UI のポップアップになり、衝突の
  // 処理はそちらの仕事＝#62。）

  // （「静的な要素に i18n を適用する」ブロックがここにあり、シェルが約束した id へ
  // ラベルを書き込んでいた。書き込む先はもう残っていない。どの画面もコンポーネントに
  // なり、自分の文字列を t() で解決する＝P3 #6。）

  // 投稿の並び順の唯一の情報源は hologramStore の 'sortPost'＝投稿者側の並び順がずっと
  // 取ってきたのと同じ形。以前はシェルの中の隠し <select> で、表示ポップオーバーが合成した
  // 'change' イベントで駆動していた（#153 分類3）。今はポップオーバーが下の setPostSort()
  // を呼び、タブの復元はキーを直接書く（applyState）。これが、復元を利用者による並び順の
  // 変更として数えさせない仕組み。
  // #183: タイムラインモードはグリッドを投稿日の降順に固定し、並び順の操作を丸ごと隠す。
  // listing.ts の switch に 'timeline' の分岐を足すのではなくここで値を強制すると、
  // sortValue() を読む側（getFilteredPosts、月セクションのビルダー、反応／保存日時の
  // 関連度のゲート）が既存の 'date-desc' の経路を通じて、何もせずにそれを拾う。
  const sortValue = () => (store.getState().browseMode === 'timeline' ? 'date-desc' : store.getState().sortPost);

  // --- クエリ欄 ---
  const ENG_TYPE_LABELS: Record<string, string> = {
    likes: getMessage('qfEngLikes'),
    reposts: getMessage('qfEngReposts'),
    replies: getMessage('qfEngReplies'),
    bookmarks: getMessage('qfEngBookmarks'),
    views: getMessage('qfEngViews'),
  };

  // filterLabel（クエリチップの描画とタブのタイトルが共有する）と tabTitleOf は
  // tab-state.ts へ移した（makeTabLabels、import 済み）＝6番目の切り出し。ここより後で
  // 宣言する const（PF_NAME / CF）は、遅延させたアロー関数として注入する＝ここで直接
  // 参照すると結線の時点で TDZ に当たる。ラッパーは描画時にしか走らない。
  // formatShortDate / formatCount は巻き上げられる関数宣言なので、直接参照でよい。
  const { filterLabel, tabTitleOf, posterFilterLabel } = makeTabLabels({
    t: getMessage,
    engTypeLabels: ENG_TYPE_LABELS,
    platformName: (v: string) => PF_NAME[v] || v,
    formatShortDate,
    formatCount,
    folderName: (id: string) => {
      const fobj = CF() && CF().byId(id);
      return fobj ? fobj.name : null;
    },
    // 遅延させたアロー関数（posterFolderById はずっと下で宣言する const＝CF()/folderName と
    // 同じ TDZ のかわし方。ラッパーは描画時にしか走らない）。
    posterFolderName: (id: string) => {
      const fo = posterFolderById(id);
      return fo ? fo.name : null;
    },
  });

  // （クエリビルダーのチップの先頭に出す型のグリフ qcGlyph は、postQB/posterQB の結線と
  // 一緒に query-builder.ts へ移り、その後 #230 でチップの描画経路ごと無くなった＝
  // 今のチップは filterbar の CatIcon を使う。）

  const PF_NAME: Record<string, string> = { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' };

  // 絞り込みを一括でリセットする（有効な絞り込みバーの「リセット」）。検索・フォルダ・
  // 日付・反応も消す。afterQueryChange() がサイドバーの選択状態も揃える。
  // 巻き上げられる宣言ではなく代入にしてあるのは、上のモジュールスコープの `export let` の
  // 方が設定されるようにするため＝Activebar.tsx は今これを直接 import する。
  resetAllFilters = function () {
    // 投稿者側への跳ね返りはもう無い（#144 確定（保留項目4）: posterReturn を削除）＝
    // 絞り込んで入るのは今は履歴への push なので、「投稿者グリッドへ戻る」は ← ボタン／Alt+←。
    postQB.resetTree();
    searchEditing.clear(); // 編集中のテキストの葉は木ごと消えた
    // （ここが以前空にしていた日付／反応の入力欄はファセット列のものだった。その列は
    // 無くなり、値は resetTree() が今消したクエリの木の中にある。）
    setSearchBoxValue('');
    afterQueryChange();
  };
  // リセット／戻る／進むのボタンは resetAllFilters/navBack/navForward を直接 import する
  // （モデルへ押し込むコールバックは無い）＝どれもツールバーにある React 側のもの。
  //
  // タブごとのビュー履歴を行き来する処理（nav の状態機械、Alt+←/→ とマウスのサイド
  // ボタンのハンドラ、下のタブバーと CRUD）は viewer.ts decomposition の中で
  // tabs-builder.ts へ移した。tabsCtl はもっと下（postQB/postGrid がスコープに入った後）で
  // 生成し、そのハンドラはその生成場所でモジュールスコープの export へ代入する。

  // 空状態の CTA は今はそのコンポーネント自身の onClick（empty/EmptyState.tsx）で、下の
  // モジュールスコープの export 経由で resetAllFilters / resetPosterFilters を呼ぶ
  // （ZIP の取り込みは services/zip-import.ts へ直接行く）＝要素の id で照合していた
  // 委譲リスナーは無くなった。

  // --- カテゴリの値フライアウト。サイドバーの行／タグ群のボタンの隣に開く。
  // 状態（どのカテゴリが開いているか）と行モデルの構築（qfValues＝ファセット固有の
  // ロジックで、内容は変えていない）と選択の振り分けは、viewer.ts decomposition の中で
  // qf-pop-builder.ts へ移した＝makeQfPop() の呼び出しはもっと下、postQB/posterQB/
  // pfStore/buildUsers がすべて出来た後にある（下の posterQB 付近を参照）。
  // タグの語彙と種別の領域（tagKindOf/kindLabel/groupedTagVocab/
  // inspectorTagPickerData/posterTagsOf/posterFilterVocab）は tags.ts へ移した
  // （import 済み）＝8番目の切り出し。タグのストア自体（tagTypes/tagLabels/posterTags）も
  // 今は tags.ts にある（P4「state→store」のタグ分）＝そちらの getter が、viewer.js の
  // ローカルな `let` の入っていた場所に入る。下の facets/cooc の結線より先に結ぶ。
  // あちらは tagKindOf/posterTagsOf/posterFilterVocab を直接参照として渡すため。
  // charCandidatesFor/relatedTagCandidates は下の cooc の分割代入で出来る const なので、
  // 遅延させたアロー関数として入れる。
  const { tagKindOf, tagKindOfName, kindLabel, inspectorTagPickerData, posterTagsOf, posterTagEntriesOf, posterFilterVocab } = makeTags({
    tagTypes: getTagTypes,
    tagLabels: getTagLabels,
    posterTags: getPosterTags,
    allPosts: () => postGrid.getAllPosts(),
    t: getMessage,
    charCandidatesFor: (w) => charCandidatesFor(w),
    relatedTagCandidates: (sel, opts) => relatedTagCandidates(sel, opts),
    membersOf: (key) => aliases.membersOf(key), // #23 St1: 統合した投稿者のタグは、その群全体の和集合として読む
  });
  // tags.ts の live binding に結び付ける＝services/sidebar.ts の pull 側の source が、この
  // orchestrator のインスタンスが使うのと同じ tagKindOf/posterFilterVocab を読めるように
  // する。どちらも tags.ts 自身の getTagTypes()/getPosterTags() を閉じ込めているので、
  // ずれていく2つ目の実装が存在しない。
  bindTagKindOf(tagKindOf);
  bindPosterFilterVocab(posterFilterVocab);
  // 共有の種別メニュー（編集用ピッカー／インスペクタ／投稿者ピッカーでタグチップを
  // 右クリックすると出る）＝行モデルと選択・改名の操作は kind-menu-builder.ts へ移した
  // （viewer.ts decomposition の一部）。最初に使う場所ではなくここで結ぶのは、
  // tagKindOf/kindLabel/getMessage がすべて既にスコープに入っているから＝旧 taggingApi の
  // 間接参照と違って TDZ の回避策が要らない。
  const { showKindMenu } = makeKindMenu({ tagKindOf, tagKindOfName, tagIdOf: (name) => tagIdOf(name), kindLabel, t: getMessage });
  // ファセットの集計（facetCounts）と値フライアウトの行モデル（qfValues）は facets.ts へ
  // 移した＝3番目の切り出し。実行時の結び付きは注入する。グリッドが持つ集まり（allPosts）は
  // getter として、ここより後で宣言する const（posterQB / pfStore / listing.ts の産物）は
  // 遅延させたアロー関数のラッパーとして渡す＝ここで直接参照すると結線の時点で TDZ に
  // 当たる。ラッパーはフライアウトが開いた時にしか走らない。
  const { qfValues } = makeFacets({
    getFilteredPosts: () => getFilteredPosts(),
    qHasValue,
    qHasTag: (tagId: number | null, name: string) => postQB.qHasTag(tagId, name),
    posterQHasValue: (type: string, v: string) => posterQB.qHasValue(type, v),
    posterQHasTag: (tagId: number | null, name: string) => posterQB.qHasTag(tagId, name),
    allPosts: () => postGrid.getAllPosts(),
    hostOf: (u: string | null | undefined) => hostOf(u),
    userKey: (p: HologramPost) => userKey(p),
    resolve: (key: string) => aliases.resolve(key), // #23 St1
    membersOf: (key: string) => aliases.membersOf(key), // #23 St1
    t: getMessage,
    PF_NAME,
    tagKindOf,
    tagKindOfName,
    posterTagEntriesOf,
    filteredPosters: () => filteredPosters(),
    posterFilterVocab,
    namedPosters: () => namedPosters(),
    posterFolders: () => pfStore.all(),
    postFolders: () => (CF() ? CF().staticFolders() : []), // フォルダのフライアウト向けのライブラリのフォルダ（folders.json）＝保存した検索は投稿を入れる場所ではない
    // 遅延させたラッパー。buildUsers はここより後で宣言する const（users.js の結線）に
    // なる＝ここで直接参照すると結線の時点で TDZ に当たる。
    buildUsers: () => buildUsers(),
  });
  // タグの共起の計算（charCandidatesFor / worksCooccurringWith /
  // relatedTagCandidates）は cooc.ts へ移した＝4番目の切り出し。上の facets と同じく
  // getter を遅延させて結ぶ（allPosts は再代入される let で、getter はピッカーか同名判定が
  // 走った時にしか動かない）。
  // #810: 候補の段はどれも名前の空間に留まる＝入力は利用者が打ったタグで、出力は打つための
  // タグ。どちらもエンティティを名指ししていない。
  const { charCandidatesFor, worksCooccurringWith, relatedTagCandidates } = makeCooc({ allPosts: () => postGrid.getAllPosts(), tagKindOfName });
  // onQfPick（値の選択 → 木の書き換え）は qf-pop-builder.ts にあり、絞り込みバー向けに
  // qfPop.pickValue として出している＝下の posterQB 付近の makeQfPop() の呼び出しを参照
  // （フライアウトの描画と位置決めの側は、そのコンポーネントごと撤去した。P2③）。

  // ⓘ の "How to use the query builder" ホバーポップオーバーは今は activebar の
  // コンポーネント（HelpPop）＝中身（タイトル＋5行）はモデルの `help` 欄に載る。ホバーと
  // 位置決めはそちらにある。

  // 日付／反応／投稿者の日付範囲のポップオーバー（撤去した filter-popover のフライアウト）は
  // コンポーネントごと削除した（P2③ タスク3）。日付／反応の絞り込みを足すのは今は
  // 「絞り込みを追加」バーの FormEditor で、チップを編集すると同じものが開き直す（P2③）。
  // 検索ボックスに結び付いた唯一の 'text' の葉（投稿モードのみ）は search-editing.ts が持ち、
  // 検索ボックス周りの配線の残りと一緒に、今は search-box-builder.ts で結んでいる
  // （viewer.ts decomposition の一部）＝下の makeSearchBox() の呼び出しを参照。

  // --- サイドバーの絞り込みの操作 ---
  // （#filterRows の行ラベルはサイドバーのコンポーネントが描き、hologramPostSidebarSource
  // から自分で導く。ここには Platform / Post / Media / Date / Engagement の静的な setText は
  // 無い。）

  // （委譲していた #filterRows のリスナーがここにあった＝旧ファセット行の列の、最後の
  // 委譲リスナー。その入れ物はシェルの切り替えと一緒に、列そのものは P3 #6 と一緒に
  // 無くなったので、振り分けていた行はどれも絞り込みバーのもの（絞り込みの追加）か、
  // 消えたかのどちらか。multiOnly はタブの状態としてだけ残る＝hologramStore のキーで、
  // tabs-builder 自身の状態復元が書く。）

  // --- タグの領域。タグの行は、種別の付いていない一般タグを全部並べたフライアウトを
  // 1つだけ開く。作品／キャラの種別が付いたタグには専用の行がある。一般タグは、スクロール
  // するフライアウトの中で、件数順に平たく並んだままにする。
  // tagTypes/tagLabels（種別の語彙）と tagKindOf/kindLabel は tags.js へ移した
  // （上の hologramTags の結線）＝P4「state→store」のタグ分。
  // （利用者が変えているかもしれない）作品／キャラの名前と、どのタグが種別を持つかは、今は
  // services/sidebar.ts の source が生きた状態で読む（hologramTags.onChange と posts-data.ts の
  // subscribe）。だから種別の改名や分類のたびに、ここで明示的に導き直す必要はもう無い。
  // 残り（パレットの見出し、種別メニュー、ドットのツールチップ）も既に kindLabel() を
  // 生きた状態で読んでいる。種別メニュー自身の書き換えと永続化は今は
  // kind-menu-builder.ts にある。下の tagsSetTagKind は maybeDistinguishHomonym 自身の
  // 直接の書き込みのためだけにある。
  const _ic = (paths: string) => `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  // --- セッション中の編集の取り消し／やり直し（#235） ---
  // ライブラリの編集が実際に生んだ差分を記録する＝投稿のタグ、投稿者のタグ、フォルダの
  // 所属（両ビュー）。一括操作を間違えても Ctrl+Z / Ctrl+Shift+Z か、その操作が出した
  // トーストから直接取り消せる。線形のスタックで、再起動すると消える。投稿の削除はまだ
  // スタックに載っていない（そちらの救済経路はゴミ箱）＝残りの範囲は #235 で追っている。
  // スタックの意味論と、orchestrator が持つ適用のコールバックやショートカットのハンドラは
  // undo-builder.ts にある。下の inspector/postGrid/posterGrid 自身の依存に間に合うよう
  // pushUndo を用意するため、ここ（元からの場所）で生成する。postGrid/inspector/posterGrid は
  // どれも後で宣言するので、そのアクセサは遅らせた前方参照になる（inspector-builder.ts の
  // jumpToPoster と同じ形）。showToast 自体は notify で、先頭で直接 import しているから
  // そちらに前方参照は要らない。
  const undoCtl = makeUndoController({
    showToast: notify,
    t: getMessage,
    getPostById: (id) => postGrid.getPostById(id), // postGrid は下で宣言する＝遅延させる
    markPostsMutated: () => postGrid.markPostsMutated(),
    renderPosts: (keepLimit) => postGrid.renderPosts(keepLimit),
    getViewGroups: () => postGrid.getViewGroups(),
    showDetail: (g) => showDetail(g), // showDetail（インスペクタ）はずっと下で宣言する＝遅延させる
    refreshPosterTagFields: (key) => refreshPosterTagFields(key), // refreshPosterTagFields（posterGrid）はずっと下で宣言する＝遅延させる
    getPosterFolderStore: () => posterGrid.pfStore, // posterGrid はずっと下で宣言する＝遅延させる
    onFolderMembershipChanged: () => {
      folders.notifyChanged('membership'); // 通常の切り替えが使うのと同じ経路＝チップとサイドバーの件数がこれにぶら下がっている
      postGrid.renderPosts(true); // ここは無条件。取り消しは稀で意図した操作なので、フォルダの絞り込みが生きているか導き直すより、描き直しを1回払う
    },
    onPosterFolderMembershipChanged: () => posterGrid.refreshPosterFolderViews(),
    onPosterAliasChanged: () => posterGrid.refreshAfterAliasChange(), // posterGrid はずっと下で宣言する＝遅延させる
  });
  const { pushUndo, undoAction } = undoCtl;
  handleShortcutUndoKey = undoCtl.handleShortcutUndoKey;
  // フォルダ所属の切り替えでは folders.ts が自分でトーストを出すので、そこに「元に戻す」を
  // 載せるのもあちらが持つ＝スタックを注入しているのは、その末端のモジュールがこの
  // コントローラより遥かに早く読み込まれるため。
  folders.setUndoRecorder((folderId, added, removed) => pushUndo([{ kind: 'folder-items', target: folderId, added, removed }]), getMessage('undoAction'));

  // --- 状態 ---
  // allPosts/_postsById/loadPosts/renderPosts と描画の再利用の防ぎは post-grid-builder.ts へ
  // 移した（「allPosts の所有権の移譲」）＝postGrid は下、buildUsers/postQB がスコープに
  // 入った後で生成する。
  // コンテンツ領域が何を閲覧しているか（'posts' | 'posters' | 'trash' | 'timeline'）と
  // 「複数画像」の絞り込みは hologramStore のキー（'browseMode' / 'multiOnly'）であって、
  // そこへ写した閉包の状態ではない。コンポーネントもビルダーも同じキーを読むので、
  // 値は1つ、書く場所も1か所。
  // SMOKE のキャプチャ。隠しスクリーンショット用のインスタンスには「画面に出ている」ものが
  // 何も無いので、content-visibility:auto がカードの描画を全部飛ばし、loading=lazy の画像は
  // 一度も取得されない → 空のグリッドになる。?smoke=1 で起動した時は両方を切る（CSS の
  // クラス＋画像を eager に）ので、capturePage() が本物のカードを見る。通常のアプリには
  // 手を触れない。
  const SMOKE_CAPTURE = (() => {
    try {
      return new URLSearchParams(location.search).get('smoke') === '1';
    } catch {
      return false;
    }
  })();
  if (SMOKE_CAPTURE) document.documentElement.classList.add('smoke-capture');

  // スクロールの入れ物はコンテンツ列（ページ自体はスクロールしない）なので、スクロール位置は
  // window ではなくそちらで読み書きする。シェルは id を約束するのではなく、要素そのものを
  // 渡してくる（services/content-area.ts）。
  const contentScrollEl = () => contentScroller();
  const contentScrollTop = () => {
    const el = contentScrollEl();
    return el ? el.scrollTop : 0;
  };
  const scrollContentTo = (y: number) => {
    const el = contentScrollEl();
    if (el) el.scrollTop = y;
  };
  // グループ化の状態（manualGroups/ungrouped/stickyRecs。main 経由で
  // manual-groups.json / ungrouped.json に永続化する）は viewGroups と一緒に
  // post-grid-builder.ts へ移した＝下の postGrid を参照。
  // インスペクタに出ているグループの postIdKey は hologramStore の 'inspectedKey'＝
  // グリッド／投稿者のセルは useSyncExternalStore 経由でそこから自分の '.inspected' の
  // 輪を導き、インスペクタを開閉するビルダー（inspector-builder / poster-grid-builder /
  // undo-builder）も同じキーを直接読み書きする。だからここに写すものは何も無い。
  // 表示の密度（カード／タイル／一覧）と、タイル／カード／一覧のサイズスライダーは、投稿
  // グリッドと投稿者グリッドの両方について、viewer.ts decomposition の中で
  // grid-density-builder.ts へ移した。renderPosts/renderPosters は前方参照（下の
  // postGrid/posterGrid 経由で後から宣言する）＝このファイルの他の service の結線が既に
  // そうしているのと同じ、TDZ に対して安全な遅延アロー関数。
  const gridDensity = makeGridDensity({
    hologramIpc,
    hologramPostGridSource,
    renderPosts: (inPlace) => renderPosts(inPlace),
    renderPosters: () => renderPosters(),
  });
  const { gridThumbW, listThumbW } = gridDensity;
  // 投稿グリッドの選択状態（Set と Shift 範囲の起点）は services/selection.ts にある＝
  // hologramStore の 'selectedSet' キーがその状態そのもので、グリッドコンポーネントの
  // セルがそれを反応的に読む。
  // --- クエリビルダー。真偽値の条件の木が唯一の情報源 ---
  // （改訂3: 条件は平たく並び、括弧の付いた群へドラッグして入れる。型による自動の
  // グループ化はしない）。両方のビュー（投稿／投稿者）が、下の createQueryBuilder(ctx)
  // ファクトリ経由でビルダーの実装を1つだけ共有する。ctx がビューごとの差分（葉の述語、
  // ファセットのスキーマ、コールバック）を運ぶ。木は必ず根が群になる（既定の op は 'and'）。
  // 各インスタンスの `.shadow()` は葉から導いた平たい影（サイドバーの強調／行の印／タブの
  // タイトル／件数）＝postQB.shadow()/posterQB.shadow() を、モジュールレベルの別の
  // グローバルへ写すのではなく、呼び出し側ごとに新しく読む（下の syncShadow のコメントを
  // 参照）。
  // 木の仕組みと投稿側の述語は query.ts にある（上で import 済み）＝viewer decomposition の
  // 最初の「純粋なロジック → service」の切り出し。実行時の結び付きはここで注入する。
  // 集まりは CF() を通じて遅延して解決し（folders.js はこの閉包が組み上がった後に
  // 登録し、述語は初期化後にしか走らない）、曖昧なテキストの照合は search.ts の compile を
  // 通す。
  // 共有のファセットビルダー（改訂4）は query-chips.ts にある＝木の状態と書き換えの補助は
  // そちらへ移した。あちらは何も描画しない。画面のチップは filterbar コンポーネント経由で
  // 下の activeFilters() から来ていて、そのコンポーネントは、ビルダーが書き換えのたびに
  // 写す postQueryTree/posterQueryTree のストアキーから計算し直す。postQB/posterQB の
  // インスタンスの生成（predOf／ファセットのスキーマ／createQueryBuilder の ctx）自体も
  // query-builder.ts へ移した。変更の周りのオーケストレーション（onChange）は
  // orchestrator.ts に残してある。そこはまだ切り出していない状態（renderPosts、
  // searchEditing）に手を伸ばすため。

  // 投稿側のビルダーのインスタンス。印やタブのタイトルなどの読み取りは、以前は onShadow
  // コールバック経由で木の影をモジュールレベルの `activeFilters` グローバルへ写していた。
  // そのグローバルは postQB.shadow() の純粋な複製だった（インスタンスが既に同じキャッシュ
  // 済みの配列を出している）＝今はどの読み取り側も、2つ目の複製を保つのをやめて
  // postQB.shadow() を直接呼ぶ。
  // 名前 → tags テーブルの id を、このウィンドウが読み込んだもの全体から引く。使い手は2つ。
  // DB 移行（#297）より前に保存されたタグの葉は名前しか持たず、query.ts の tag の分岐が
  // 最初の評価時にここで解決する。もう1つは、右クリックされたチップの背後にあるエンティティを
  // 種別メニューが必要とする場合（#810）。
  //
  // 語彙を取りに行くのではなく、読み込み済みレコードの並列配列を走査する＝旧形式の葉1つに
  // つき1回（葉は解決した id を自分でキャッシュする）、あるいはメニューを開くたびに1回
  // 走るだけで、投稿ごとに走るわけではない。effective の対を先に読むのは、そちらが上位集合
  // だから。どの投稿も直接は持たないタグ（親のつながりの途中にしか現れないもの）は、どの
  // 生の tags[] にも項目が無い。生の方だけから解決すると、その葉は名前の照合に留まり、何にも
  // 当たらなくなる＝親の関係を適用する目的の、ちょうど逆になる。投稿者のタグも探す（#810）。
  // そうしないと、投稿者にしか付いたことのないタグは解決できるエンティティを持たず、分類
  // できなくなる。
  function tagIdOf(name: string): number | undefined {
    for (const p of postGrid.getAllPosts()) {
      const e = (p.effectiveTags || []).indexOf(name);
      if (e >= 0 && p.effectiveTagIds) return p.effectiveTagIds[e];
      const i = (p.tags || []).indexOf(name);
      if (i >= 0 && p.tagIds) return p.tagIds[i];
    }
    for (const row of Object.values(getPosterTags())) {
      const e = (row.effectiveTags || []).indexOf(name);
      if (e >= 0 && row.effectiveTagIds) return row.effectiveTagIds[e];
      const i = (row.tags || []).indexOf(name);
      if (i >= 0 && row.tagIds) return row.tagIds[i];
    }
    return undefined;
  }
  const { qb: postQB, predOf: postPredOf } = makePostQueryBuilder({
    tagIdOf,
    onChange: () => {
      renderPosts();
    },
    // 編集中のテキストの葉が消えたら、入力欄との結び付きを外す。遅延させたアロー関数に
    // してあるのは、searchEditing をこの閉包の後ろ（下の makeSearchBox() の
    // 呼び出し）で生成するため。postQB/posterQB が自分の宣言より前で定義された関数から
    // 参照されるのと同じ前方参照の形。
    onLeafMutated: (node: HologramQueryLeaf) => searchEditing.onLeafMutated(node),
  });
  // 既存の投稿側の呼び出し箇所が名前を変えずに済むよう、モジュールレベルに薄いラッパーを置く。
  function currentTree() {
    return postQB.getTree();
  }
  function addFilter(filter: { type: string; [k: string]: any }) {
    postQB.addFilter(filter);
  }
  function removeFilter(index: number) {
    postQB.removeFilter(index);
  }
  function _removeNode(node: HologramQueryLeaf) {
    postQB.removeNode(node);
  }
  function removeCondsMatching(pred: (c: HologramQueryLeaf) => boolean) {
    return postQB.removeCondsMatching(pred);
  }
  function qHasValue(type: string, value: string) {
    return postQB.qHasValue(type, value);
  }
  function afterQueryChange() {
    postQB.refresh();
  }
  // 投稿側のサイドバーの行き先（フォルダ／保存した検索）は、単なるクエリの編集ではなく
  // 別の場所への移動（#312）。画像ビューが出ていればそこを離れ、まず投稿グリッドにいる
  // 状態にする。その際に自前の描画はしない＝続くクエリの書き換えがちょうど1回描画し、
  // グリッドのエントリを1件だけ記録する（その時点で activeImageTab は消えているので、
  // その描画はもう背面の更新として飲み込まれない）。setBrowseModeLite は描画を伴わない
  // モードの切り替え。ビューが隠れていて既に投稿を見ている時は、どちらの呼び出しも何もしない。
  function enterPostsForSidebar() {
    imageTabCtl.hideImageView();
    setBrowseModeLite('posts');
  }
  // 静的フォルダはサイドバーの現在地。クエリの葉には混ぜないので、ツールバーはこの場所で
  // 追加した絞り込みだけを示す。タブのスナップショットは activeFolderId も運ぶ。
  openFolder = (id) => {
    enterPostsForSidebar();
    if (store.getState().activeFolderId !== id) store.setState({ activeFolderId: id });
    renderPosts();
  };
  // クエリを保存されたもので置き換える。resetAllFilters と同じ手順を踏む（木を丸ごと
  // 入れ替えるので、結び付いていた編集中の葉を忘れ、入力欄を空にする必要がある）＝
  // 保存された自由文の語は、入力欄の中身ではなくチップとして戻ってくる。
  applySavedSearch = (id) => {
    const f = CF() && CF().byId(id);
    if (!f || f.kind !== 'dynamic') return;
    enterPostsForSidebar();
    store.setState({ activeFolderId: null });
    postQB.setTree(f.tree || null);
    searchEditing.clear();
    setSearchBoxValue('');
    afterQueryChange();
  };
  saveCurrentSearch = (name) => folders.createFolder(name, { kind: 'dynamic', tree: currentTree() });

  const CF = () => folders; // 共有のフォルダモジュール

  // --- 設定。今は完全にコンポーネントが持つ（モーダルは settings/、開く呼び出しは
  // LeftSidebar の歯車。Esc ／背景クリックで閉じる処理もコンポーネント側）。
  // #settingsBtn に付いていた旧 wireSettingsGear() のリスナーは、その onClick と重複していた。

  // （サイドバー自身の「先頭へ戻る」ボタンがここにあった。ファセット列のスクローラーを
  // 見張っていて、どちらもその列と一緒に無くなった＝ナビのサイドバーは、欲しがるほど
  // 長くない。コンテンツ領域の方のボタンは下に残っている。）

  // （コンテンツ領域の「先頭へ戻る」ボタンをここで結んでいた。その要素はシェルの切り替えと
  // 一緒に無くなったので、以来リスナーは何にも結び付いていなかった＝P3 #6。）

  // --- 投稿者（投稿者の行 → フライアウト。投稿の投稿者の欄から導く。取得はしない） ---
  // buildUsers（世代でキャッシュする投稿者の集約）は users.ts へ移した（上で import
  // 済み）＝5番目の切り出し。再代入される let（allPosts / _allPostsGeneration）は getter
  // として注入する。userKey/hostOf はこの時点で初期化済みの const（上の query.ts の
  // import）なので、そのまま渡す。
  // （buildSuggest は #28 で users.ts から出た＝検索ボックスの候補行は今はコマンドの
  // 登録簿のコーパス提供側が持つ。下の makeCommands を参照。）
  let posterProfiles: Array<Record<string, any>> = [];
  let profilesGeneration = 0;
  const { buildUsers } = makeUsers({
    allPosts: () => postGrid.getAllPosts(),
    profiles: () => posterProfiles,
    generation: () => `${postGrid.getGeneration()}:${profilesGeneration}`,
    userKey,
    hostOf,
    resolve: (key) => aliases.resolve(key), // #23 St1＝投稿者が統合されていなければ恒等
  });

  // --- 画像の供給元（保存フォルダから asset:// プロトコル経由で配る） ---
  // 素のファイル名に対する asset の URL を作る。w>0 なら main に縮小したサムネイルを頼む
  // （タイル用）。実装は asset-src.ts にある（#777 でタグ分割のレビュー画面と共有するため
  // 切り出した）＝この閉包のビルダーはどれも依存経由で `fileSrc` を名前で注入されて
  // いるので、ここではローカルの名前のままにしてある。

  // レコードの形の補助（mediaFilesOf/artworkFile/
  // densityImage）、正規化（postIdKey/postKeyOf）、グループ化（groupRecords）、
  // percentileFn は records.ts へ移した（import 済み）。

  // hostOf / userKey は query.ts へ移した（上で import 済み）。

  // --- 投稿グリッド。allPosts/_postsById/loadPosts/renderPosts、描画の再利用の防ぎ、
  // manualGroups/ungrouped/viewGroups/stickyRecs、折り畳み／カードの右クリックメニュー、
  // 削除の流れは、今はすべて post-grid-builder.ts にある（「allPosts の所有権の移譲」＝
  // viewer.ts decomposition で最大の切り出し）。
  // この閉包がまだ持っているもの（密度／ビューの状態、インスペクタ、選択、タブ、
  // 投稿者ビュー、起動のオーケストレーション）は下で注入する。いくつかは前方参照
  // （postQB/buildUsers/showDetail/renderPosters/… はこの閉包の後ろで宣言する）＝
  // このファイルの他の service の結線が既にそうしているのと同じ、TDZ に対して安全な
  // 遅延アロー関数。
  // 選択テキスト用のメニュー行（#167）。呼び出し側2つが同じ3行を必要とするのでここで
  // 組む。カードのメニューはこれを差し込み（下の postGrid の依存）、document レベルの
  // 受け皿はそれ以外の場所でこれだけを開く。searchBox はずっと下で結ぶので、その検索の
  // 入り口は他と同じく遅延アロー関数。
  const selectionMenu = makeSelectionMenu({
    t: getMessage,
    searchInLibrary: (text) => searchBox.searchFor(text),
  });
  handleSelectionContextmenu = selectionMenu.handleContextmenu;

  const postGrid = makePostGridBuilder({
    t: getMessage,
    smokeCapture: SMOKE_CAPTURE,
    fileSrc,
    shape: currentShape,
    gridThumbW,
    listThumbW,
    sortValue,
    postShadow: () => postQB.shadow(),
    getFilteredPosts: () => getFilteredPosts(),
    buildUsers: () => buildUsers(),
    resolve: (key) => aliases.resolve(key), // #23 St1
    snapshotState: () => tabsCtl.snapshotState(), // tabsCtl は下で生成する＝遅らせた前方参照
    syncTitleAndPersist: () => tabsCtl.syncTitleAndPersist(),
    renderPosters: (keepLimit) => renderPosters(keepLimit),
    onPostsLoaded: (profiles) => {
      posterProfiles = profiles;
      profilesGeneration++;
      // 開いている画像ビューは services/image-tab.ts の posts-data.ts の購読経由で
      // その場で導き直し、インスペクタの切り替えは今の履歴エントリからグループを新しく
      // 解決する＝更新すべきキャッシュ済みのグループが無い（#144）。
    },
    showDetail: (g, opts) => showDetail(g, opts),
    jumpToPoster: (post) => jumpToPoster(post),
    addImageTab: (g) => imageTabCtl.addImageTab(g),
    selectionMenu,
  });
  const { loadPosts, renderPosts, markPostsMutated, keepCurrentVisible, showFoldMenu, showCardMenu } = postGrid;
  bindLoadPosts(postGrid.loadPosts);
  bindConfirmClearAll(postGrid.confirmClearAll);
  bindGetSkipDeleteConfirm(postGrid.getSkipDeleteConfirm);
  bindSetSkipDeleteConfirm(postGrid.setSkipDeleteConfirm);

  // 一覧の処理の流れ＝getFilteredPosts（内容のゲート → クエリの木 → sticky の併合 →
  // 並び替え）、namedPosters/filteredPosters、集まりの導出は listing.ts へ移した
  // （上で import 済み）。7番目の切り出し。実行時の結び付きは注入する。再代入される let
  // （allPosts/_postsById/posterSort/folderSort）は getter として、posterQB は後で宣言する
  // const なので、アロー関数のラッパーで読み取りを TDZ の先へ遅らせる（投稿者を描画して
  // からしか走らない）。
  // 集まりの導出（filteredFolders / dynamicMatches / …）はもう分割代入していない＝集まりは
  // サイドバーのフォルダ一覧になった（2026-07-04）ので、ここで使うのは投稿／投稿者の
  // 選別の流れだけ。
  const { getFilteredPosts, namedPosters, filteredPosters } = makeListing({
    allPosts: () => postGrid.getAllPosts(),
    postsById: () => postGrid.getPostsById(),
    mediaFilesOf,
    densityImage,
    percentileFn,
    evalNode,
    treeLeaves,
    postPredOf,
    currentTree,
    activeFolderId: () => store.getState().activeFolderId,
    stickyRecs: postGrid.getStickyRecs(),
    sortValue,
    // シャッフルの種（#118）＝hologramStore の 'shuffleSeed'。並び順のキー自体と同じく
    // タブごとにスナップショットを取る。読むのは 'random' の並び順だけ。
    shuffleSeed: () => store.getState().shuffleSeed,
    searchQuery: () => searchQuery(),
    buildUsers,
    posterQBEval: (u) => posterQB.eval(u),
    posterQBTree: () => posterQB.getTree(),
    // 投稿者の並び順の唯一の情報源は hologramStore の 'sortPoster'（表示ポップオーバーが
    // 書く）。未設定なら既定は 'count'（投稿者の並び順は永続化しないので、読み込み直すと
    // 戻る＝旧閉包の既定と同じ）。
    posterSort: () => store.getState().sortPoster,
    // 集まりはサイドバーのフォルダへ移行し、集まりの並び順の UI は無くなった。だから
    // listing.js の filteredFolders() は眠ったままのスマートコレクションの土台で、ここから
    // 呼ばれることはない。この getter は既定（名前順）でその約束を満たすだけ＝今の
    // ビルドでは実際には一度も呼ばれない。
    folderSort: () => 'name',
    allFolders: () => (CF() ? CF().allFolders() : []) as HologramFolder[],
    filterLabel,
  });
  // listing.ts の namedPosters の live binding に結び付ける＝services/sidebar.ts の投稿者の
  // source が、この orchestrator のインスタンスが使うのと同じ namedPosters() を読めるように
  // する（投稿者インスタンスの行の開閉のため）。再実装ではなく結び付けにしている理由は、
  // 上の hologramTags.tagKindOf の注記を参照。
  bindNamedPosters(namedPosters);

  // 描画の再利用の防ぎ（lastRenderedState/_lastRenderGen/_lastViewGroups/
  // _lastStickySize）は今は post-grid-builder.ts にある。下の
  // tabsCtl.syncTitleAndPersist() が postGrid.setLastRenderedState 経由で
  // lastRenderedState を書く。
  // nav の履歴（ブラウザ風の戻る／進む）、hologramStore に載った tabs/activeTabId の
  // アクセサ、タブの CRUD の操作は、viewer.ts decomposition の中ですべて
  // tabs-builder.ts へ移した。
  // 画像タブは下の image-tab-builder.ts へ移し＝そのモジュールのスコープへ＝tabsCtl の
  // タブ状態の面を、遅延させた依存か直接の参照として受け取る（imageTabCtl は tabsCtl の
  // 直後で生成する）。
  const tabsCtl = makeTabsController({
    t: getMessage,
    tabTitleOf,
    postQB,
    getActiveFolderId: () => store.getState().activeFolderId,
    setActiveFolderId: (id) => store.setState({ activeFolderId: id && CF()?.byId(id) ? id : null }),
    getSortValue: sortValue,
    // 復元はキーを書くだけで他は何もしない。renderPosts は呼び出し側の次の手なので、
    // ここで setPostSort() を通すと履歴のエントリが重複して push される。
    setSortValue: (v) => store.setState({ sortPost: v }),
    // シャッフルの種はタブのスナップショットの中を並び順のキーと一緒に運ばれる（#118）
    // ので、復元したタブは出していた順序をそのまま再現する。
    getShuffleSeed: () => store.getState().shuffleSeed,
    setShuffleSeed: (v) => store.setState({ shuffleSeed: v || '' }),
    searchQuery: () => searchQuery(), // makeSearchBox() はずっと下で結ぶ＝遅延させる
    setSearchBoxValue: (v) => setSearchBoxValue(v),
    rebindEditingTextLeaf: () => rebindEditingTextLeaf(),
    renderPosts: (keepLimit) => renderPosts(keepLimit), // postGrid は上で宣言済み＝既にスコープにある
    setLastRenderedState: (json) => postGrid.setLastRenderedState(json),
    getAllPostsCount: () => postGrid.getAllPosts().length,
    resetAllFilters: () => resetAllFilters(),
    setBrowseModeLite: (m) => setBrowseModeLite(m), // setBrowseModeLite はずっと下で宣言する＝遅延させる
    contentScrollTop: () => contentScrollTop(),
    scrollContentTo: (y) => scrollContentTo(y),
    getPosterTree: () => posterQB.getTree(), // posterQB はずっと下で生成する＝遅延させる
    setPosterTree: (t) => posterQB.setTree(t),
    getPosterSort: () => store.getState().sortPoster,
    setPosterSort: (v) => store.setState({ sortPoster: v }),
    renderPosters: () => renderPosters(),
    showImageView: (recs, idx) => imageTabCtl.showImageView(recs, idx), // imageTabCtl はすぐ下で生成する＝遅延させる
    hideImageView: () => imageTabCtl.hideImageView(),
    getPostById: postGrid.getPostById, // #145: 記録した image のエントリのタイトルを引く
    // まとめる時の手がかり（#144 確定（保留項目2））。開いているファセットエディタの
    // セッション、無ければ検索を打ち込んでいる最中のまとまり（searchBox はずっと下で
    // 生成する＝読み取りを遅延させる）。
    navCoalesceKey: () => _filterEditSession || searchBox.liveSearchKey(),
  });
  const { getTabs, mutateTabs, getActiveTabId, setActiveTabId, nav, persistTabsDebounced, saveActiveTabState } = tabsCtl;
  // tabsCtl の残りの面は、上のモジュールスコープの export 経由でしか読まれない
  // （App.tsx/Activebar.tsx/Tabs.tsx がそれらを直接 import する）＝分割代入ではなく
  // プロパティごとに代入しているので、`export let` を覆う同名のローカルの束縛が生まれない。
  navBack = tabsCtl.navBack;
  navForward = tabsCtl.navForward;
  handleShortcutNavKey = tabsCtl.handleShortcutNavKey;
  handleShortcutMouseNav = tabsCtl.handleShortcutMouseNav;
  switchTab = tabsCtl.switchTab;
  addTab = tabsCtl.addTab;
  openHistoryEntry = tabsCtl.openHistoryEntry;
  openHistoryEntryInBackgroundTab = tabsCtl.openHistoryEntryInBackgroundTab;
  getPostById = postGrid.getPostById;
  closeTab = tabsCtl.closeTab;
  closeTabByGesture = tabsCtl.closeTabByGesture;
  showTabMenu = tabsCtl.showTabMenu;
  handleGlobalTabShortcut = tabsCtl.handleGlobalTabShortcut;

  // --- 画像ビュー（履歴の 'image' エントリ）＝画面に合わせて出す詳細ビュー（Eagle 風） ---
  // ビューと状態のまとまり（showImageView/hideImageView/openImageEntry/
  // setImageTabIndex/toggleImageTabInspector/closeImageTab/addImageTab）は
  // image-tab-builder.ts にある（viewer.ts decomposition の一部。#144 で type:'image' の
  // タブを、タブごとに統一した履歴のエントリへ作り替えた）。
  // showDetail/closeDetail（inspector-builder.ts）はずっと下で宣言する＝postGrid 自身の
  // showDetail/closeDetail の依存が既にそうしているのと同じ、TDZ に対して安全な遅延
  // アロー関数。
  const { buildGroupGalleryItems } = makeGallery({ fileSrc });
  const imageTabCtl = makeImageTabController({
    t: getMessage,
    getPostById: postGrid.getPostById,
    viewedPostIdAt: (g, idx) => {
      const items = buildGroupGalleryItems(g);
      if (!items.length) return null;
      return items[Math.max(0, Math.min(idx, items.length - 1))].postId || null;
    },
    recordView: (captureId) => {
      // 閲覧の書き込みで画像ビューを待たせない。返った値だけを正本の投稿オブジェクトへ
      // 当て、戻る操作が先に終わっていた場合はその場で並びも直す。
      void recordPostView(captureId)
        .then((result) => {
          if (!result.ok) return;
          const post = postGrid.getPostById(captureId);
          if (!post) return;
          post.localViewCount = Math.max(Number(post.localViewCount) || 0, result.localViewCount);
          refreshPostViewCount(captureId, post.localViewCount);
          markPostsMutated();
          if (!imageTabCtl.isShowing()) renderPosts(true);
        })
        .catch(() => {});
    },
    showDetail: (g) => showDetail(g),
    // postGrid と同じ理由。タブが詳細を持たなくなった時、画像ビューはそれを手放す。
    // 対象を失うことは「このパネルは要らない」ではない。
    dismissDetail: () => dismissDetail(),
    closeTab: (id) => tabsCtl.closeTab(id),
    getActiveTabId,
    setActiveTabId,
    mutateTabs,
    saveActiveTabState,
    nav,
    navBack: () => navBack(),
    persistTabsDebounced,
  });
  const { openImageEntry, setImageTabIndex, toggleImageTabInspector, closeImageTab, addImageTab } = imageTabCtl;
  subscribePostsData(() => imageTabCtl.refreshTitlesAfterPostsChange());

  // initTabs/showTabMenu/タブの CRUD の操作/Ctrl+T・W・Tab のショートカットは、今は
  // すべて tabsCtl にある。ストリップが呼ぶものについては、上のその生成場所で
  // モジュールスコープの export への代入を済ませてある。

  // keepCurrentVisible/imgAspect/cardModel/hologramPostGridSource.configure/
  // renderPosts はすべて post-grid-builder.ts へ移した（上の postGrid）。
  const _prefersReducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 画像のライトボックス／クイックビューの覗き見（画像1枚＝#143）。オーバーレイの UI は React の
  // コンポーネントにある（services/lightbox.ts と lightbox/）。orchestrator.ts は下で投稿の
  // ギャラリー項目を解決し、その先頭（サムネイル）を open() に渡すだけ。全ページを
  // めくる機能は画像ビューへ移した。

  // ライトボックスのギャラリー項目は records.js（makeGallery）が組む。asset の URL の
  // 組み立ては、注入した fileSrc 経由で orchestrator が持ったままにする。
  // services/image-tab.ts の pull 側の source は、同じギャラリーのインスタンスを使い回す＝
  // configure() が一度だけ設定する。グリッドの source と同じ「変わらないコールバックを
  // 一度だけ設定する」形。onIndexChange/onToggleInspector/onCloseTab は、image-tab.ts が
  // 以前は旧共有ブリッジ経由で行っていた発火を置き換えた DI のコールバック。
  hologramImageTabSource.configure({
    gallery: { buildGroupGalleryItems },
    labels: {
      missing: getMessage('imgTabMissing'),
      missingDesc: getMessage('imgTabMissingDesc'),
      closeTab: getMessage('imgTabCloseBtn'),
      prev: getMessage('lbPrev'),
      next: getMessage('lbNext'),
      info: getMessage('tipInfo'),
      crop: getMessage('imgTabCrop'),
      cropApply: getMessage('imgTabCropApply'),
      cropCancel: getMessage('imgTabCropCancel'),
      cropRemove: getMessage('imgTabCropRemove'),
      cropArea: getMessage('imgTabCropArea'),
      cropHandleNW: getMessage('imgTabCropHandleNW'),
      cropHandleN: getMessage('imgTabCropHandleN'),
      cropHandleNE: getMessage('imgTabCropHandleNE'),
      cropHandleE: getMessage('imgTabCropHandleE'),
      cropHandleSE: getMessage('imgTabCropHandleSE'),
      cropHandleS: getMessage('imgTabCropHandleS'),
      cropHandleSW: getMessage('imgTabCropHandleSW'),
      cropHandleW: getMessage('imgTabCropHandleW'),
      play: getMessage('ugoiraPlay'),
      pause: getMessage('ugoiraPause'),
      ugoira: getMessage('ugoiraLabel'),
    },
    onIndexChange: setImageTabIndex,
    onToggleInspector: toggleImageTabInspector,
    onCloseTab: closeImageTab,
  });

  // 比較ビュー（#82）。選択した2〜4件の投稿を、それぞれ代表画像1枚で並べる＝カードを1枚
  // 覗く時に openQuickView が既に使っているのと同じ解決（buildGroupGalleryItems(g)[0]）。
  // 動画が先頭の群は動画のまま。うごイラはその場で再生せず、ポスター画像で代用する
  // （#82 は細かい挙動を実装に委ねていて、比較グリッドには、単体の画像ビューのように
  // UgoiraPlayer を駆動するコントローラが無い）。
  function openCompareView() {
    const groups = selection.selectedGroups(postGrid.getViewGroups(), postIdKey);
    const items: CompareItem[] = [];
    for (const g of groups) {
      const gi = buildGroupGalleryItems(g)[0];
      if (!gi) continue;
      items.push({ src: gi.ugoira ? gi.poster || gi.src : gi.src, alt: gi.alt, video: gi.video });
    }
    compareOpen(items);
  }

  // ゴミ箱（#268）。ゴミ箱はライブラリ自身のカードを描き＝post-grid-builder の cardModel と
  // そのラベル一式をそのまま持ち込む＝レコードもライブラリのグループ化でまとめる。だから
  // カード1枚として削除した複数画像の投稿は、カード1枚として戻ってくる。ゴミ箱自身の
  // モジュールスコープではなくここで結ぶのは、両方の半分（カードのモデルと、覗き見が読む
  // ギャラリー）を orchestrator が持っているから。ゴミ箱のビュー自体は asset:// の組み立てと
  // グループ化の規則から切り離しておく。
  hologramTrashGridSource.configure({
    modelOf: (g, i) => postGrid.cardModel(g, i),
    keyOf: (g) => postIdKey(g.rep),
  });
  configureTrashView({
    t: getMessage,
    groupRecords: postGrid.groupRecords,
    openQuickView: (g) => lightboxOpen(buildGroupGalleryItems(g)[0]),
  });

  // 投稿カードが答えるすべての操作を、セル自身の props として渡す（#618）。以前はグリッドの
  // 入れ物に載った6つの委譲リスナーで、DOM から `data-index` 属性を読み戻してグループを
  // 復元していた＝#153 の分類1と2＝カードはマークアップの形を、グリッドは id を約束する
  // 必要があった。今はセルがグループをそのまま返す。selectionCtl/showDetail は下で宣言する。
  // これらはどれも実際の操作より前には走らないので、閉包の前方参照として安全。
  //
  // #143 P2⑥: 素のクリックはカードを単独選択し、同時にインスペクタにも出す（Eagle や
  // エクスプローラー風＝「単独＝選んで詳細を出す」）。Ctrl は追加・解除、Shift は範囲選択で、
  // どちらもインスペクタには触れない（確定、保留項目2）。ダブルクリックは、タブ内の履歴の
  // 行き先として画像ビューを開く（#144）。
  // その操作がカードの画像の上に落ちたか（テキストやメタデータではなく）を判定する。
  // 下の2つの中クリックの挙動は、画像そのものについての話。
  const onMedia = (e: { target: EventTarget | null }) => e.target instanceof Element && !!e.target.closest('[data-slot="post-card-media"]');
  const postCardActions: HologramCardActions = {
    onClick: (g: HologramPostGroup, e) => {
      if (selectionCtl.clickSelect(g, e) && g) showDetail(g);
    },
    // メディアのない投稿では空の画像ビューを開かず、シングルクリックと同じ
    // インスペクタを表示する。
    onDoubleClick: (g: HologramPostGroup) => {
      if (!buildGroupGalleryItems(g).length) {
        showDetail(g);
        return;
      }
      openImageEntry(g);
    },
    // メディアを中クリック → その投稿を背面の画像タブとして開く（ブラウザ風）。
    onAuxClick: (g: HologramPostGroup, e) => {
      if (e.button !== 1 || !onMedia(e)) return;
      e.preventDefault();
      addImageTab(g);
    },
    // メディアの上での中クリックによる自動スクロールを抑える。
    onMouseDown: (_g: HologramPostGroup, e) => {
      if (e.button === 1 && onMedia(e)) e.preventDefault();
    },
    // foldMenuItems/onFoldMenuPick/showFoldMenu と cardMenuItems/onCardMenuPick/
    // showCardMenu は post-grid-builder.ts にある（上の postGrid）。
    onContextMenu: (g: HologramPostGroup, e) => {
      e.preventDefault();
      if (selection.size() > 1) {
        // 2〜4件を選んでいる時（#82）。比較に必要な一括の行はこれ1つで、フローティングの
        // 選択バーに足すのではなくここで開く＝#82 が受け入れた起動経路は右クリック
        // メニューそのもの。その件数の外では出すものが無く、一括操作はすべて選択バーが
        // 持ったまま＝#82 の前から変わらない。
        if (selection.size() >= 2 && selection.size() <= 4) {
          menuOpen({ items: [{ label: getMessage('ctxCompare'), act: 'compare' }], x: e.clientX, y: e.clientY }, (item) => {
            if (item.act === 'compare') openCompareView();
          });
        }
        return;
      }
      // カードの本文は選択できるので、同じクリックがテキストへの操作にもなりうる＝
      // 2つ目のメニューを開くのではなく、行をこのメニューへ差し込む（#167）。
      showCardMenu(g, e.clientX, e.clientY, selectionTextAt(e.target));
    },
  };
  hologramPostGridSource.configureActions(postCardActions);
  // ゴミ箱は同じセルを描くが、答える操作はずっと少ない。クリックはゴミ箱自身の選択の
  // 中で選び、ダブルクリックは覗き見で、それ以外はすべて断る（理由は trash/TrashGrid.tsx を
  // 参照）。
  hologramTrashGridSource.configureActions({
    onClick: (g: HologramPostGroup, e) => trashClickCard(postIdKey(g.rep), { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }),
    onDoubleClick: (g: HologramPostGroup) => trashPreview(postIdKey(g.rep)),
  });

  // サイドバーのフォルダチップ（共有の folders.json）＝件数と ★既定。タグのチップと同じく
  // 消灯→いずれか（OR）→すべて含む（AND）→消灯 と巡り、タグと同じ AND/OR の式に加わる。
  // postFolderChips は撤去した（集まりは集まりのビューへ移った）。「複数画像」の行の項目
  // （選択状態）は、今は services/sidebar.ts の hologramPostSidebarSource が自分で導く＝
  // multi やフォルダを書き換えた後に、orchestrator 側から描画し直す呼び出しは要らない。
  // フォルダの管理は左サイドバーの木に統合した（ライブラリと投稿者の両方。#41、#6 の残り
  // 項目1）。旧 #postFolderManage ボタンと、フォルダ管理のモーダル（qf-pop のフッタの
  // 管理ボタン）は、どちらもコードから削除済み。

  // 「複数画像」のサイドバーの行。グループ単位の multiOnly フラグを、モデル経由で行の
  // 選択状態（強調色のアイコン）として映す。それを切り替えるクリックは、委譲した
  // #filterRows のリスナーが扱う。

  // toggleCardSelection/syncSelectionClasses/selectedRecords/clearSelection/
  // updateSelectionBar/groupSelected/toggleSelectAll/handleShortcutSelectAllKey/
  // requestDeleteSelected/handleSelectionBarClick は、viewer.ts decomposition の中で
  // selection-builder.ts へ移した。インスペクタの後（その persistManual が要る）に、下で
  // 生成する＝selectionCtl を参照。

  // requestDeleteGroup/executeDeleteGroup は post-grid-builder.ts へ移した（上の postGrid）。

  // === インスペクタ（カードの ℹ）＝右に居座る列／せり出すパネル ===
  // 開閉の枠、インラインのタグエディタ（追加／切り替え／ソースタグの取り込みと同名の
  // 判定）、グループの解除・再グループ化のボタン、Esc と外側クリックで引っ込める防ぎは、
  // viewer.ts decomposition の中で inspector-builder.ts へ移した。今どれを詳細に出して
  // いるかのキー自体は hologramStore の 'inspectedKey'＝このモジュールの他の読み書き
  // （下の投稿者カードのクリック、取り消し、閲覧モードの切り替え）もすべてそのキーへ行くので、
  // そのために渡すものは何も無い。
  const inspector = makeInspector({
    t: getMessage,
    fileSrc,
    showToast: notify,
    showKindMenu,
    buildUsers,
    resolve: (key) => aliases.resolve(key), // #23 St1
    tagKindOf,
    tagKindOfName,
    worksCooccurringWith,
    jumpToPoster: (post) => jumpToPoster(post), // jumpToPoster（posterGrid）はずっと下で宣言する＝遅延させる
    openQuickView: (g) => lightboxOpen(buildGroupGalleryItems(g)[0]), // インスペクタのサムネイル → クイックビューの覗き見（画像1枚、#143）
    pushUndo,
    inspectorTagPickerData,
    getViewGroups: postGrid.getViewGroups,
    getAllPosts: postGrid.getAllPosts,
    getPostById: postGrid.getPostById,
    getUngrouped: postGrid.getUngrouped,
    getManualGroups: postGrid.getManualGroups,
    markPostsMutated,
    renderPosts,
    keepCurrentVisible,
    getActiveTabId,
    closeTab,
    imageTabShowing: () => imageTabCtl.isShowing(), // 素の値の読み取り＝スナップショットではなく生きている値
    // #180: 引用／返信先のカードを押して掘り下げる操作（inspector-builder.ts の deps の
    // インタフェースのコメントを参照）＝postQB は既に上（およそ632行目）で生成済みなので、
    // jumpToPoster のような遅らせた前方参照ではなく直接のラッパー。
    postQBResetTree: () => postQB.resetTree(),
    addFilter: (filter) => addFilter(filter),
  });
  // closeDetail（「パネルを閉じた」という設定を保存する方）を取り出しているのは、呼び出し側が
  // 1つだけあるため＝下の投稿者のインスペクタの ×。orchestrator の他の場所が副作用として
  // インスペクタを無効にしてはいけない。それはシェルの切り替えが inspector-panel 経由で持つ。
  const { closeDetail, dismissDetail, showDetail, refreshPostViewCount, persistManual } = inspector;
  handleEscDismissDetail = inspector.handleEscDismissDetail;

  // === 選択（カードを押すと選ばれ、1件以上でバーが出る） ===
  // groupSelected がインスペクタの persistManual を必要とするので、このまとまりの元の場所では
  // なく、ここ（上の inspector の後）で生成する。
  const selectionCtl = makeSelectionBar({
    t: getMessage,
    showToast: notify,
    getViewGroups: postGrid.getViewGroups,
    getManualGroups: postGrid.getManualGroups,
    setManualGroups: postGrid.setManualGroups,
    markPostsMutated,
    renderPosts,
    loadPosts,
    persistManual,
    showFoldMenu,
    // bulkTag はすぐ下で生成する＝この selectionCtl 自身の selectedRecords が要るので
    // 遅延させる。
    openBulkTagDialog: () => bulkTag.openBulkTagDialog(),
    copyGroupsFiles: (groups) => postGrid.copyGroupsFiles(groups),
    openQuickView: (g) => lightboxOpen(buildGroupGalleryItems(g)[0]), // Space での覗き見（画像1枚、#143）
    showDetail: (g) => showDetail(g), // 矢印での移動は素のクリックと同じくインスペクタを差し替える
    dismissDetail: () => dismissDetail(), // 背景のクリックは選択と一緒にパネルも空にする（#242）
  });
  const { selectedRecords } = selectionCtl;
  // 選択は、上の統一したカードの操作だけで動く（素＝単独選択＋インスペクタ、Ctrl＝追加・
  // 解除、Shift＝範囲）。旧来のホバーの ○ の輪（かつて選択へ入る唯一の道だった）と、
  // キャプチャ相の「選択中はどのクリックも切り替える」ハンドラは無くなった＝ホバーの部品を
  // 一切持たない Eagle そのものの形（確定 A）と、シングルクリックでの選択（確定、保留項目2）に
  // 統一した。ℹ ボタンも同じく撤去した。インスペクタへは素のクリック（またはカードの右クリック
  // メニューの「詳細」）で着く。ホバー専用のボタンではない。
  handleShortcutSelectAllKey = selectionCtl.handleShortcutSelectAllKey;
  handleShortcutCopyKey = selectionCtl.handleShortcutCopyKey;
  handleShortcutQuickView = selectionCtl.handleShortcutQuickView;
  handleShortcutArrowNav = selectionCtl.handleShortcutArrowNav;
  // 画面下のフローティングバー向けの一括操作の束縛（P2⑥）＝FloatingBar コンポーネントから
  // 直接呼ばれる（#selectionBar の入れ物も data-act による振り分けも、もう無い）。
  selectionSelectAll = selectionCtl.toggleSelectAll;
  selectionTag = selectionCtl.tagSelection;
  selectionFolder = selectionCtl.folderSelection;
  selectionGroup = selectionCtl.groupSelected;
  selectionDelete = selectionCtl.requestDeleteSelected;
  selectionClear = selectionCtl.clearSelection;
  selectionMarquee = selectionCtl.marquee;
  selectionClickBackground = selectionCtl.clickBackground;
  // 投稿者グリッド自身の背景クリック（#242）。同じパネル、同じプレースホルダだが、選択を
  // 解くものが無い＝投稿者カードは詳細に出すだけで、選択されることはない（#143）。
  posterClickBackground = () => dismissDetail();

  // --- 一括の「選択にタグを付ける」（Dialog＝P2⑦） ---
  // 積んだタグはダイアログ自身の React の状態にあり、適用が仕上がった一覧を
  // bulk-tag-builder.ts へ渡すまで何も永続化しない。openBulkTagDialog がこのまとまり自身の
  // selectedRecords を必要とするので、ここ（上の selectionCtl の後）で生成する＝上の
  // selectionCtl への遅延させた依存を参照。
  const bulkTag = makeBulkTag({
    t: getMessage,
    showToast: notify,
    showKindMenu,
    inspectorTagPickerData,
    pushUndo,
    undoAction,
    markPostsMutated,
    renderPosts,
    keepCurrentVisible,
    getPostById: postGrid.getPostById,
    selectedRecords,
  });

  // --- 選択（カードを押すと選ばれ、1件以上でバーが出る） ---
  // 結線（selectionCtl、そのリスナー、toggleCardSelection/selectedRecords/
  // clearSelection/handleShortcutSelectAllKey）はインスペクタの隣へ繰り上げた＝そこの
  // selection-builder.ts のコメントを参照。

  // handleShortcutSearchFocusKey（`/` または Ctrl/Cmd+K で検索ボックスへ焦点を移す）は、
  // viewer.ts decomposition の中で search-box-builder.ts の makeSearchBox() の戻り値へ移し、
  // 下でそのファクトリの他の出力と一緒に結んでいる。

  // 描画を遅らせるタイマー。ビューや配置を切り替えた時、まず操作部（つまみと選択状態）を
  // 描き、重いグリッドの描画は1回描いた後に回す（先に反応を返す UI）。clearTimeout が
  // 素早い連打を1回の描画にまとめる。
  let _browseRenderT: any = null;
  // 密度は表示ポップオーバーのもの（hologramStore の 'view'）。それに対する反応
  // （currentView へ写す、永続化する、ビュー遷移付きで描画し直す）は今は
  // grid-density-builder.ts にある＝ここは React 側の subscribe の登録
  // （StoreSubscriptions、App.tsx）をそこへ橋渡しするだけ。
  handleDisplayStoreChange = gridDensity.handleDisplayStoreChange;

  // === 閲覧モードの切り替え。投稿グリッド ↔ 投稿者グリッド ↔ ゴミ箱 ===
  // 左のナビが出す3つの行き先。'trash'（#268）がモーダルではなく本物の閲覧モードとして
  // 2つに加わったのは、それがライブラリの中の場所そのものだから。ただしタブごとのビューでは
  // ない。タブの戻る／進むのスタックには誰も記録しないので、再起動後に復元したタブは元の
  // グリッドに戻る。よってゴミ箱を離れるのは、常に別の行き先への素朴な移動（または履歴の
  // 一歩。そちらは下の setBrowseModeLite 経由で自分の種別を適用する）。
  // 閲覧モードへの書き込みがすべて通るゲート。認識できないものは 'posts' に着く。戻り値の型は
  // HologramBrowseMode そのもの（ストア自身のユニオン）なので、ここを通っていないモードは
  // 書き込めない。集まりは撤去済み（今はサイドバーのフォルダ一覧）。
  const normalizeBrowseMode = (mode: string): HologramBrowseMode => (mode === 'posters' ? 'posters' : mode === 'trash' ? 'trash' : mode === 'timeline' ? 'timeline' : 'posts');
  // 軽い方の半分。描画せずにモードを書く（ついでに古くなった詳細を閉じる）。
  // applyEntry（tabs-builder）がこれを使うので、履歴の復元はちょうど1回だけ描画する＝
  // その直後に走る、種別ごとの描画がそれ。
  // 設定への書き込みはどこにも無い。モードは今や履歴のエントリに載るタブごとの状態
  // （#144 確定（保留項目3）＝旧来のグローバルな browseMode の設定は撤去した。新しいタブは
  // 投稿で開く）。
  function setBrowseModeLite(raw: string) {
    const mode = normalizeBrowseMode(raw);
    if (store.getState().browseMode === mode) return;
    // ストアがモードそのもの。React のコンポーネント（LeftSidebar の選択状態、グリッドの
    // ホスト）も、モードで分岐するビルダーも、みなこの1つのキーを読む。
    store.setState({ browseMode: mode });
    dismissDetail(); // 古くなった投稿／投稿者の詳細は切り替えを生き延びるべきではない＝ただしパネル自体は残るべき
  }
  // コンテンツ領域を投稿グリッドと投稿者グリッドの間で切り替える（同じタブの中で）。
  // 「今何を見ているか」という意味の切り替えで、カード／タイル／一覧の密度とは別のもの。
  // 描画は、新しい種別の履歴エントリとして着地する（renderPosts / renderPosters が記録する＝
  // その push こそが、タブの履歴の上でのモードの切り替え）。
  function setBrowseMode(mode: string) {
    mode = normalizeBrowseMode(mode);
    setBrowseModeLite(mode);
    // 先に反応を返す UI。モードの状態（選択状態、body のクラス経由のグリッドの入れ替え）は
    // 上で同期に更新した。重いグリッドの描画は1回描いた後へ回し、renderPosts/Posters を
    // 待たずに切り替えが即座に見えるようにする。
    const render = () => {
      if (store.getState().browseMode !== mode) return;
      // ゴミ箱はライブラリではなく .trash/ を読み、履歴のエントリを一切記録しない＝タブが
      // そこへ復元されることのないビューだから（normalizeBrowseMode を参照）。
      if (mode === 'trash') trashRefresh();
      else if (mode === 'posters') renderPosters();
      else renderPosts();
    };
    clearTimeout(_browseRenderT);
    _browseRenderT = setTimeout(render, 0);
  }
  // サイドバーのモードボタン → 閲覧の行き先（#312）。画像ビューが出ている間、行き先は
  // 「移動していく先」＝ビューを隠してから setBrowseMode に描画させ、グリッドのエントリを
  // 記録させる。今と同じモードでもそうする（setBrowseMode はそれでも描画するし、
  // activeImageTab を消してあるので、その描画は下の同一モードの判定なら飲み込んでしまう
  // エントリを記録する。飲み込まれるとビューが画像に取り残される）。画像ビューの外では、
  // 既に開いている行き先を押しても何もしない＝ただしその行き先が絞り込まれている時は別
  // （#812）。「ライブラリ」「投稿者」は集合全体を指す名前なので、絞り込まれた部分集合に
  // 着くと壊れて見える。行き先を押すと（初めて着く時でも、既に開いているものをもう一度
  // 押した時でも）、その側の絞り込みだけをリセットする＝resetAllFilters/resetPosterFilters は
  // 自分で履歴のエントリを記録するので、Alt+← は他の絞り込みの変更と同じようにリセットを
  // 取り消す。リセットするものが無い行き先は、手を触れない「何もしない」のまま（余計な
  // 描画も、余計な履歴のエントリも出さない）。
  browseTo = (raw) => {
    const mode = normalizeBrowseMode(raw);
    const posters = mode === 'posters';
    const reset = posters ? resetPosterFilters : mode === 'posts' ? resetAllFilters : null;
    const leaves = posters ? posterQB.getTree() : postQB.getTree();
    const hasFilters = !!reset && (treeLeaves(leaves).length > 0 || searchQuery().trim() !== '');
    const hasLocation = mode === 'posts' && !!store.getState().activeFolderId;
    // 「ライブラリ」は根の場所を指す。押した時は、現在地も条件と同じく解除する。
    if (hasLocation) store.setState({ activeFolderId: null });
    if (imageTabCtl.isShowing()) {
      imageTabCtl.hideImageView();
      if (hasFilters) reset();
      setBrowseMode(mode);
      return;
    }
    if (hasFilters) reset();
    // setBrowseMode は必ず描画して記録するので、「もうそこにいる」場合はここで止める。
    // 以前はこれを hologramStore への書き込みとして書き、subscribe のハンドラ経由で
    // 戻ってきていた＝同じモジュールが書いて読む1つの値なのに、その間に React の購読の
    // 登録を回り道として挟んでいた。
    if (store.getState().browseMode !== mode) setBrowseMode(mode);
    else if (hasLocation && !hasFilters) renderPosts();
  };

  // --- 投稿者グリッド（投稿者ビュー） ------------------------------------
  // カードは投稿の投稿者の欄から導く（buildUsers＝取得はしない）。クリックでインスペクタ
  // （投稿者のプロフィール）、ダブルクリックでその投稿者の投稿へ飛ぶ。
  // posterList 自体は今は poster-grid-builder.ts の内部の状態（getPosterList 経由で出す）。
  // posterSort（'count' | 'name' | 'date-desc' | 'date-asc'）は hologramStore の
  // 'sortPoster' にある（上の listing の依存の getter 経由で読む）。下の購読が、変化した
  // ときに描画し直す。
  // 投稿者グリッドの表示の軸（#630）は services/display.ts に、その副作用は上の投稿側と
  // 並んで grid-density-builder.ts にある。ここは React 側の subscribe の登録
  // （StoreSubscriptions、App.tsx）をそこへ橋渡しするだけ。
  handlePosterDisplayStoreChange = gridDensity.handlePosterDisplayStoreChange;
  // 投稿者の閲覧の絞り込み（プラットフォーム／タグ／インスタンス／フォルダ／日付範囲）は、
  // 別々の Set ではなく posterQB のクエリの木にある（createQueryBuilder と posterPredOf）。

  // 投稿者のグリッド／絞り込み／インスペクタ／フォルダのまとまり（posterWorkGroups、名前付きの
  // 投稿者フォルダのストア、prunePosterTagFilters、renderPosters、openPosterPosts/
  // jumpToPoster、投稿者のインスペクタ、投稿者の右クリックメニュー）は、viewer.ts
  // decomposition の中で poster-grid-builder.ts へ移した。サイズスライダーの状態は
  // grid-density-builder.ts（上）へ、表示の軸は services/display.ts へ移した。下の posterQB
  // より先に結ぶ（posterQB の生成には、ここの pfStore/posterFolderById が遅延アロー関数
  // ではなく直接の値として要る）＝逆にこのビルダーからは、posterQB は遅延アロー関数
  // （posterQBGetTree など）としてしか見えない。鏡写しの関係。
  const posterGrid = makePosterGridBuilder({
    t: getMessage,
    PF_NAME,
    fileSrc,
    showToast: notify,
    pushUndo,
    undoAction,
    showKindMenu,
    buildGroupGalleryItems,
    posterTagsOf,
    posterFilterVocab,
    inspectorTagPickerData,
    filteredPosters,
    buildUsers,
    getAllPosts: postGrid.getAllPosts,
    groupRecords: postGrid.groupRecords,
    markPostsMutated: () => postGrid.markPostsMutated(), // #23 St1
    namedPosters, // #23 St1＝統合のピッカーの候補の母集団
    posterQBGetTree: () => posterQB.getTree(),
    posterQBResetTree: () => posterQB.resetTree(),
    posterQBRemoveByLeaf: (type, value) => posterQB.removeByLeaf(type, value),
    posterQBRemoveCondsMatching: (pred) => posterQB.removeCondsMatching(pred),
    posterQBSyncShadow: () => posterQB.syncShadow(),
    postQBResetTree: () => postQB.resetTree(),
    addFilter,
    setSearchBoxValue: (v) => setSearchBoxValue(v), // makeSearchBox() はずっと下で結ぶ＝遅延させる
    setBrowseMode,
    // posterGrid はこれを投稿者のインスペクタの × に使うので、投稿側のパネルと同じ規則に
    // 従う。× は据え置きの列を画面から下ろす唯一の道なので、その設定を保存する。
    closeDetail,
    onPosterRendered: () => tabsCtl.syncPosterTitleAndPersist(),
  });
  const { pfStore, posterFolderById, deletePosterFolder, renderPosters, openPosterPosts, jumpToPoster, refreshPosterTagFields, showPosterDetail, showPosterMenu } = posterGrid;
  posterFolderStore = pfStore;
  removePosterFolder = deletePosterFolder;
  // --- 投稿者のクエリビルダー。同じビルダー（createQueryBuilder）を、投稿ではなく投稿者
  // （ユーザー）のオブジェクトに対して評価する。葉の型はプラットフォーム／インスタンス／
  // タグ（作品・キャラを含む）／フォルダ／日付（範囲）。そのチップは共有の絞り込みバー
  // （FilterChips が今のモードの木を読む）で、入り口は「絞り込みを追加」。 ---
  // 投稿者の葉の述語＝query.ts の makePosterPredOf（postPredOf の鏡）は、今は
  // query-builder.ts の makePosterQueryBuilder の中で呼ばれる。posterTagsOf（tags.js）と
  // posterFolderById（pfStore）は依存として渡す。どちらも上で宣言済みなので、直接参照でも
  // TDZ に対して安全。posterFilterLabel は tab-state.js の makeTabLabels にある
  // （filterLabel の近くで分割代入している）。
  // 投稿者の日付範囲のポップオーバー（とその editingPosterDateNode の状態）は、
  // filter-popover コンポーネントと一緒に撤去した（P2③ タスク3）。投稿者の日付チップは、
  // 今は filterbar の FormEditor を開き直す。
  // 投稿者側のビルダーのインスタンス（predOf とインスタンスの生成は query-builder.ts へ
  // 移した＝そのファイルの makePosterQueryBuilder を参照）。
  // 一時的なもの（投稿者にはタブも nav の履歴も無い）で、onChange → renderPosters
  // （行とグリッドを描き直す）。以前はここでも onShadow 経由で木の影をモジュールレベルの
  // `posterShadow` グローバルへ写していたが、そのグローバルを読む側は1つも無かった
  // （投稿者のサイドバーのモデルは posterQB.shadow() を直接読んでいたし、今は
  // services/sidebar.ts の source が、query.ts の buildShadow 経由で写された
  // 'posterQueryTree' のストアキーを読む）。だから読み取り側へ作り替えるのではなく、
  // まるごと削除した。
  const { qb: posterQB } = makePosterQueryBuilder({
    onChange: () => {
      renderPosters();
    },
    posterTagEntriesOf,
    folderById: posterFolderById,
  });

  // 投稿者側でフォルダを場所として扱う（上の openFolder の鏡。ただし
  // enterPostsForSidebar によるモードの切り替えは無い＝投稿者フォルダのサイドバーの行は、
  // 既に投稿者を見ている間しか描かれないので、離れるべき別のモードが存在しない）。
  applyPosterFolderFilter = (id) => {
    posterQB.removeCondsMatching((c) => c.type === 'folder');
    posterQB.addFilter({ type: 'folder', value: id });
  };

  // prunePosterTagFilters（裏付けの値が消えたタグ条件を落とす）は、投稿者のまとまりの
  // 残りと一緒に poster-grid-builder.ts へ移した＝上で posterGrid から分割代入している。

  // qf-pop の値の選択の振り分け＝viewer.ts decomposition の一部で、今は絞り込みバー向けの、
  // 画面を持たない選択のルーターでしかない（値のフライアウトと日付／反応のポップオーバーは、
  // それぞれのコンポーネントと一緒に撤去した。P2③ タスク3）。最初に使う場所ではなくここで
  // 結ぶのは、postQB/posterQB/buildUsers が既に本物の const になっているから＝getter を
  // 遅延させる間接参照が要らない。makeSearchBox() を遅く結んでいるのと同じ理屈
  // （search-box-builder.ts）。
  const qfPop = makeQfPop({
    postShadow: () => postQB.shadow(),
    posterShadow: () => posterQB.shadow(),
    posterQHasValue: (type, v) => posterQB.qHasValue(type, v),
    posterAddFilter: (filter) => posterQB.addFilter(filter),
    posterRemoveByLeaf: (type, v) => posterQB.removeByLeaf(type, v),
    posterRemoveFilter: (i) => posterQB.removeFilter(i),
    addFilter,
    removeFilter,
    buildUsers: () => buildUsers(),
  });

  // 「絞り込みを追加」のカテゴリメニュー（redesign §3-2 / P2③）＝今の閲覧モードが出せる
  // ファセットのカテゴリで、それぞれが自前の生きた値／適用の閉包を持つ。振り分けは
  // 使い回す＝値の選択は qfPop.pickValue（＝onQfPick。フライアウトを開かず画面を持たずに
  // 走る）を通り、日付／反応の書き込みは QB へ直接行く（撤去した filter-popover の onApply の
  // ロジックをそのまま写したもの）。filterbar コンポーネントは描画と振り分けだけをして、この
  // ロジックを組み直すことはない。開くたびに計算し直すので、件数・語彙・ラベルが新しいまま。
  filterCategories = function (): FilterCat[] {
    const pick = (cat: string) => (it: FilterRow) => qfPop.pickValue(cat, it as HologramQfPopItem);
    // 種別のドット。it.kind（'work'/'character'）を持つタグの行は、共通のカテゴリの
    // ドットを付ける＝（利用者が変えているかもしれない）ラベルをここで解決し、
    // コンポーネントは描くだけにする（フライアウトを撤去する前に renderQfPop が
    // やっていたのと全く同じこと）。
    const dot = (it: FilterRow) => (it.kind ? { ...it, dotTitle: kindLabel(it.kind as string) } : it);
    // モードのアクセサ（redesign §4-2 B）。1つのビューの QB とファセットのスキーマに
    // 結び付いていて、生きている木に対してファセットの「すべて」／「いずれか」／
    // 「〜でない」を読み書きする。mode() は木から導き（全部否定なら 'exclude'、そうでなければ
    // その塊の op か既定の op）、setMode() はその型の値をすべて否定するか否定を外し、群の op を
    // 設定してから更新をかける。
    const modeFor = (qb: typeof postQB, opts: typeof POST_FACET_OPTS) => (type: string) => ({
      mode: (): FacetMode => {
        const leaves = treeLeaves(qb.getTree()).filter((c) => c.type === type);
        if (leaves.length && leaves.every((c) => c.neg)) return 'exclude';
        const cl = facetViewOf(qb.getTree(), opts)?.clusters.find((c) => c.type === type);
        return cl ? (cl.op === 'and' ? 'and' : 'or') : facetDefaultOp(type, opts);
      },
      setMode: (m: FacetMode) => {
        const tree = qb.getTree();
        const leaves = treeLeaves(tree).filter((c) => c.type === type);
        if (m === 'exclude') {
          for (const l of leaves) if (!l.neg) facetSetNeg(tree, l, true, opts);
        } else {
          for (const l of leaves) if (l.neg) facetSetNeg(tree, l, false, opts);
          facetSetOp(tree, type, m);
        }
        qb.refresh();
      },
    });
    // 値の一覧のカテゴリ。`type` は書き込む葉の型（multi とモードを決める）。`valuesFn` は
    // 既定の qfValues(cat) の読み取りを上書きする（まとめたタグは作品／キャラの仲間を併合
    // する＝どれも同じ 'tag' の葉の型と1つの op を共有するので、チップも1つ）。
    const valuesCat =
      (qb: typeof postQB, opts: typeof POST_FACET_OPTS) =>
      (cat: string, label: string, type: string, showFind: boolean, extra?: { manage?: () => void; manageLabel?: string; valuesFn?: () => FilterRow[]; only?: FilterCatValues['only'] }): FilterCatValues => {
        const mo = modeFor(qb, opts)(type);
        return {
          cat,
          label,
          editor: 'values',
          showFind,
          multi: opts.multiValueTypes.includes(type),
          values: extra?.valuesFn ?? (() => (qfValues(cat) as FilterRow[]).map(dot)),
          pick: pick(cat),
          mode: mo.mode,
          setMode: mo.setMode,
          manage: extra?.manage,
          manageLabel: extra?.manageLabel,
          only: extra?.only,
        };
      };
    // まとめたタグのエディタの値。一般タグ（種別なし、件数順）の後に作品／キャラの群が
    // 続く＝全部で1つの 'tag' ファセットなので、チップも op も1つ。
    const combinedTagValues = (tagCat: string, workCat: string, charCat: string) => (): FilterRow[] => {
      const general = (qfValues(tagCat) as FilterRow[]).map(dot);
      const work = (qfValues(workCat) as FilterRow[]).map(dot);
      const char = (qfValues(charCat) as FilterRow[]).map(dot);
      const out: FilterRow[] = [];
      // 一般タグは平たく並ぶ。後ろに種別付きの群が続く時は、一般タグの一覧を自前の見出しの
      // 下にまとめ、2ペインが孤児にしないようにする（buildGroups は最初の ghead より前の行を
      // 捨てるため）。
      if ((work.length || char.length) && general.length && !general.some((it) => it.ghead != null)) out.push({ ghead: getMessage('tagUncategorized') });
      out.push(...general);
      if (work.length) out.push({ ghead: kindLabel('work') }, ...work);
      if (char.length) out.push({ ghead: kindLabel('character') }, ...char);
      return out;
    };
    if (store.getState().browseMode === 'posters') {
      const vc = valuesCat(posterQB, POSTER_FACET_OPTS);
      const cats: FilterCat[] = [vc('poster-platform', getMessage('sbPosterPlatformTitle'), 'platform', false), vc('poster-tag', getMessage('sbPosterTagsTitle'), 'tag', true, { valuesFn: combinedTagValues('poster-tag', 'poster-work', 'poster-character') })];
      // ここに manage() のフッタはもう無い（#6 の残り項目1）。投稿者フォルダは今や専用の
      // サイドバーの木を持つ（LeftSidebar、posterFolderStore/applyPosterFolderFilter）＝
      // 下のライブラリのフォルダの 'folder' ファセットに無いのと同じで、木そのものが管理画面。
      cats.push(vc('poster-folder', getMessage('sbPosterFoldersTitle'), 'folder', false));
      cats.push({
        cat: 'poster-date',
        label: getMessage('qfDate'),
        editor: 'date',
        dimOptions: [
          { value: 'latest', label: getMessage('posterDateLastPost') },
          { value: 'lastCapture', label: getMessage('posterDateLastCapture') },
          { value: 'authorCreatedAt', label: getMessage('posterDateCreated') },
        ],
        apply: ({ dateField, from, to }) => {
          if (!from && !to) return;
          posterQB.addFilter({ type: 'date', dateField, from, to }); // date は単値（置き換える）
        },
      });
      const selectedPlatforms = treeLeaves(posterQB.getTree()).filter((leaf) => leaf.type === 'platform' && !leaf.neg);
      if (selectedPlatforms.length === 1) {
        cats.push({
          cat: 'poster-followers',
          label: getMessage('detailFollowers'),
          editor: 'eng',
          typeOptions: [{ value: 'followers', label: getMessage('detailFollowers') }],
          opGte: getMessage('qfEngGte'),
          opLte: getMessage('qfEngLte'),
          apply: ({ min, op }) => {
            const n = Number(min);
            if (!(n >= 0)) return;
            posterQB.removeCondsMatching((leaf) => leaf.type === 'followers');
            posterQB.addFilter({ type: 'followers', platform: selectedPlatforms[0].value, min: n, op });
          },
        });
      }
      return cats;
    }
    // 投稿モード。
    const vc = valuesCat(postQB, POST_FACET_OPTS);
    const cats: FilterCat[] = [
      vc('kind', getMessage('fbCatKind'), 'kind', false),
      vc('platform', getMessage('qfSite'), 'platform', false),
      vc('postType', getMessage('qfPostType'), 'postType', false),
      vc('media', getMessage('qfMediaTitle'), 'media', false),
      vc('tag', getMessage('qfTag'), 'tag', true, { valuesFn: combinedTagValues('tag', 'work', 'character'), manage: () => tabsCtl.openTagManagementTab(), manageLabel: getMessage('ctxManageTags') }),
      vc('hashtag', getMessage('tabTags'), 'hashtag', true),
      vc('user', getMessage('sidebarAuthors'), 'user', true),
      // ここに「フォルダを管理…」は無い。今はサイドバーの木そのものが管理画面
      // （#41／確定 D）。下の投稿者側のファセットも今はこれと対称になった（#6 の残り項目1）＝
      // 専用のサイドバーの木（LeftSidebar）が投稿者フォルダの管理モーダルを置き換え、
      // モーダルは無くなった。
      vc('folder', getMessage('qfCatFolder'), 'folder', false, {
        // 「このフォルダのみ」はファセット全体に対するスイッチ1つで、値ごとには持たない。
        // チップはファセット単位なので、値ごとのフラグはそこから読み戻せないため。
        only: {
          get: () => treeLeaves(postQB.getTree()).some((c) => c.type === 'folder' && c.only),
          set: (v) => {
            for (const l of treeLeaves(postQB.getTree()).filter((c) => c.type === 'folder')) {
              if (v) l.only = true;
              else delete l.only;
            }
            postQB.refresh();
          },
        },
      }),
    ];
    cats.push({
      cat: 'date',
      label: getMessage('qfDate'),
      editor: 'date',
      dimOptions: [
        { value: 'date', label: getMessage('qfDatePost') },
        { value: 'capturedAt', label: getMessage('qfDateCaptured') },
      ],
      apply: ({ dateField, from, to }) => {
        if (!from && !to) return;
        addFilter({ type: 'date', dateField, from, to }); // date は単値（置き換える）
      },
    });
    cats.push({
      cat: 'engagement',
      label: getMessage('qfEngagement'),
      editor: 'eng',
      typeOptions: Object.entries(ENG_TYPE_LABELS).map(([value, label]) => ({ value, label })),
      opGte: getMessage('qfEngGte'),
      opLte: getMessage('qfEngLte'),
      apply: ({ engType, min, op }) => {
        const n = Number(min);
        if (!(n > 0)) return;
        removeCondsMatching((c) => c.type === 'engagement' && c.engType === engType); // 1つの型に gte と lte を同時に持たせない
        addFilter({ type: 'engagement', engType, min: n, op }); // 数値＝述語は p[engType] >= min を比べる
      },
    });
    // #162: 寸法・サイズのファセット。エディタは、その軸自身の表示単位（px、サイズなら MB）で
    // 素の数値を受け取る。apply() は葉を書く前に MB をバイト（DB と述語の単位＝query.ts の
    // makePostPredOf が mediaMaxBytes と直接比べる）へ換算する。さらに、上の反応が課している
    // 「1つの型に gte と lte を同時に持たせない」と同じ規則で、同じ軸の既存の葉は共存させずに
    // 置き換える。
    cats.push({
      cat: 'dimension',
      label: getMessage('qfDimension'),
      editor: 'dim',
      axisOptions: [
        { value: 'width', label: getMessage('qfDimWidth') },
        { value: 'height', label: getMessage('qfDimHeight') },
        { value: 'long', label: getMessage('qfDimLong') },
        { value: 'bytes', label: getMessage('qfDimBytes') },
      ],
      opGte: getMessage('qfEngGte'),
      opLte: getMessage('qfEngLte'),
      apply: ({ axis, value, op }) => {
        const n = Number(value);
        if (!(n > 0)) return;
        const raw = axis === 'bytes' ? Math.round(n * 1024 * 1024) : Math.round(n);
        removeCondsMatching((c) => c.type === 'dimension' && c.axis === axis);
        addFilter({ type: 'dimension', axis, value: raw, op });
      },
    });
    return cats;
  };

  // 有効な絞り込みのチップ（redesign §3-2 / P2③ タスク2）。クエリの木のファセットを、
  // facetViewOf から導いてファセット1つにつき1チップで出す（Linear 風）。`cat` は
  // filterCategories() の項目と対応していて、チップを押すとそのファセットのエディタが
  // 開き直す。否定された葉は型ごとにまとめて「〜でない」のチップにする（保留の判断、案 A）。
  // 木が変わるたびに計算し直す＝コンポーネントは postQueryTree/posterQueryTree の
  // ストアキーを購読している。
  activeFilters = function (): ActiveFilter[] {
    const posters = store.getState().browseMode === 'posters';
    const qb = posters ? posterQB : postQB;
    const opts = posters ? POSTER_FACET_OPTS : POST_FACET_OPTS;
    const labelOf = posters ? posterFilterLabel : filterLabel;
    // 葉の型 → { エディタのカテゴリ, チップのラベル, エディタの種別 }。
    const map: Record<string, { cat: string; label: string; editor: 'values' | 'date' | 'eng' | 'dim' }> = posters
      ? {
          platform: { cat: 'poster-platform', label: getMessage('sbPosterPlatformTitle'), editor: 'values' },
          tag: { cat: 'poster-tag', label: getMessage('sbPosterTagsTitle'), editor: 'values' },
          followers: { cat: 'poster-followers', label: getMessage('detailFollowers'), editor: 'eng' },
          folder: { cat: 'poster-folder', label: getMessage('sbPosterFoldersTitle'), editor: 'values' },
          date: { cat: 'poster-date', label: getMessage('qfDate'), editor: 'date' },
        }
      : {
          kind: { cat: 'kind', label: getMessage('fbCatKind'), editor: 'values' },
          platform: { cat: 'platform', label: getMessage('qfSite'), editor: 'values' },
          // #253: 対応外ドメインの行は 'domain' の葉を選ぶ。こちらにも独立したカテゴリは
          // 無く、そのチップは同じ「サイト」
          // （プラットフォーム）のエディタを開き直す。
          domain: { cat: 'platform', label: getMessage('qfSite'), editor: 'values' },
          postType: { cat: 'postType', label: getMessage('qfPostType'), editor: 'values' },
          media: { cat: 'media', label: getMessage('qfMediaTitle'), editor: 'values' },
          tag: { cat: 'tag', label: getMessage('qfTag'), editor: 'values' },
          hashtag: { cat: 'hashtag', label: getMessage('tabTags'), editor: 'values' },
          user: { cat: 'user', label: getMessage('sidebarAuthors'), editor: 'values' },
          folder: { cat: 'folder', label: getMessage('qfCatFolder'), editor: 'values' },
          date: { cat: 'date', label: getMessage('qfDate'), editor: 'date' },
          engagement: { cat: 'engagement', label: getMessage('qfEngagement'), editor: 'eng' },
          dimension: { cat: 'dimension', label: getMessage('qfDimension'), editor: 'dim' },
        };
    const view = facetViewOf(qb.getTree(), opts);
    if (!view) return []; // ファセットでない形で保存された木 → チップは出さない（読み取り専用で代わりに出す案は試行のため落とした）
    const out: ActiveFilter[] = [];
    const emit = (type: string, mode: FacetMode, leaves: HologramQueryLeaf[]) => {
      const m = map[type];
      if (!m) return; // 対応表に無い型はチップを持たない
      out.push({ cat: m.cat, type, label: m.label, editor: m.editor, mode, values: leaves.map((l) => labelOf(l)), remove: () => qb.removeByType(type) });
    };
    for (const cl of view.clusters) emit(cl.type, cl.op === 'and' ? 'and' : 'or', cl.leaves);
    for (const l of view.singles) {
      // 自由文の語（検索ボックスが確定させた葉。P2④）は、語1つにつきチップ1つ。
      // filterCategories に 'text' の項目は無い（編集するものが無い＝語そのものが値）ので、
      // チップの ✕ はその葉だけを消し、チップを押しても何も起きない。
      if (l.type === 'text') {
        out.push({ cat: 'text', type: 'text', label: labelOf(l), editor: 'values', mode: 'or', values: [labelOf(l)], remove: () => qb.removeNode(l) });
        continue;
      }
      emit(l.type, 'or', [l]);
    }
    const excl = new Map<string, HologramQueryLeaf[]>();
    for (const l of view.excl) {
      const arr = excl.get(l.type) ?? [];
      arr.push(l);
      excl.set(l.type, arr);
    }
    for (const [type, leaves] of excl) emit(type, 'exclude', leaves);
    return out;
  };

  // resetPosterFilters/renderPosters/hologramPosterGridSource.configure/
  // openPosterPosts/jumpToPoster/refreshPosterTagFields/refreshPosterFolderFields/
  // applyPosterTagChange/showPosterDetail は、すべて poster-grid-builder.ts へ移した。
  // resetPosterFilters はモジュールスコープの export 経由でしか読まれない
  // （Activebar.tsx が直接 import する）＝覆ってしまわないよう、上で分割代入せず
  // プロパティごとに代入する。
  resetPosterFilters = posterGrid.resetPosterFilters;
  // 投稿者カードの操作（#143 P2⑥）。素のクリックはその投稿者をインスペクタに出す
  // （単独＝インスペクタ。投稿カードと揃えてある）。ダブルクリックはその投稿者の投稿へ
  // 掘り下げる（下の dblclick）。ℹ と 🏷 のボタンはどちらも撤去した＝インスペクタは
  // シングルクリックの行き先で、タグ付けはそのインラインの欄。右クリックメニューの
  // 「タグを編集」から着く（P2⑦）。
  // 投稿カードが得たのと同じ「委譲ではなく props」の形（#618）＝投稿者のセルが自分の
  // 投稿者を返すので、DOM から `data-index` を読み取るものは無い。
  // posterMenuItems/onPosterMenuPick/showPosterMenu は poster-grid-builder.ts へ移した＝
  // 上で posterGrid から showPosterMenu を分割代入している。
  hologramPosterGridSource.configureActions({
    onClick: (u: HologramUserAgg) => showPosterDetail(u),
    // 投稿者をダブルクリック → その投稿者の投稿へ掘り下げる（投稿モード＋user の
    // 絞り込み）。掘り下げは #143 が確定させたダブルクリックの割り当て（#24 の旧
    // 「単独＝切り替え」を上書きする）。
    onDoubleClick: (u: HologramUserAgg) => openPosterPosts(u),
    onContextMenu: (u: HologramUserAgg, e) => {
      e.preventDefault();
      showPosterMenu(u, e.clientX, e.clientY);
    },
  });
  // 投稿者モードの並び順。唯一の情報源は hologramStore の 'sortPoster'（表示ポップオーバーの
  // Select が選択時に書く）。変化したら描画し直す＝きっかけは1つで、情報源が二重にならない。
  subscribeKey('sortPoster', () => {
    if (tabsCtl.isRestoring()) return; // ストアを書いたのは applyEntry/initTabs＝あちらが自分で描画を走らせる
    // 並び順の変更は push ではなく、今の履歴のエントリを書き換える（#144 確定（保留項目2））。
    tabsCtl.setNavReplaceNext();
    renderPosters();
  });
  // 投稿者のクエリのリセット（バーの右側の「リセット」）。投稿者の木と、共有の検索ボックスを
  // 空にする。これを呼ぶボタンは絞り込みバーのもので、resetPosterFilters を直接 import する。

  // 集まりは今は閲覧のビューではなく、サイドバーのフォルダ一覧（renderCollectionSidebar）。
  // 旧来の3つ目のモードのグリッド、その右クリックメニュー、動的な集まり（保存した検索）は
  // 2026-07-04 に削除した＝上の集まりのサイドバーを参照。

  // Ctrl+- / Ctrl+= はコンテンツのサイズを1段ずつ動かす（投稿側の密度、または投稿者グリッド）。
  // 登録は GlobalShortcuts コンポーネント（app/App.tsx）にあり、そちらがこれを直接 import する。
  handleShortcutSizeKey = gridDensity.handleShortcutSizeKey;
  handleZoomWheel = gridDensity.handleZoomWheel;
  // 表示ポップオーバー向けのサイズスライダーの束縛（P2②）＝上の export の宣言を参照。
  getPostSizeTrack = gridDensity.computeSizeTrack;
  applyPostSize = gridDensity.setSizeFromSlider;
  getPosterSizeTrack = gridDensity.computePosterSizeTrack;
  applyPosterSize = gridDensity.setPosterSizeFromSlider;

  // reloadPosts/setSkipDeleteConfirm/confirmClearAll は、React の設定コンポーネント
  // （Danger.tsx/Data.tsx/settings/ipc.ts）が届くよう、以前は旧共有ブリッジを経由して
  // 渡していた。今はそれらが上の live binding を直接 import する。

  // 保存した表示の形と skipDeleteConfirm を読み込む
  hologramIpc.getPrefs().then((prefs) => {
    gridDensity.restorePrefs(prefs);
    postGrid.restoreSkipDeleteConfirm(!!prefs.skipDeleteConfirm);
    // 保存した表示を適用した後に1回だけ描画し直す。並び順はここでは読まない＝そちらは
    // タブの状態から来る（initTabs が適用する）ので、読み込み時に競合しない。
    renderPosts();
  });

  // --- 検索の値の供給元 --------------------------------------------------------
  // hologramStore の 'searchQuery' が検索の値そのもので、searchbox コンポーネントが
  // Base UI の Autocomplete の制御された入力として描く。クエリの木のテキストの葉の状態機械
  // （search-editing.ts）、候補の選択を searchbox コンポーネントへつなぐブリッジ
  // （searchbox.ts）、その周りのストアの配線とデバウンスした描画のやり直しは、今は
  // search-box-builder.ts でまとめて結んでいる（viewer.ts decomposition の一部）。
  // searchEditing 自体はここのローカルな const のまま＝上の resetAllFilters と、postQB の
  // onLeafMutated/isEditingLeaf の依存が、今もこれを直接参照している。
  const searchBox = makeSearchBox({
    getTree: () => postQB.getTree(),
    addFilter: (f) => postQB.addFilter(f),
    removeNode: (n) => postQB.removeNode(n),
    treeLeaves,
    afterQueryChange: () => afterQueryChange(),
    renderPosts: () => renderPosts(),
    renderPosters: () => renderPosters(),
  });
  const { searchQuery, setSearchBoxValue, rebindEditingTextLeaf, searchEditing } = searchBox;
  // subscribe() の登録は React が持ち（StoreSubscriptions、App.tsx）、これを直接
  // import する。ここに残るのは防ぎと操作のロジック。handleShortcutSearchFocusKey の
  // 登録は GlobalShortcuts（App.tsx）にあり＝そちらも直接 import する。どちらも同じ
  // makeSearchBox() の生成場所から出てくるので、あそこで結んでいる。
  handleSearchQueryStoreChange = searchBox.handleSearchQueryStoreChange;
  handleShortcutSearchFocusKey = searchBox.handleShortcutSearchFocusKey;

  // --- コマンドパレット（#28） ---------------------------------------------------
  // パレットの項目をコマンドの登録簿へ登録する。上の searchbox の結線の後に置いてあるのは、
  // コーパス提供側の選択が同じブリッジに乗るから（1回の選択で両方の面が動く）。あちらは
  // ハンドラを遅延して引くが、供給側をその使い手が出来た後に登録しておく方が、読む順序として
  // 正直になる。項目が必要とするものはすべてここのスコープにあるので、perform() は別の
  // ブリッジではなく本物の関数を閉じ込めた閉包になる。
  makeCommands({
    t: (key) => getMessage(key),
    allPosts: () => postGrid.getAllPosts(),
    buildUsers,
    // 行き先になれるのは静的なフォルダだけ（保存した検索はクエリの置き換えを意味する＝別の操作）。
    listFolders: () => folders.staticFolders(),
    folderPath: (id) => folders.pathOf(id),
    addTab: () => tabsCtl.addTab(),
    openTagManagementTab: () => tabsCtl.openTagManagementTab(),
    openHistoryEntry: (e) => tabsCtl.openHistoryEntry(e),
    switchTab: (id) => tabsCtl.switchTab(id),
    resetAllFilters: () => resetAllFilters(),
    resetPosterFilters: () => resetPosterFilters(),
    browseTo: (mode) => browseTo(mode),
    openFolder: (id) => openFolder(id),
    // 投稿者ビューの語彙。タグは一般タグと作品／キャラを1つに畳む（クエリの上ではどれも
    // 同じ 'tag' の葉＝種別は「絞り込みを追加」の一覧を分けるためだけに使う）。
    posterTagRows: () => (['poster-tag', 'poster-work', 'poster-character'] as const).flatMap((cat) => (qfValues(cat) as FilterRow[]).map((r) => ({ value: String(r.v), count: Number(r.count) || 0 }))),
    posterFolderRows: () => (qfValues('poster-folder') as FilterRow[]).map((r) => ({ id: String(r.v), name: String(r.l ?? r.v) })),
    posterAddFilter: (filter) => posterQB.addFilter(filter),
  });

  // --- 全文検索（#29） -----------------------------------------------------------
  // パレットの「本文を検索」モードは、このブリッジ経由でライブラリを読み、そこへ飛ぶ
  // （services/fulltext.ts の遅延 pull の登録で、searchbox.ts の handlers()/init() と同じ形＝
  // CommandPalette.tsx はこの結線が走るより前に載る）。
  // 「飛ぶ」はそのテキストの葉だけに絞った新しいタブを開き（tabsCtl.openTextSearchTab＝
  // 今のタブには一切触れない。#29 の設計と受け入れ条件）、当たった1件をインスペクタに出す。
  // openTextSearchTab の applyState() が新しいタブを同期に描画する（post-grid-builder の
  // renderPosts も 'postGroups' を同期に push する）ので、ここが読み戻す時点では、
  // グループ化し直した集合が既にストアに入っている。
  initFullTextBridge({
    allPosts: () => postGrid.getAllPosts(),
    fileSrc,
    openResult: (query, captureId) => {
      tabsCtl.openTextSearchTab(query);
      const groups = store.getState().postGroups;
      const g = groups?.find((gr) => gr.records.some((r) => r.captureId === captureId));
      if (g) showDetail(g);
    },
  });

  // #148 のチップ帯のインライン入力の確定口＝今画面に出ているビューの絞り込みへ条件を1つ
  // 足す。要点は、検索ボックスの選択（searchEditing.pick）を通らないこと。あちらは入力欄を
  // 空にし、書きかけの本文の語も捨てる。「打ったものは絞り込みを探すためだけのものだった」
  // という前提に立っているから。チップ帯の入力欄は全文検索の欄ではないので、それに巻き込まれて
  // はいけない。
  addFilterToCurrentView = (filter) => (store.getState().browseMode === 'posters' ? posterQB.addFilter(filter) : addFilter(filter));

  // 表示ポップオーバーの並び順の Select がこれを呼ぶ。並び順はタブの状態にある
  // （renderPosts→永続化 の経路でタブごとに保存する）。別のグローバルな設定にはしていない＝
  // 二重に持つと読み込み時に競合したため。並び順の変更は push ではなく、今の履歴のエントリを
  // 書き換える（#144 確定（保留項目2））。まだ種が無い状態で 'random' を選ぶと種を作るので、
  // 最初の選択で既にシャッフルされる（#118）。既にある種はそのまま残す。だから random を
  // 離れて戻ってきても、利用者が振り直すまでは同じ順序が出る。
  setPostSort = (v: string) => {
    if (v === sortValue()) return;
    store.setState({ sortPost: v });
    if (v === 'random' && !store.getState().shuffleSeed) store.setState({ shuffleSeed: newShuffleSeed() });
    tabsCtl.setNavReplaceNext();
    renderPosts();
  };
  rerollShuffle = () => {
    store.setState({ shuffleSeed: newShuffleSeed() });
    tabsCtl.setNavReplaceNext();
    renderPosts();
  };

  // ZIP からの取り込みは今は services/zip-import.ts にある＝呼び出し側2つ（設定パネルの
  // ボタン、空状態の CTA）が、そこから runZipImport を直接 import する。

  // エクスポート通知のレールは LibrarySafetyStatus が完全に持つ。orchestrator は
  // その状態を持たない。

  // --- データの消去 ---
  // ライブラリ全体を壊す操作は、OK ボタンを有効にするためにキーワード（t('deleteKeyword')）の
  // 入力を求める＝viewer.ts decomposition の中で post-grid-builder.ts の confirmClearAll へ
  // 移した。postGrid.resetAll()/markPostsMutated() が元からそこにあるため。React の Danger の
  // 節は今、旧共有ブリッジを通さずに confirmClearAll の live binding を直接 import する。

  // --- 補助の関数 ---
  // 件数・日付の整形（formatCount / formatDate / compactDate / …）は今は format.js に
  // ある。escapeHtml/escapeAttr はここから呼ぶ側がもう無い＝残っている HTML の組み立ては
  // JSX（自動で escape する。L2013 を参照）。ui.ts の escapeHtml は、folders.ts 自身の
  // モーダルのマークアップが今も直接使っている。
  // トースト（notify）の呼び出しは、今は ui.ts の export へ直接行く＝ローカルのラッパーは無い。

  // 共有フォルダの変更。どの変更でもチップを更新し、フォルダの一覧や既定が変わった時は
  // カード（📁 の状態）も描き直す。登録は React 側にあり（StoreSubscriptions、App.tsx）、
  // これを直接 import する（CF().onChange には購読の解除が無い＝subs.push なので、あちらの
  // effect に後片付けは無い。App.tsx 階層の他の effect と同じくアプリの一生に1回しか載らない
  // ので害は無い）。ここに残るのは防ぎと操作のロジック。
  handleFolderChange = function (kind?: string) {
    // 今絞り込みに使っているフォルダが削除されたら、その絞り込みを外す（一覧が理由も
    // 分からず空になるのを防ぐ）。
    const dangling = (c: HologramQueryLeaf) => c.type === 'folder' && !CF().byId(c.value);
    // 描き直しは syncShadow が全部やる。刈り込んだ木をストアへ押し込み、チップと
    // サイドバーの印はそれを読む。
    if (postQB.removeCondsMatching(dangling)) postQB.syncShadow();
    const activeFolderId = store.getState().activeFolderId;
    if (activeFolderId && !CF().byId(activeFolderId)) store.setState({ activeFolderId: null });
    // folder の葉は3か所にあり、そのうち一部にしか届かない削除は、問題になる日まで
    // 見えない。生きている木（上）、保存した検索（folders.ts が削除時に自分の分を掃く）、
    // そして他のタブの保存された状態（ここ）。まだ誰も切り替えていないタブは自分の木を
    // メモリに持ったままなので、削除済みのフォルダを名指しする葉はそこに残り続け、タブを
    // 開いた時にゼロ件を返す。しかも画面には理由が何も出ない。カスケード削除（#41）は、
    // 1回のクリックで部分木ごと畳めるので、その確率を上げる。
    if (kind === 'list') {
      const activeId = tabsCtl.getActiveTabId();
      let swept = false;
      for (const t of tabsCtl.getTabs()) {
        if (t.id === activeId) continue; // 上の生きている木が、このタブの状態そのもの
        const st = t.state as { tree?: HologramQueryGroup; f?: HologramQueryLeaf[] } | undefined;
        if (!st) continue;
        if (st.tree && removeCondsMatchingIn(st.tree, dangling)) swept = true;
        // タイトルの影は葉の別の複製なので、放っておくとタブは、もう無いフォルダから
        // 取った名前を持ち続ける。
        if (Array.isArray(st.f) && st.f.some(dangling)) {
          st.f = st.f.filter((c) => !dangling(c));
          swept = true;
        }
      }
      if (swept) tabsCtl.persistTabsNow();
    }
    // サイドバーの集まりの状態（件数と選択状態）は、services/sidebar.ts の
    // hologramFolders.onChange の購読から自分で導く。
    if (kind === 'list') renderPosts(true); // フォルダの作成・削除＝アニメーション無しで更新する
  };
  // 取込キューが変わった時の背面での更新。登録は React 側にあり（StoreSubscriptions、
  // App.tsx）、これを直接 import する（posts.ts の onPostsChanged にも購読の解除が無い＝
  // 同じ理屈）。
  handlePostsChanged = async function () {
    await loadPosts(true);
  };

  // --- 起動。アプリの最初のデータ読み込みと初回描画。ここで定義するのは上のすべての
  // 関数と状態を閉包に取り込む必要があるためだが、自己実行はしない＝React の AppBoot
  // （App.tsx）が、上の viewerReady を待ってから載せる時に1回だけ呼ぶ。これで React の根が
  // アプリ起動の唯一のきっかけになる（いつ動かすかは React が持ち、何をするかの
  // オーケストレーションのロジックは orchestrator.ts が持つ）。orchestrator.ts が React の
  // マウントと並行して自分で起動する形にはしていない。
  bootApp = async function () {
    if (CF()) await CF().load(); // 📁 とチップが正しくなるよう、初回描画の前にフォルダを読み込む
    // グループ化の永続化（旧画像ビューと共有）＝手動のグループと、その適用除外。
    postGrid.setUngrouped(await loadUngrouped());
    await pfStore.load();
    await aliases.load(); // #23 St1: 投稿者の名前統合の群＝buildUsers が正しく畳めるよう初回描画の前に
    postGrid.setManualGroups(await loadManualGroups());
    await loadTags();
    // ここにサイドバーへ種を入れる呼び出しは要らない＝services/sidebar.ts の source は
    // 最初の get() で自分のモデルを計算するので、両方の列は既に読み込まれているもので
    // すぐ描かれ、データが流れ込むにつれて印と開閉を拾っていく。
    // initTabs は永続化したタブごとの履歴を引き取り、今のタブのビューの状態を復元する
    // （モードも含む＝#144: 決めるのは今のエントリで、旧 browseMode の設定は撤去した）。
    // 続く loadPosts が、そのモードで初回の描画を走らせる。どちらも記録しないままにする
    // （markBooted はその後）ので、起動時の描画のやり直しが、引き取った履歴の上に
    // 積み上がることはない。
    await tabsCtl.initTabs();
    await loadPosts();
    // ナビのゴミ箱の印（#268）は .trash/ の件数なので、起動時に1回読む必要がある。以降の
    // 変化はどれも削除／復元／空にする操作を通り、そちらが自分で更新する。await していない＝
    // 下のどれもこれに依存しておらず、印が1拍遅れて出ても見えないため。
    trashRefresh();
    // 復元した image のエントリは、ライブラリが読み込まれた今になってようやく captureId を
    // 解決できる＝ここで、グリッドの上に詳細のビューへ入る。
    {
      const cur = nav.current();
      if (cur && cur.kind === 'image') {
        const st = cur.state as { recs: string[]; idx: number };
        imageTabCtl.showImageView(st.recs, st.idx);
      }
      // 生きた件数から導くグリッドのタブのタイトル（allPostsCount。すぐ上のライブラリの
      // 読み込みで設定済み）は、自動で Tabs の source へ届く＝ここから押し込む必要は無い。
    }
    tabsCtl.markBooted(); // 保存したビューを適用し終えた＝記録は利用者の最初の操作から始まる
    // 初回の描画が済んだ＝今のタブのスクロール位置を戻す（再起動をまたいで残る）。
    tabsCtl.restoreTabView(getTabs().find((t) => t.id === getActiveTabId()));
    // 状態やタブの切り替えだけでなく、スクロールの変化も（デバウンスして）永続化する。
    // そうすれば、再起動時に覚えている位置が最新になる。persistTabsDebounced が scrollY を
    // 取り込む。
    let _scrollPersistTimer: any = null;
    const _contentScroller = contentScrollEl();
    if (_contentScroller)
      _contentScroller.addEventListener(
        'scroll',
        () => {
          clearTimeout(_scrollPersistTimer);
          _scrollPersistTimer = setTimeout(persistTabsDebounced, 400);
        },
        { passive: true },
      );
    // ウィンドウが消える時に、デバウンス中のタブの状態を書き出す。そうしないと 800ms の
    // 永続化のデバウンス（と上の 400ms のスクロールの前段のデバウンス）のせいで、終了の
    // 約1.2秒前までに加えた変更が落ちる。ここ＝上のタブの復元の後＝で登録するので、早すぎる
    // クローズが tabs.json を既定値で上書きすることはない。set-tabs は main の中で同期に
    // 書くので、荷物はレンダラーが畳まれる前に IPC のキューへ届きさえすればよい。
    window.addEventListener('pagehide', tabsCtl.persistTabsNow);
  };
  resolveViewerReady();
})();
