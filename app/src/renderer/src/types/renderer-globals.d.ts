// レンダラーの service 層（query/records/facets/cooc/users/tab-state/viewer と store。
// すべて .ts で strict の検査下にある）が使う Window グローバルの契約。
// これはグローバルなスクリプトの d.ts（import も export も無い）なので、取り込んだ
// ファイルすべてでインターフェースが Window にマージされる。2026-07-09 の時点で、
// このプロジェクトは strict なレンダラーの TS プログラム1本（app/tsconfig.web.json）
// にまとめてある＝React コンポーネントを型検査するのと同じプログラム（以前は別に、
// もっと緩い tsconfig.renderer.json があった）。
//
// 型付けの高度: 関数の面には型を付ける。ドメインの中身（サイドカーの投稿レコード、
// 集計の行）は、JSON の層そのものに型が付くまで開いたオブジェクトのまま
// （`HologramPost` は添字シグネチャ）＝このディレクトリのもう1つの globals.d.ts と
// 同じ実利の取り方。

// 二重に export する service（records/tags/users/tab-state/undo/…）は、api を CommonJS
// 経由でも公開する＝`if (typeof module !== 'undefined' && module.exports) module.exports =
// api`。純粋な単体テストが require() できるようにするため。この参照は実行時に番人を
// 通しているので、strict な .ts（このプロジェクトに @types/node は入っていない）が
// 受け付けるようアンビエント宣言を置く。ブラウザ向けのバンドルでは undefined で、
// window.* への代入だけが走る。
declare const module: any;

// ---- サイドカーの投稿レコード（開いた形＝欄はキャプチャの JSON から入ってくる） ----
type HologramPost = { [k: string]: any };

// ---- renderer/query.js＝条件木の仕組みと、投稿側の述語 ----
// 木は常に根がグループ（op は既定で 'and'）。葉は {kind:'cond', type, value, …}。
// グループは子と、任意の neg を持つ。
interface HologramQueryLeaf {
  kind: 'cond';
  type: string;
  [k: string]: any;
}
interface HologramQueryGroup {
  kind: 'group';
  op: 'and' | 'or';
  neg: boolean;
  children: HologramQueryNode[];
}
type HologramQueryNode = HologramQueryLeaf | HologramQueryGroup;

// ファセットのドメイン（改訂④・ファセットのチップ）: UI が組み立てるのはファセットの
// CNF の木だけ。opts はビューが持つ型のスキーマ（多値の型か、単独の型か）。
interface HologramFacetOpts {
  multiValueTypes?: string[];
  standaloneTypes?: string[];
}
interface HologramFacetCluster {
  type: string;
  op: 'and' | 'or';
  leaves: HologramQueryLeaf[];
  grouped: boolean;
}
interface HologramFacetView {
  clusters: HologramFacetCluster[];
  singles: HologramQueryLeaf[];
  excl: HologramQueryLeaf[];
}

// query.ts 自身の API の面（emptyTree/evalNode/makePostPredOf など）は今や本物の ES
// モジュール＝名前付き export が自分で型を持つので、Window の形をしたアンビエントの
// インターフェースはここにもう宣言していない。

// ---- services/records.ts＝レコードの形を扱う補助とグループ化。今は本物の ES
// モジュール（名前付き export）で、ここに残るのは HologramPostGroup のデータ形だけ
// （viewer.ts / selection.ts / image-tab.ts と共有する）。 ----
interface HologramPostGroup {
  key: string;
  records: HologramPost[];
  rep: HologramPost;
  files: string[];
  [k: string]: any;
}

// ---- services/date-sections.ts＝月ごとのセクション分け（#47）。本物の ES モジュール
// で、アンビエントに共有するのは表示できる状態まで整えた形だけ（date-sections.ts 自身
// は計算しないロケール依存の `label` を post-grid-builder.ts が足す）＝上の
// HologramPostGroup と同じ分担。hologramStore の 'postSections' キーへ push する
// （services/grid.ts がそれを読んでグリッドのモデルに載せる。日付ジャンプのレールの
// コンポーネントは直接読む）＝今の並び順に日付の軸が無いとき（dateFieldForSort）か、
// グリッドが空のときは null。 ----
interface HologramDateSection {
  key: string;
  ms: number;
  label: string;
  startIndex: number;
  count: number;
}

