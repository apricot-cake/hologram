// レンダラーの React コンポーネントが使う Window グローバルの契約。ここに置く宣言は
// 2種類ある。(1) 本当に境界をまたぐアンビエント宣言＝preload の contextBridge の面
// （window.hologram）と CSS の副作用インポートで、どちらも `import` 文では表せない。
// (2) 生産側の service モジュールと消費側のコンポーネントの間で共有するデータ形の
// インターフェースで、呼び出し箇所ごとに export して import するのではなく、アンビ
// エントのまま（import 不要）にしてある。生産側のモジュールはかつてほとんどが素の
// JS の push ブリッジで、アンビエント宣言も tsc の検査も一切なかった（TypeScript
// 段階1・BACKLOG 採用 #1）。あの移行はモジュール単位で進み、2026-07 までに全部が
// 本物の ES モジュールになった。移行が残したモジュールごとの「変換済み・アンビエント
// はもう不要」という墓標コメントは、それらが導入していたインターフェースもろとも
// 2026-07-30 に削除した（#231）。下に残っているのは今も読まれている契約だけ。
// `HologramI18nApi`（純粋なデータ形）は同じ回で、持ち主のモジュール services/i18n.ts
// の隣へ移した＝そのファイルを参照。

export {};

// Vite は CSS のインポートを注入するスタイルシートに変える。tsc から見ると副作用だけの
// モジュール（settings が './styles.css' をインポートしている）。
declare module '*.css' {}

