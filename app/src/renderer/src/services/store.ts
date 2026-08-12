// レンダラーの共有の状態＝React のコンポーネントと、命令的な service の層
// （orchestrator.ts と *-builder.ts のモジュール群）が、共通して持つ状態を読み書きする
// 唯一の場所。
//
// Zustand の vanilla ストア（#1054）。以前は手書きのキー引きの `Record<string, any>` で、
// 移行の最中に viewer.js（素の JS）と React が唯一の正本を共有しなければならなかった時に
// 作ったもの。その前提は無くなった（viewer.js は #156 で撤去した）が、分かれていること自体は
// 残る。ここに書き込む側の半分はコンポーネントではなく素のモジュールなので、状態は本当に
// React の外に置くしかない。zustand/vanilla はまさにそのためのもの＝モジュールの側からは
// `store.getState()` / `store.setState()` / `store.subscribe()`、React の中では
// `useStore(store, selector)`。
//
// 手書きの版が払っていた代償と、下の型が取り戻すもの:
//   - キーは30ファイルにまたがる自由な文字列だった。打ち間違えると `undefined` として読まれ、
//     コンポーネントは代わりの表示を、いつまでも出し続けた。
//   - 読み取りのたびに型と既定値を書き直していた。`storeGet('gridSize') || 280` が同じ
//     マジックナンバーのまま3ファイルに現れていた。初期値は今はここに1回だけあるので、
//     読み取りはただの `.gridSize`。
//   - `setMany` があったのは、`set` を2回呼ぶと通知が2回走り、両方のキーを購読している側が
//     その間の裂けた状態を見てしまうから（#871＝'postGroups' と、1つ前の組み立ての
//     'postSections' の組み合わせ）。setState は部分的なオブジェクトを受け取って1回だけ
//     通知するので、その危険は「まとめる呼び出しを忘れずに使う」ではなく、作りによって
//     消えている。
//
// subscribeWithSelector が、命令的な層の頼りにしているキーごとの購読を支える＝
// `store.subscribe(s => s.postGroups, cb)` はその一部分が実際に変わった時にだけ発火するので、
// 同じ値を書き込んでも購読側には何の負担も無い。
import { createStore } from 'zustand/vanilla';
import { subscribeWithSelector } from 'zustand/middleware';
import { shallow } from 'zustand/shallow';

/** コンテンツ領域が何を出しているか。ゲートは normalizeBrowseMode（orchestrator.ts）。 */
export type HologramBrowseMode = 'posts' | 'posters' | 'timeline' | 'trash';
/** 投稿グリッドと投稿者グリッドが共有する密度の軸。 */
export type HologramDensityLayout = 'grid' | 'list';

/** 画像ビューの身元＝属するタブ、そのレコード、そのどこにいるか。 */
export interface HologramActiveImageTab {
  id: string;
  recs: string[];
  idx: number;
}

export interface HologramStoreState {
  // --- 何を閲覧しているか -----------------------------------------------------
  browseMode: HologramBrowseMode;
  /** null なら画像ビューは出ていない＝コンテンツ列はグリッドのもの。 */
  activeImageTab: HologramActiveImageTab | null;
  /** インスペクタに出しているカードのキー。何も出していなければ null。 */
  inspectedKey: string | null;
  selectedSet: ReadonlySet<string>;
  searchQuery: string;
  /** ライブラリの現在地。null はライブラリ全体を見ている。 */
  activeFolderId: string | null;

  // --- タブと移動 -------------------------------------------------------------
  tabs: HologramTab[];
  activeTabId: string | null;
  navCanBack: boolean;
  navCanForward: boolean;

  // --- 今のクエリ -------------------------------------------------------------
  // クエリビルダーが木を一度も公開していない間は undefined。
  postQueryTree: HologramQueryGroup | undefined;
  posterQueryTree: HologramQueryGroup | undefined;
  multiOnly: boolean;
  sortPost: string;
  sortPoster: string;
  /** 空文字列ならシャッフルは効いていない。並び順が 'random' になった時に種を作る。 */
  shuffleSeed: string;