// ---- services/selection.ts＝post グリッドの複数選択の Set と、Shift の範囲選択の
// 起点。hologramStore の 'selectedSet' キーがそのまま状態になる（クロージャに写しを
// 持たない）。起点はモジュールの私有変数（購読者がいない）。今は本物の ES モジュール
// （名前付き export）で、Window の形をしたアンビエントのインターフェースは要らない。 ----

// ---- services/facets.ts＝ファセットの件数と、値のフライアウトの行のモデル。makeFacets
// （facets.ts）と makeCooc（cooc.ts）は今や本物の ES モジュール（名前付き export）で、
// ここに残るのはモジュールをまたぐフライアウトの行の形として HologramQfRow だけ。 ----
interface HologramQfRow {
  v?: string;
  l?: string;
  on?: boolean;
  count?: number;
  [k: string]: any;
}

// ---- services/tags.ts＝タグの語彙と種別のドメイン。今は本物の ES モジュール
// （名前付き export）で、読み取り側の導出とディスクとの往復は自分で型を持つので、
// Window の形をしたアンビエントのインターフェースはここにもう宣言していない。
//
// 例外は HologramTagEntry で、読み取り側が持ち回る形のタグの実体1件（#810/#774）＝
// `name` は選択時にクエリの葉へ書き込む値、`label` は行が見せる値（同じ名前の実体2つ
// は、表示上の親でしか区別が付かない。「alice(東方)」）、`id` は一致判定のキー。
// これがアンビエントなのは、facets.ts と query.ts の両方がこれを話すのに、どちらも
// tags.ts をインポートしないから（query.ts は結合を一切持たない＝すべては注入された
// 依存を通してそこへ届く）。`id` が null になるのは、レコードの id が手に入らず、
// 読み取り側が名前での一致に退避する劣化した経路だけ。 ----
interface HologramTagEntry {
  id: number | null;
  name: string;
  label: string;
}

// ---- services/users.ts＝投稿者の集約と、検索ボックスの候補。今は本物の ES モジュール
// （名前付き export）で、Window の形をしたアンビエントのインターフェースは要らない。
// ただし HologramUserAgg は残る（listing.ts / sidebar.ts と共有するデータ形）。 ----
interface HologramUserAgg {
  key: string;
  platform: string;
  screenName: string;
  displayName: string;
  avatarFile: string;
  followers: number | null;
  authorCreatedAt: string;
  instance: string;
  latest: string;
  firstPost: string;
  lastCapture: string;
  firstCapture: string;
  count: number;
  // #23 St1（名寄せ）: この集約がまとめている posterKey すべて（グループ化されて
  // いなければこの投稿者自身のキー1つ＝buildUsers の2周目、services/users.ts）と、
  // それらにまたがる platform/instance の和。posterPredOf の platform/instance の葉は
  // 上の単数形の欄ではなくこちらに対して一致を見るので、2つのプラットフォームから
  // 名寄せした投稿者はどちらでも見つかる。
  members: string[];
  platforms: string[];
  instances: string[];
}
// ---- services/tab-state.ts＝タブの題名と、移動の履歴と、tabs.json の形。今は本物の
// ES モジュール（名前付き export）で、ここに残るのは HologramTabSnapshot /
// HologramTab のデータ形だけ（viewer.ts / tabs.ts / image-tab.ts と共有する）。 ----
interface HologramTabSnapshot {
  f?: Array<{ type: string; [k: string]: any }>;
  search?: string;
  multi?: boolean;
  [k: string]: any;
}
// タブごとの履歴のエントリ1件（#144）: 3つのビューの種類にまたがるタグ付き合併型。
// `u` は擬似 URL＝表示用のラベルと同定のキー（全体の履歴のページはここから行を導く）。
// 復元の契約では決してない（正本は state で、u はそこから導かれる）。
interface HologramNavEntry {
  u: string;
  kind: 'posts' | 'posters' | 'image' | 'timeline';
  state: HologramTabSnapshot | { tree?: any; sort?: string; search?: string } | { recs: string[]; idx: number };
}
interface HologramTab {
  // #21: 閲覧のビューではなく、タグ管理のページ専用のタブ（openTagManagementTab で
  // 開く。tabs-builder.ts）。この種のタブはクエリの状態も移動の履歴も持たない＝
  // 切り替え・閉じる・複製のどの経路も、postQB/browseMode/nav に触る前にこのフラグで
  // 打ち切る（意図して足すだけにとどめた＝既存の posts/posters/image の振り分けに
  // 対する危険が無い）。
  specialKind?: 'tags';
  id: string;
  pinned: boolean;
  title: string | null;
  state: HologramTabSnapshot | null;
  _scrollTop?: number;
  // タブごとの戻る／進むのスタック（要素はそれぞれ HologramNavEntry を JSON 化した
  // もの）＝切り替えをまたいでタブのオブジェクトに載って回り、tabs.json にも永続化
  // される（#144 の未決点5）。
  _navHist?: string[];
  _navIdx?: number;
  [k: string]: any;
}