declare global {
  type HologramUnsubscribe = () => void;

  // ---- app/src/preload/index.ts＝contextBridge の IPC の面すべて（window.hologram）。
  // 型は実装側が自分で export している（公開する api オブジェクトの typeof・Issue
  // #17）ので、このエイリアスがブリッジの実際の公開内容からずれることはない＝手で
  // 保守していた昔のインターフェースの写しは無くなった。このプログラムでは
  // 'electron' が types/electron-shim.d.ts に解決される（tsconfig の paths。シムの
  // コメントを参照）。tsconfig.node.json は同じファイルを本物の electron の型に対して
  // 検査する。 ----
  type HologramPreload = import('../../../preload/index').HologramPreload;

  // ---- services/grid.ts＝仮想化グリッドごとの、引く側のモデルの供給元（post と
  // poster はどちらも昔の push ブリッジから変換済み。push ブリッジを作るコードはもう
  // 無い）。viewer.js は今も items やレイアウトの入力を組み立てるが、render()/patch()
  // を呼ぶのではなく hologramStore へ書く＝モデルは供給元が自分で導く。`paint` は
  // 内部用（get() のたびに増やす。欄の値が同じでも新しいオブジェクト参照が React に
  // 届くように）。選択と詳細表示中はこのモデルに入っていない＝Cell がどちらも
  // hologramStore の購読から直に導く（Grid.tsx / PosterGrid.tsx を参照）。
  interface HologramGridModel {
    items: any[];
    itemsKey: string | number;
    modelOf(item: any, i: number): any;
    keyOf?(item: any, i: number): string | number | null | undefined;
    columnCount?: number;
    columnWidth?: number;
    rowGutter?: number;
    itemHeightEstimate?: number;
    square?: boolean;
    // #282: Ctrl+ホイールのズームが動かさずに留めたい項目と、画面上のどこで留めるか。
    // hologramStore ではなくモデルに乗せているのは、実時間の列幅と同じ理由＝1つの
    // ジェスチャーと1つのグリッドの間の脇道であり、それをスクロール位置に戻すのは
    // （ズームではなく）グリッドの島の側だから。
    zoomAnchor?: import('../services/zoom-anchor').ZoomAnchor | null;
    labels?: any;
    /** このモデルの導出元になった表示の形（#618）＝セルはこれを見て自分を配置する。 */
    shape?: import('../services/display').DisplayShape;
    /** #183: このモデルを組み立てた対象の閲覧モード（post グリッドのみ）＝Grid.tsx の
     * PostCell がこれを読んで、PostCard/ListRow ではなくタイムラインの FeedCard を選ぶ。 */
    mode?: string;
    /** poster グリッド自身の形（#630）＝アバターには選ぶべき縦横比が無いので軸は2つ。 */
    posterShape?: import('../services/display').PosterShape;
    /** 大きさの軸の小さい側の端（#141）＝そこではセルが装飾を落とす。 */
    overview?: boolean;
    /** 一覧の行: サムネイルの列の幅（px。一覧自身の大きさの軸）。 */
    listThumb?: number;
    /** #47＝日付順のときの月ごとのセクション（post グリッドのみ。他の並び順・グリッド
     * では常に null）。Grid.tsx はこれで振り分ける: あれば SectionedGridHost、無ければ
     * 素の単一インスタンスの VirtualGridHost（他の閲覧モードと並び順は、この変わらない
     * 経路のまま）。セクションは startIndex/count で `items` を切り出す＝セクションごとに
     * masonic のインスタンスを1つ持つのであって、単一のインスタンスの中に幅いっぱいの
     * 疑似項目を混ぜるのではない（masonic には行をまたぐという概念が無く、その方法は
     * 成り立たない）。 */
    sections?: HologramDateSection[] | null;
    /** セルの上でのジェスチャーが何をするか。グリッドごとに自前のものを渡す（ライブラリ／ゴミ箱）。 */
    cardActions?: HologramCardActions;
    onAspect?(cap: string, aspectRatio: string): void;
    paint: number;
    [extra: string]: any;
  }
  // カードごとのジェスチャーを、グリッドの容器に付けた委譲リスナーが DOM から
  // `data-index` を読み戻す形ではなく、コールバックとして持つ（#153 の分類1と2）。
  // セルは自分が描いているグループをそのまま渡すので、添字を引き直す必要がどこにも
  // 無い。どのメンバーも省略可能: ゴミ箱のグリッドはクリックとダブルクリックにだけ
  // 答え、残りは意図して受け付けない（削除済みの投稿はドラッグで持ち出せないし、その
  // メニューはビュー自身の操作の行だから）。
  interface HologramCardActions {
    onClick?(group: any, e: import('react').MouseEvent): void;
    onDoubleClick?(group: any, e: import('react').MouseEvent): void;
    onAuxClick?(group: any, e: import('react').MouseEvent): void;
    onContextMenu?(group: any, e: import('react').MouseEvent): void;
    onDragStart?(group: any, e: import('react').DragEvent): void;
    onMouseDown?(group: any, e: import('react').MouseEvent): void;
  }
  // GridMount（_shared/VirtualGrid.tsx）が実際に使う形＝呼ぶのは get()/subscribe() だけ
  // なので、これが両方の供給元（services/grid.ts の hologramPostGridSource /
  // hologramPosterGridSource。今はどちらも本物の ES モジュールの export）が満たす最小の
  // 契約になる。供給元はこれに加えて自前の configure() などを持つが、GridMount はそこに
  // 一切触れない。
  interface HologramGridSource {
    get(): HologramGridModel | null;
    subscribe(cb: () => void): HologramUnsubscribe;
  }
  // ドラッグでの範囲選択（#484）。ジェスチャーと当たり判定は仮想化グリッドのホストが
  // 持つ＝セルの矩形が存在する唯一の場所だから（masonic の positioner）。選択はこの
  // sink を通して動かす。`additive` は帯を引き始めた時点で Ctrl/Cmd か Shift が押されて
  // いたこと。`update` は当たった添字（昇順）を、当たり判定の集合が変わったフレームの
  // たびに受け取るので、何度実行しても同じでなければならない。
  interface HologramMarqueeSink {
    begin(additive: boolean): void;
    update(indices: number[]): void;
    end(): void;
    cancel(): void;
  }

  // ---- services/image-tab.ts＝画像タブの詳細ビューを、昔の push（viewer.js が完全な
  // モデルを組み立て、約8か所から render(model) を呼んでいた）から、2つのグリッドの
  // 供給元と同じ形の、引く側の供給元へ変換する。viewer.js が書くのはタブの同定情報だけ
  // （hologramStore の 'activeImageTab'＝id/recs/idx。タブの状態のうち、tabs→ストアの
  // 全面移行に先んじて移した唯一の部分）で、'inspectedKey' は今も viewer.js が持つ
  // （状態→ストアの段階）。get() はその両方を posts-data.ts と突き合わせる（ライブラリ
  // の変化＝削除された投稿は、viewer からの push 無しに実時間で欠落状態へ落ちる。
  // posts-data.ts 自身のコメントが見込んでいたとおり）。コマンド（添字を1つ送る／詳細
  // パネルの切り替え／タブを閉じる）は configure() のコールバック経由で viewer.ts へ
  // 戻す（image-tab-builder.ts を切り出した時に、昔の共有ブリッジから DI に変えた）＝
  // このファイルは計算するだけで、タブの状態を書き換えることはない。今は本物の ES
  // モジュール（名前付き export `hologramImageTabSource`）で、Window の形をした
  // アンビエントのインターフェースは要らない（HologramImageTabModel は残す＝
  // image-tab.ts とこのコンポーネントの間で共有するデータ形）。
  interface HologramImageTabModel {
    // 今アクティブなタブ自身の id（#80）＝image-tab/index.tsx が ImageTab コンポーネント
    // の key にこれを使う。おかげで、ある画像タブから別の画像タブへ直接切り替えたとき
    // （どちらも自分の画像ビューを表示済みなので、このホストが外れることはない）、
    // コンポーネントは再利用されずに載せ直しになる＝オーバーレイの切り替え
    // （services/image-overlay.ts）が、新しいタブの絵へ漏れ出すのではなくリセットされる。
    tabId: string;
    items: { src: string; alt?: string; video?: boolean }[];
    idx: number;
    missing?: boolean;
    inspectorOpen?: boolean;
    labels: Record<string, string>;
    onIndexChange?(i: number): void;
    onToggleInspector?(): void;
    onCloseTab?(): void;
  }

  // ---- services/tabs.ts＝タブの帯を、昔の push（viewer.js が renderTabs() で TabsModel
  // を組み立て、約15か所から共有の描画ブリッジへ押し込んでいた）から、グリッドや
  // image-tab の供給元と同じ形の、引く側の供給元へ変換する。viewer.js は tabs と
  // activeTabId をクロージャの状態として持たなくなった＝同じ名前の hologramStore の
  // キーがそのまま状態になる。viewer.js に残るのは書き換えの関数（switchTab/addTab/…）
  // だけで、帯は自分のハンドラからそれを直接呼ぶ（#621）。tabTitleOf/tabIcons/pinSvg は
  // viewer が組み立てた不変の値で、一度だけ渡す（configure）＝グリッドの供給元と同じ
  // 「一度だけ configure する」形。
  interface HologramTabModel {
    id: string;
    title: string;
    icon: string;
    active?: boolean;
    pinned?: boolean;
    showClose?: boolean;
  }
  interface HologramTabsModel {
    tabs: HologramTabModel[];
    closeTitle?: string;
    newTitle?: string;
  }

  // ---- viewer に位置を合わせるポップアップのモデルは、この anchor の形を共有する（DOMRect でも通る） ----
  interface HologramAnchorRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  // ---- services/qf-pop-builder.ts（描画を持たない pickValue の振り分け） ----
  interface HologramQfPopItem {
    [key: string]: any;
  }

  // ---- renderer/menu.js＝共有の右クリックのコンテキストメニュー ----
  interface HologramMenuItem {
    label?: string;
    act?: string;
    danger?: boolean;
    checked?: boolean;
    sep?: boolean;
    manage?: boolean;
    icon?: string;
    [extra: string]: any;
  }
  // メニューがどこにぶら下がるか。右クリックのメニューはカーソルを指す（{x, y}）。
  // ボタンから開くメニューは代わりにそのボタンを指す（{ anchorEl }）ので、ui kit が
  // それを測り、くっつけたままにし、ぶつかれば反転させる＝呼ぶ側が矩形を手でずらす
  // ことは一切ない（#62）。side/align は望ましい配置であって、最終的な配置ではない。
  type HologramMenuSide = 'top' | 'bottom' | 'left' | 'right';
  type HologramMenuAlign = 'start' | 'center' | 'end';
  interface HologramMenuAnchor {
    x?: number;
    y?: number;
    anchorEl?: HTMLElement | null;
    side?: HologramMenuSide;
    align?: HologramMenuAlign;
  }
  interface HologramContextMenuModel {
    items: HologramMenuItem[];
    x: number;
    y: number;
    anchorEl: HTMLElement | null;
    side?: HologramMenuSide;
    align?: HologramMenuAlign;
    // 新しい items の配列を返すとメニューは開いたまま（切り替えの行）。何も返さなければ
    // 閉じる。`| void` の腕がその「閉じる」の合図＝void を返す pick ハンドラ（こちらが
    // 普通）をそのまま代入できるようにもなっている。
    // biome-ignore lint/suspicious/noConfusingVoidType: void is the intentional "close the menu" return
    onPick: ((item: HologramMenuItem) => HologramMenuItem[] | void) | null;
  }

  // ---- renderer/kind-menu.js＝タグの種別（作品／キャラクター／…）のメニュー ----
  interface HologramKindMenuRow {
    kind?: string;
    label?: string;
    dot?: boolean;
    renameable?: boolean;
    checked?: boolean;
    sep?: boolean;
  }
  interface HologramKindMenuModel {
    x: number;
    y: number;
    header?: string;
    renameTitle?: string;
    rows: HologramKindMenuRow[];
    onPick(kind: string): void;
    onRename(kind: string): void;
    // #207: 区切り線の下に置く任意の追加の行で、作品／キャラクター／一般のラジオ群の外
    // にある＝このメニューは「タグのコンテキストメニュー」も兼ねる（タグのチップが持つ
    // 唯一の右クリックの面）ので、操作を1つ増やすためだけに2つ目のメニューの面を生やす
    // のではなく、「ウェブで探す」をここに相乗りさせている。
    websearch?: { label: string; onPick(): void } | null;
  }

  // ---- renderer/filter-popover.js＝日付／エンゲージメント／投稿者の日付のフォーム ----
  interface HologramFilterPopoverModel {
    kind: 'date' | 'eng' | 'posterDate';
    openId: number;
    anchorRect: HologramAnchorRect;
    editing?: boolean;
    fields: any;
    labels: any;
    typeOptions?: any[];
    dimOptions?: any[];
    // 3つのポップオーバーの欄の形の和（'date'/'posterDate' は dateField/from/to を渡し、
    // 'eng' は engType/min/op を渡す）＝3つのオーバーロードにはせず、1つの loose な
    // オブジェクトとして持つ。こうすると viewer.ts のインラインの分割代入が、呼び出し
    // 箇所ごとに判別可能な合併型へキャストしなくても型付けできる。
    // min は解析済みの数値で届く（FilterPopover.tsx の EngForm が onApply を呼ぶ前に
    // Number.parseInt を通す）＝残りは文字列のまま。
    onApply(fields: { dateField?: string; from?: string; to?: string; engType?: string; min?: string | number; op?: string }): void;
    onRemove(): void;
    [extra: string]: any;
  }

  // ---- renderer/inspector.js＝モデルの仕組み。細かい欄の一覧は viewer.js のモデルの
  // 組み立て側にある。 ----
  // インスペクタのタグ欄はその場で編集する（P2⑦）ので、タグの書き換えそのものをモデルが
  // 持つ。onTagContextMenu は種別メニュー（読み取り）。
  interface HologramInspectorModel {
    kind: 'post' | 'poster';
    openId: number;
    onClose(): void;
    onTagAdd(tag: string): void;
    onTagRemove(tag: string): void;
    onTagContextMenu(tag: string, x: number, y: number): void;
    /** タグ欄にキャレットを置いた状態で開く＝コンテキストメニューの「タグを編集」。 */
    focusTags?: boolean;
    // 投稿のときだけ（Inspector.tsx はあれば描画する）。
    onThumbClick?(): void; // プレビューのサムネイル → クイックビューの覗き見（#143）
    // #36: 自由記述のメモ＝MemoSection の初期値と、フォーカスが外れたとき／デバウンス後の確定。
    memo?: string;
    onMemoChange?(text: string): void;
    onOpenExternal?(): void;
    onSauce?(): void;
    onAscii?(): void;
    onPosterJump?(): void;
    // #180: 引用／リノートした投稿、または（Misskey のみ）返信先の投稿を埋め込むカード。
    // 保存済みのサイドカーの部分レコードから描画する（QuotedPostCard.tsx）＝実時間の
    // ネットワーク取得は一切しない（v1 はメタデータのみ、メディアは URL のみで、リモート
    // の画像 src は持たない）。extractor が組み立てられるものを投稿が引用も返信もして
    // いなければ、空か不在。
    quotedCards?: HologramQuotedCardModel[];
    // #179: 投稿のアンケート。保存済みの `poll` の部分構造から描画する（PollCard.tsx）。
    // 投稿がアンケートを持っていなければ不在。
    pollCard?: HologramPollCardModel;
    // #181: 投稿の OGP のプレビューカード。保存済みの `linkCard` の部分構造から描画する
    // （LinkCard.tsx）。投稿がリンクを共有していなければ不在。
    linkCard?: HologramLinkCardModel;
    // 投稿者のときだけ。
    onPosterPosts?(): void;
    onFolderToggle(id: string): void;
    onFolderCreate?(): void;
    // #23 St1（投稿者の名寄せ）: 「同一人物」のセクション＝この投稿者の別名グループが
    // 束ねている他の posterKey すべて（グループ化されていなければ空）。
    sameAuthor?: Array<{ key: string; label: string; platformLabel: string }>;
    onSameAuthorMerge?(): void; // 統合の選択画面を開く
    onSameAuthorUnlink?(key: string): void; // グループからメンバーを1つだけ外す
    [extra: string]: any;
  }
  // #180: 埋め込む引用／返信先のカード1枚。inspector-builder.ts の showDetail() が、
  // 投稿の quotedPost/replyToPost のサイドカー部分レコードから組み立てる。
  // onOpen は、独立したレコードが保存済みならアプリ内でそこへ移動し（#180 の
  // 2026-07-27 の設計コメント: postKeyOf による同一投稿の同定）、無ければ部分レコード
  // 自身の URL を外部で開く＝onOpen は部分レコードが url を持つときは必ずあり、
  // （まれな）url が無い場合だけ不在。
  // #179: インスペクタが見せる形の、投稿のアンケート。inspector-builder.ts の
  // showDetail() が組み立てる。数値はここで全部整形済み（コンポーネントは文字列を
  // 描画するだけ。下の HologramQuotedCardModel と同じ分担）。例外は `percent` で、
  // これはバーの幅なので数値のまま残すしかない＝プラットフォームが集計を伏せている
  // ときは null で、その場合は空のバーではなくバーそのものを描かない。
  interface HologramPollCardModel {
    label: string;
    choices: Array<{ text: string; votesLabel: string; percentLabel: string; percent: number | null }>;
    // 「複数選択可 ・ 1,234票 ・ 締切 …」＝アンケートに付く条件を1行につないだもの。
    // プラットフォームがどれも出していなければ空。
    metaLabel: string;
  }
  // #181: 投稿の OGP のプレビューカード。inspector-builder.ts の showDetail() が、
  // 保存済みの `linkCard` 部分レコード（題名／説明／サムネイルのファイル／遷移先の
  // url）から組み立てる。thumbSrc はローカルの asset:// のパス（サムネイルは保存時に
  // 取得する。#181 の範囲＝リモートの src は一切使わない）で、カードが画像を持たな
  // かったか、取得に失敗したときは null。onOpen はカードが url を持つときは必ずある
  // （投稿の他の外向きリンクがすべて使うのと同じ、https だけを外部で開く経路）＝
  // url が無いカードはそもそもレンダラーまで届かない（native-host/post-record.mts の
  // normLinkCard が落とす）。
  interface HologramLinkCardModel {
    // カードの上に出すセクションの見出しで、ここで既に翻訳済み（コンポーネントは
    // 文字列を描画するだけ）＝HologramPollCardModel.label と同じ分担。
    label: string;
    title: string;
    description: string;
    domainLabel: string;
    thumbSrc: string | null;
    onOpen(): void;
  }
  interface HologramQuotedCardModel {
    kind: 'quote' | 'reply';
    label: string;
    displayName: string;
    screenNameLabel: string;
    avatarSrc: string | null;
    monogram: string | null;
    monoHue: number | null;
    dateLabel: string;
    cw: string;
    text: string;
    mediaCountLabel: string;
    onOpen?(): void;
  }
  // ---- 空状態の種別＝EmptyState.tsx が、push されるブリッジではなく hologramStore から
  // 自分で導く（昔の renderer/empty.js のブリッジは削除済み＝呼ぶ側がもう残っていない）。
  // 容器と表示・非表示も自分で持つ（2本の描画経路が `hidden` を書き込んでいた静的な
  // #emptyState の div も一緒に無くなった）。 ----
  type HologramEmptyVariant = 'firstRun' | 'filtered' | 'posterFirstRun' | 'extensionGuide';

  // ---- services/confirm.ts＝共有の確認モーダル（shadcn の AlertDialog）。呼ぶ側は
  // メッセージと、任意の「今後表示しない」／キーワードのゲートと、コールバックを渡して
  // 開く。描画はコンポーネントがする。 ----
  interface HologramConfirmConfig {
    message: string;
    description?: string; // あれば → 題名の下に出る副次の行（AlertDialogDescription）
    okLabel: string;
    cancelLabel: string;
    skipLabel?: string; // あれば → 「今後表示しない」のチェックボックスを出す
    keywordPlaceholder?: string; // あれば → キーワードでゲートを付けた OK（破壊的な全消去）
    keywordRequired?: string;
    // OK とキャンセルの他にもう1つの答え（#34 の重複した取り込み: 複製／置換／飛ばす）。
    // あれば → 操作ボタンを1つ増やす。破壊的でない方の選択肢として装飾し、破壊的な OK が
    // 破壊的に読める唯一のものであり続けるようにする。無ければ → ダイアログは今までどおり
    // ボタン2つのもの。
    altLabel?: string;
    onAlt?(result: { skip: boolean }): void;
    // OK は既定で破壊的（#34 より前の呼ぶ側はすべて削除か全消去だった）。false → OK が
    // 破壊的でない問いのための、素の操作ボタンになる。
    okDestructive?: boolean;
    onOk(result: { skip: boolean }): void;
    onCancel?(): void;
  }
  interface HologramConfirmModel extends HologramConfirmConfig {
    openId: number;
  }
  // 名前を尋ねる入力（prompt.ts と PromptHost）＝window.prompt の代わり。Electron の
  // レンダラーは window.prompt を拒む（「prompt() is not supported.」）。
  interface HologramPromptConfig {
    title: string;
    value?: string; // 入力欄の初期値（改名は今の名前を渡す）
    placeholder?: string;
    okLabel: string;
    cancelLabel: string;
    /** 前後の空白を落とした値で呼ばれる。空の値で呼ばれることはない。 */
    onOk(value: string): void;
    onCancel?(): void;
  }
  interface HologramPromptModel extends HologramPromptConfig {
    openId: number;
  }
  // 一括タグ付けのダイアログ（bulk-tag.ts と BulkTagDialog）＝選択バーの「タグを追加」
  // （P2⑦）で、廃止した tag-pop の一括モードの代わり。積んだタグはダイアログ自身の
  // React の状態なので、ここでは何も持たない: レンダラーは自分だけが知っているもの
  // （語彙・種別メニュー・書き込み）だけを渡し、出来上がった一覧を適用時に一度だけ
  // 受け取る。
  interface HologramBulkTagConfig {
    count: number; // 選択中の投稿＝適用のボタンとトーストがこれを数える
    tagLabels: Record<string, string>; // TagField の labels の束
    labels: { title: string; additiveHint: string; apply: string; cancel: string };
    /** ここまでに積んだタグを踏まえた、選択画面用の語彙・共起・ソースタグの群。 */
    pickerData(tags: string[]): { vocabGroups?: any; coocGroups?: any; srcTagsForPicker?: any; aliasMap?: Record<string, string> };
    /** タグを右クリック → 種別メニュー。onChange は pickerData を導き直す（種別が変わると語彙のセクション分けが変わる）。 */
    onKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
    /** 積んだタグを選択に対して書き込む。ホストが先にダイアログを閉じる。 */
    onApply(tags: string[]): void;
  }
  interface HologramBulkTagModel extends HologramBulkTagConfig {
    openId: number;
  }

  // ---- services/searchbox.ts＝今は本物の ES モジュール（名前付き export:
  // init/handlers/registerFocus/focusSearchBox）。ここに残るのは handlers が運ぶ中身の
  // 契約だけで、モジュールをまたぐデータ形として置いてある（viewer が作り、searchbox の
  // コンポーネントが引く）。 ----
  // getSuggestions は #28 で去った: 候補の行はコマンドの登録簿
  // （services/command-registry.ts）から来るようになり、コンポーネントがそれを直接
  // インポートする。ブリッジに残るのは、選択・確定が何をするかの側＝登録簿の移動の
  // エントリも onPick を呼ぶので、両方の面で「選ばれた」が同じ意味になる。
  interface HologramSearchBoxHandlers {
    onPick(item: any): void;
    onConfirmText(): void;
  }

  // ---- Local Font Access API（services/ui-font-api.ts・#137）＝Chromium は
  // window.queryLocalFonts()/FontData を積んでいるが、TypeScript が同梱する
  // lib.dom.d.ts はその型を持たない（node_modules/@typescript/typescript-win32-x64/lib/lib.dom.d.ts
  // を TS 7.0.2 で確認。queryLocalFonts も FontData も一致なし）ので、アンビエント宣言を
  // ここに手で書いている。省略可能にしてあるのは、古い Electron や Chromium 以外の
  // ビルドでは単にこのメンバーが無いから。フォントの選択画面はそれを「未対応」として
  // 扱い、Issue の設計が許している自由記述のみの入力へ退避する。
  interface FontData {
    readonly family: string;
    readonly fullName: string;
    readonly postscriptName: string;
    readonly style: string;
  }
  interface Window {
    hologram: HologramPreload;
    queryLocalFonts?(options?: { postscriptNames?: string[] }): Promise<FontData[]>;
  }
}