  // --- 組み上げたビューのモデル -----------------------------------------------
  // postGroups が undefined と null を区別しているのは意図してのことで、それを気にする
  // 読み手は services/library-status.ts。undefined は renderPosts() が一度も走っていない
  // （まだ読み込み中＝LibraryLoading が受け持つ）。null は走った結果、何も出なかった
  // （空だと確定した＝EmptyState が受け持つ）。2つを畳むと、読み込み中に「ライブラリが
  // 空です」を出してしまう。
  postGroups: HologramPostGroup[] | null | undefined;
  /** #47: postGroups の中の月セクションの範囲。並び順に日付の軸が無ければ null。 */
  postSections: HologramDateSection[] | null;
  /** ここに null の番兵は無い＝renderPosters() が一度でも走れば、必ず配列になる。 */
  posterGroups: HologramUserAgg[] | undefined;
  trashGroups: HologramPostGroup[] | null;

  // --- 表示の軸（起動時に設定から写し、その後は利用者が動かす） ---------------
  layout: HologramDensityLayout;
  squareThumbs: boolean;
  showInfo: boolean;
  showAvatar: boolean;
  gridSize: number;
  listThumb: number;
  posterLayout: HologramDensityLayout;
  posterShowInfo: boolean;
  posterGridSize: number;

  // --- ライブラリの状態 -------------------------------------------------------
  libraryLoaded: boolean;
  libraryMissing: boolean;
  libraryMissingPath: string | null;
  /** #71: 拡張機能が Native Messaging ブリッジと一度でも話したか。起動時に1回だけ入れる。 */
  extensionContacted: boolean;
  allPostsCount: number;
  allUsersCount: number;
}

// 読み取り側がかつて手元に持っていた既定値。そのうち2つは空の値ではなく、意味を担う数値＝
// 280（投稿カードの幅）と 88（一覧の行のサムネイル）は読み手ごとに書かれていたので、変更する
// たびに全部を探し出す必要があった。
const INITIAL: HologramStoreState = {
  browseMode: 'posts',
  activeImageTab: null,
  inspectedKey: null,
  selectedSet: new Set<string>(),
  searchQuery: '',
  activeFolderId: null,

  tabs: [],
  activeTabId: null,
  navCanBack: false,
  navCanForward: false,

  postQueryTree: undefined,
  posterQueryTree: undefined,
  multiOnly: false,
  sortPost: 'date-desc',
  sortPoster: 'count',
  shuffleSeed: '',

  postGroups: undefined,
  postSections: null,
  posterGroups: undefined,
  trashGroups: null,

  layout: 'grid',
  squareThumbs: false,
  showInfo: true,
  showAvatar: true,
  gridSize: 280,
  listThumb: 88,
  posterLayout: 'grid',
  posterShowInfo: true,
  posterGridSize: 200,

  libraryLoaded: false,
  libraryMissing: false,
  libraryMissingPath: null,
  extensionContacted: false,
  allPostsCount: 0,
  allUsersCount: 0,
};

export const store = createStore<HologramStoreState>()(subscribeWithSelector(() => INITIAL));

/**
 * キー1つを購読する。この薄いラッパーがあるのは、命令的な層が名前で購読する（キーの一覧を
 * 回すことも多い）ためで、呼び出し側ごとにセレクタを書くと読みにくくなる。
 */
export function subscribeKey<K extends keyof HologramStoreState>(key: K, cb: () => void): HologramUnsubscribe {
  return store.subscribe((s) => s[key], cb);
}

/**
 * 複数のキーを1つのコールバックで購読する。1回の書き込みで動かしたキーが何個であっても、
 * 発火は多くても1回。呼ぶのは、十数個の入力からビューのモデルを丸ごと組み直す命令的な
 * モジュール（services/grid.ts、services/tabs.ts）。
 *
 * キーごとに1つずつではなく、キーの組に対して購読を1つ張る。別々に n 個張ると、そのうち
 * n 個に触れる書き込みでコールバックが n 回呼ばれる。それは #871 を裏側から繰り返すことに
 * なる＝読み手がキーごとにモデルを組み直し、途中の結果を配ってしまう。（#1054 を書いている
 * 最中に store-batch.test.ts が、まさにそこで検査している倍の回数で捕まえた。）
 */
export function subscribeKeys(keys: readonly (keyof HologramStoreState)[], cb: () => void): HologramUnsubscribe {
  return store.subscribe((s) => keys.map((k) => s[k]), cb, { equalityFn: shallow });
}