// ---- renderer/listing.js＝3つの閲覧モードすべてについて「何が見えていて、どの順か」
// を決める処理の流れ（投稿の絞り込みと並び替え／投稿者の絞り込みと並び替え／フォルダ
// の導出。描画1回ごとのレコードのキャッシュを含む）。フォルダの形は HologramFolder
// （下）。動的フォルダは保存した検索（tree と q）を持つ。 ----
// listing.ts 自身の API の面（makeListing/cloneTree/namedPosters など）は今や本物の
// ES モジュール＝名前付き export（export した ListingDeps インターフェースを含む）が
// 自分で型を持つので、Window の形をしたアンビエントのインターフェースはここにもう
// 宣言していない。

// ---- services/geometry.ts＝列とスライダーの軌道とサムネイルの、純粋な計算。今は
// 本物の ES モジュール（名前付き export）で、Window の形をしたアンビエントの
// インターフェースは要らない。ただし HologramGridMetrics は残る（viewer.ts と共有
// するデータ形）。 ----
// 計測値: W は小数のまま切り下げた容器の幅、g は溝の px。
interface HologramGridMetrics {
  W: number;
  g: number;
}

// ---- services/format.ts＝件数と日付の、純粋な表示用の整形。今は本物の ES モジュール
// （名前付き export）で、Window の形をしたアンビエントのインターフェースは要らない。 ----

// ---- services/undo.ts＝セッション内の取り消し／やり直しのスタック（#235）。本物の
// ES モジュール: UndoChange/UndoEntry は undo.ts から export されて名前でインポート
// されるので、アンビエントなものは何も無い。 ----

// ---- services/search-editing.ts＝検索ボックスとクエリ木のテキストの葉をつなぐ状態
// 機械と、候補を選んだときの処理。今は本物の ES モジュール（名前付き export）で、
// SearchEditingDeps は search-editing.ts から直接 export されるため、Window の形をした
// アンビエントのインターフェースは要らない。

// ---- services/folders.ts＝ライブラリのフォルダのストアと、その管理モーダル。
// 今は本物の ES モジュール（名前付き export）で、アンビエントの
// HologramFoldersApi や Window の形をしたインターフェースは要らない。生の
// createFolderStore ファクトリは、ライブラリのフォルダのストア（isLibrary）と、
// createPersistedFolderStore の永続化・読み込みの配線を介して
// hologramPosterFolderStore() ファクトリ（viewer.js の pfStore が使う。isLibrary 無し）
// とで内部的に共有している。フォルダは常に id/name/items を持つ。ライブラリの
// フォルダはさらに kind/created と、動的な保存済み検索（tree と q）を持つ。 ----
interface HologramFolder {
  id: string;
  name: string;
  items: string[];
  kind?: 'static' | 'dynamic';
  created?: number | null;
  /** 静的フォルダのみ: 親フォルダの id（#41）。無いか null なら根のフォルダ。 */
  parentId?: string | null;
  /** 動的フォルダのみ: 保存した検索。自由記述の語はその中の 'text' の葉になる。 */
  tree?: HologramQueryGroup | null;
  [k: string]: any;
}
interface HologramFolderStore {
  all(): HologramFolder[];
  allRaw(): HologramFolder[];
  setAll(list: unknown): void;
  byId(id: string | null | undefined): HologramFolder | null;
  has(id: string | null | undefined, key: string): boolean;
  create(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; parentId?: string | null } | null): HologramFolder | null;
  /** フォルダと、（ライブラリのストアなら）その部分木ごと削除する。取り除いた id をすべて返す。 */
  remove(id: string | null | undefined): Set<string>;
  /** 子孫も含めた所属。`only` を渡すとそのフォルダ自身の items だけに絞る（#41）。 */
  hasDeep(id: string | null | undefined, key: string, only?: boolean): boolean;
  /** 直接の子を、兄弟の順（＝配列の順）で返す。 */
  childrenOf(id: string | null): HologramFolder[];
  /** 「親 / 子 / 孫」＝木の外でフォルダを見せる画面のため。そこでは名前だけではフォルダを同定できない。 */
  pathOf(id: string | null | undefined): string;
  /** そのフォルダと、その下にあるものすべて（id が無ければ空）。 */
  subtreeIds(id: string | null | undefined): Set<string>;
  /** フォルダを新しい親の下へ移す（null は根）。自分自身と自分の部分木は受け付けない。 */
  reparent(id: string | null | undefined, parentId: string | null): boolean;
  /** 木へのドロップを1回の書き込みで: フォルダの中へ（null は根）、またはある行の隣へ＝その行の親を引き継ぐ。 */
  place(draggedId: string | null | undefined, targetId: string | null, mode: 'into' | 'before' | 'after'): boolean;
  rename(id: string | null | undefined, name: string | null | undefined): boolean;
  /** フォルダ内でキー1つ、またはまとまりごと切り替える。向きは anchorKey が決める。向きと、実際に動いたキーを返す。1つも動かなければ null（#235）。 */
  toggleIn(id: string | null | undefined, keys: string | string[] | null | undefined, anchorKey?: string | null): { op: 'added' | 'removed'; keys: string[] } | null;
  /** キーの集合をそのとおりに足す／外し（切り替えではない）、実際に動いたものを報告する＝取り消しが所属の差分を適用し直すときの経路（#235）。 */
  applyItems(id: string | null | undefined, add: readonly string[] | null | undefined, remove: readonly string[] | null | undefined): { added: string[]; removed: string[] };
  /** もう存在しないキー（削除された項目）を落とす。何か変わったら true。 */
  reconcile(existing: Set<string>): boolean;
  /** ドラッグでの並べ替え: draggedId を targetId の前／後ろへ置く。順が変わったら true。 */
  move(draggedId: string | null | undefined, targetId: string | null | undefined, before: boolean): boolean;
  /** フォルダのストア（isLibrary）にだけある: 動的フォルダの検索を保存し直す。 */
  update?(id: string | null | undefined, patch: { tree?: unknown } | null | undefined): boolean;
}
/** get/set の IPC の対を裏に持つ、そのまま使えるフォルダのストア。subscribe()（#6 の残り1）
 * はそれ自身の変更の通り道＝書き換え（persist() 経由）のたび、そして load() が終わるたび
 * に知らせる。おかげで React の一覧（投稿者フォルダのサイドバーの群）が、間に管理モーダル
 * のモデルを挟まずに直接 useSyncExternalStore できる（そのモデルも、モーダル自体も廃止済み）。 */
type HologramPersistedFolderStore = HologramFolderStore & { load(): Promise<void>; reload(): Promise<void>; subscribe(cb: () => void): () => void };

// services/store.ts は zustand の vanilla のストア（#1054）で、使う側がすべて直接
// インポートする。その状態の型はここではなくあのファイルにあるので、アンビエントな
// HologramStore や Window へのマージはもうどこにも無い。（そのストアが持つ形のうち
// いくつかは上で宣言している＝HologramTab / HologramQueryGroup / HologramPostGroup /
// HologramDateSection / HologramUserAgg。e2e/tsconfig.json が globals.d.ts と並べて
// このファイルも取り込んでいるのはそのため。）重複していた昔の
// `interface Window { hologramSelection }`（かつてはこのファイルで唯一の Window への
// マージだった）も無くなった＝selection.ts は今や本物の ES モジュール。
