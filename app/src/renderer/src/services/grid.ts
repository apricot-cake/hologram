// グリッドのモデルソース＝すべての仮想化グリッド（ライブラリの投稿／投稿者／
// ゴミ箱）に対する、命令形→宣言形のブリッジ。orchestrator.ts がデータ
// パイプラインを持ち、セル上のジェスチャーが何をするかを供給する
// （configureActions）。グリッドのコンポーネントはセルの描画とウィンドウ
// イング（masonic）を持つ。modelOf/keyOf に限っては hologramStore とは
// 別に持っている＝これらがコールバックを運ぶため（menu.js/qf-pop.js と同じ
// 理由）――それ以外（items、レイアウトの入力）は hologramStore に本当に
// 住んでいて、これらのソースはモデルの残りをそこから導出する。今は本物の
// ES モジュールで、その export は viewer.ts とグリッドコンポーネントから
// 直接 import される。hologramStore 自体も本物の ES モジュール（store.ts）。

import { currentPosterShape, currentShape, DISPLAY_KEYS, gutterFor, POSTER_DISPLAY_KEYS, posterGutterFor } from './display.ts';
import type { DisplayShape, PosterShape } from './display.ts';
import { store, subscribeKeys } from './store.ts';
import type { ZoomAnchor } from './zoom-anchor.ts';
//
// 両方のグリッド（post と poster）は、push されるブリッジ（viewer が完全な
// モデルを添えて render()/patch() を呼ぶ）から、pull されるソース（viewer は
// items/layout を hologramStore に書き込むだけで、ソースが get() のたびに
// 残りを導出する）へ変換された。GridMount（_shared/VirtualGrid.tsx）は自分の
// ブリッジ prop に対して .get()/.subscribe() しか呼ばない――
// render()/patch()/isActive() は決して呼んでおらず、それらは viewer 専用の
// API だった――ので、これは GridMount に一切変更を加えないそのまま差し替え
// になった。
//
// モデルの形: { items, itemsKey, modelOf(item,i)→セルモデル, keyOf(item,i)→
// 安定したキー, columnCount?, columnWidth?, rowGutter, itemHeightEstimate, … }。
//  - itemsKey は items 配列の参照が実際に変わったときだけ進む（フィルタ／
//    ソート／検索／データの変化）。コンポーネントはこれを見て自分の
//    ポジショナー（キャッシュ済みのセル高さ）をリセットし――PoC の空白
//    グリッドの罠に倣って scrollTop も同期し直す。
//  - paint（内部用、get() のたびに進む）は、フィールドの値が繰り返されて
//    いてもコンポーネントを再描画させる。GridMount の中で React のブリッジ
//    駆動の setState が識別に使うのは新しいオブジェクト参照だから。

type PostGridConfig = { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined; labels?: any; onAspect(cap: string, ar: string): void };
type PosterGridConfig = { modelOf(item: any, i: number): any; keyOf(item: any, i: number): string | number | null | undefined };
type TrashGridConfig = Omit<PostGridConfig, 'onAspect'>;

// post グリッドモデルのレイアウト側の半分。display shape（#618）＋サイズ軸
// から導出する。1つの関数で3つのグリッド（ライブラリ／ゴミ箱）をまかなう
// ので、表示の変更が片方にだけ着地して他方には届かない、ということが
// 起きない。
//
//  - columnCount は一覧を単一の全幅列に固定する。グリッドはこれを未設定の
//    ままにするので、masonic は columnWidth を最小値として扱い、埋めるよう
//    列を伸ばす（旧来の CSS auto-fill minmax と同じ計算）。
//  - `square` は、セルがちょうど1列分の幅と高さであることをホストへ伝え、
//    高さの見積もりを正確にする。true になるのは正方形単体のグリッドの
//    ときだけ――「詳細を表示」が有効だとメタデータブロックが正方形の下に
//    ぶら下がるので、高さは既知ではなく測定される。
//  - itemHeightEstimate はあくまで最初の見積もり（masonic は自分が描画した
//    ものを測る）＝実際の高さが届くまでの間、深いスクロール位置の復元が
//    どこに着地するかを左右する。
function postLayout(shape: DisplayShape, gridSize: number, listThumb: number) {
  const infoBlock = 96; // 正方形の下の poster/excerpt/meta ブロックのおおよその高さ
  return {
    shape,
    // サイズ軸の小さい側の端が概観ズームそのもの（#141）: その縮尺では
    // セルはまるごとサムネイルで、その上に描かれるバッジは数えている対象を
    // 覆ってしまう。
    overview: !shape.list && gridSize < 96,
    columnCount: shape.list ? 1 : undefined,
    columnWidth: shape.list ? undefined : gridSize,
    square: shape.square && !shape.info,
    rowGutter: gutterFor(shape),
    itemHeightEstimate: shape.list ? Math.round(listThumb * 1.25) : shape.square ? gridSize + (shape.info ? infoBlock : 0) : Math.round(gridSize * 1.2),
    listThumb,
  };
}

// #183: タイムライン専用のレイアウト＝グリッド／一覧と並ぶ3つ目の形。この
// モードでは、他の2つが読む shape.list/squareThumbs/gridSize の設定に
// 関わらず強制される（表示ポップオーバーはこのモードで3つのコントロールを
// すべて隠す。DisplayMenu.tsx の TimelineControls 参照――「どのレイアウトか」
// はこのモードが答える問いではない）。columnCount:1 ＋
// columnWidth:undefined は、postLayout 自身の一覧分岐がすでに使っているのと
// 同じ「masonic をコンテナ幅まで伸ばさせる」組み合わせ。FeedCard.tsx は
// 自分自身の読みやすい幅の上限を持ち、そのフルブリードの列の中で自分自身を
// 中央寄せする（postLayout の一覧ビューの幅には共有できる上限が無い＝
// FeedCard のヘッダーコメント参照）。itemHeightEstimate はあくまで大まかな
// 最初の見積もり（masonic は ResizeObserver を通して実際に描画したものを
// 測る）＝フィード用カードは可変量の本文テキストと任意の画像／カルーセルを
// 運ぶので、正方形グリッドのセルのように確保すべき正確な数字が無い。
function timelineLayout(shape: DisplayShape, listThumb: number) {
  return {
    shape,
    overview: false,
    columnCount: 1,
    columnWidth: undefined,
    square: false,
    rowGutter: 20,
    itemHeightEstimate: 320,
    listThumb,
  };
}

// post グリッドのモデルソース: items は hologramStore('postGroups') から、
// layout は表示軸＋hologramStore('gridSize'/'listThumb') から上の
// postLayout 経由で来る。configure() は不変のコールバックを一度だけ設定
// する（modelOf/keyOf/onAspect は描画をまたいで意味のある形で identity が
// 変わることはなく、変わるのは items+layout だけ）。
function makePostGridSource() {
  let config: PostGridConfig | null = null;
  let actions: HologramCardActions | undefined; // セル上のジェスチャーが何をするか（orchestrator.ts が埋める）
  let liveColumnWidth: number | null = null; // ドラッグ中の一時的な上書き。意図して hologramStore には置かない（その型の doc コメント参照）
  let zoomAnchor: ZoomAnchor | null = null; // Ctrl+ホイールズームが保持したい位置（#282）＝liveColumnWidth と同じ側路
  let lastItems: any;
  let itemsKeySeq = 0; // items の参照が実際に変わったときだけ進む＝旧来の push 時の itemsKey 更新を鏡写しにしている
  let paintSeq = 0;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };
  // ストアのキーへのリスナーは（subscribe() の呼び出しごとにではなく）一度
  // だけ配線する――実際には利用側は GridMount 1つだけだが、これは万一それが
  // 変わったときに hologramStore への購読（と notify() のファンアウト）が
  // 重複して積み上がるのを避ける。'browseMode' がこの一覧にあるのはタイム
  // ラインのため（#183）: 下のレイアウト分岐がそれを直接読み、モード切替
  // だけ（表示軸やサイズの変化を伴わない）でも新しいレイアウトで再描画され
  // なければならないから。
  subscribeKeys(['postGroups', 'postSections', ...DISPLAY_KEYS, 'gridSize', 'listThumb', 'browseMode'], notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = store.getState().postGroups;
    if (items == null) return null; // undefined（まだ何も描画されていない）または明示的な null（グリッドが空）
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    const mode = store.getState().browseMode;
    const layout = mode === 'timeline' ? timelineLayout(currentShape(), store.getState().listThumb) : postLayout(currentShape(), store.getState().gridSize, store.getState().listThumb);
    return {
      ...layout,
      mode,
      items,
      itemsKey: itemsKeySeq,
      modelOf: config.modelOf,
      keyOf: config.keyOf,
      labels: config.labels,
      cardActions: actions,
      columnWidth: liveColumnWidth ?? layout.columnWidth,
      zoomAnchor,
      onAspect: config.onAspect,
      // #47 — 日付ソートのときの月セクション（それ以外は null）。これらは
      // `items` への添字なので、2つを離して読んではいけない:
      // post-grid-builder.ts はこれらを1回の setState で push する。これに
      // より、1回の computeModel() が同じ構築結果の両方の半分を見ることに
      // なる。（#871: 別々の単一キー書き込みが2回だと、同期的な notify パスも
      // 2回になり、1回目が新しい items に前回の構築結果のセクション範囲を
      // 積んだモデルを生んでいた。同じストアであることは同じ push であること
      // を意味しない――itemsKey の更新ではそれをカバーできない。2回目の
      // パスは `items` をそのままにして範囲だけを動かすため。）
      sections: store.getState().postSections,
      paint: ++paintSeq,
    } as HologramGridModel;
  }
  return {
    configure(cfg: PostGridConfig) {
      config = cfg;
    },
    configureActions(a: HologramCardActions) {
      actions = a;
    },
    setLiveColumnWidth(px: number | null) {
      liveColumnWidth = px;
      notify();
    },
    // このすぐ後に続くサイズ変更（#282）の後も、view がどこを見ているべきか。
    // あえて notify しない: サイズ変更こそがグリッドを再レイアウトさせる
    // ものであり、アンカーはそれが描画する対象のモデルの上に乗っている
    // 必要がある――これ単独で知らせても、何も変えない描画のコストが
    // かかるだけ。コンポーネントはオブジェクトの identity を見て再武装する
    // ので、サイズ変更の間に get() を繰り返し呼んでも同じアンカーが渡され、
    // 正しく no-op になる。
    setZoomAnchor(a: ZoomAnchor | null) {
      zoomAnchor = a;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const hologramPostGridSource = makePostGridSource();

// poster グリッドモデルのレイアウト側の半分。poster の display shape
// （#630）＋その1つのサイズから導出する。上の postLayout の双子で、軸が
// 1つ少ない。
//
//  - `square` が true になるのは単体のグリッドのとき: セルはちょうど
//    アバターなので、その高さは列幅と同じで masonic は測定を要さない。
//    「詳細を表示」が有効だとメタデータブロックが下にぶら下がり、高さは
//    測定される。
//  - 一覧は post 側と同様、単一の全幅列に固定する。
function posterLayout(shape: PosterShape, gridSize: number) {
  const infoBlock = 78; // 名前／ハンドル／プラットフォーム＋件数ブロックのおおよその高さ
  return {
    posterShape: shape,
    columnCount: shape.list ? 1 : undefined,
    columnWidth: shape.list ? undefined : gridSize,
    square: !shape.list && !shape.info,
    rowGutter: posterGutterFor(shape),
    itemHeightEstimate: shape.list ? 52 : gridSize + (shape.info ? infoBlock : 0),
  };
}

// poster グリッドのモデルソース: post 側のソースと同じ形から、onAspect
// （ポスターのアバターは学習済みアスペクト比を報告しない）とドラッグ中の
// 一時的な上書きを引いたもの――ポスターのサイズスライダーはすでに 'input'
// のティックごとに hologramIpc.setPref をコミットしている
// （services/orchestrator.ts の setupPosterSizeSlider は post 側のスライダー
// のようなドラッグ中／コミットの分離を持たない）ので、hologramStore への
// 書き込みもティックごとに行っても新たなコストにはならない。get() は
// 他のすべてのレイアウト入力と同様、確定済みの値をストアからそのまま
// 読むだけ。
function makePosterGridSource() {
  let config: PosterGridConfig | null = null;
  let actions: HologramCardActions | undefined;
  let lastItems: any;
  let itemsKeySeq = 0;
  let paintSeq = 0;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };
  subscribeKeys(['posterGroups', ...POSTER_DISPLAY_KEYS, 'posterGridSize'], notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = store.getState().posterGroups;
    if (items == null) return null; // 最初の renderPosters() までは undefined。以降は常に配列（空のこともある）で、明示的に null へクリアされることはない（posts と違い、poster には保つべき innerHTML クリアの順序制約が無い）
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    return {
      ...posterLayout(currentPosterShape(), store.getState().posterGridSize),
      items,
      itemsKey: itemsKeySeq,
      modelOf: config.modelOf,
      keyOf: config.keyOf,
      cardActions: actions,
      paint: ++paintSeq,
    } as HologramGridModel;
  }
  return {
    configure(cfg: PosterGridConfig) {
      config = cfg;
    },
    configureActions(a: HologramCardActions) {
      actions = a;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const hologramPosterGridSource = makePosterGridSource();

// ゴミ箱グリッドのモデルソース（#268）――ゴミ箱の行き先はライブラリと同じ
// カードを描くので、post 側の modelOf/keyOf/labels をそのまま取り
// （orchestrator が post-grid-builder の cardModel を渡す）、同じ density
// キーからレイアウトを導出する。items は services/trash-view.ts が書き込む
// 'trashGroups' から来る。他は何も違わない、しかもそれは意図的なもの――
// 削除済み投稿のために2つ目のカード語彙を持つことは、設計が却下した
// 「UI の重複」そのもの。onAspect は無い（学習済みアスペクト比の
// キャッシュはライブラリ自身の masonry パスに属する）。ドラッグ中の
// 列幅もズームアンカーも無い（Ctrl+ホイールズームとサイズスライダーの
// ドラッグはどちらも post グリッドを狙ったもの）。
function makeTrashGridSource() {
  let config: TrashGridConfig | null = null;
  let actions: HologramCardActions | undefined;
  let lastItems: any;
  let itemsKeySeq = 0;
  let paintSeq = 0;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* ignore */
      }
    }
  };
  subscribeKeys(['trashGroups', ...DISPLAY_KEYS, 'gridSize', 'listThumb'], notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = store.getState().trashGroups;
    if (items == null) return null; // undefined（一度も読み込んでいない）または明示的な null（ゴミ箱が空）
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    return {
      ...postLayout(currentShape(), store.getState().gridSize, store.getState().listThumb),
      items,
      itemsKey: itemsKeySeq,
      modelOf: config.modelOf,
      keyOf: config.keyOf,
      labels: config.labels,
      cardActions: actions,
      paint: ++paintSeq,
    } as HologramGridModel;
  }
  return {
    configure(cfg: TrashGridConfig) {
      config = cfg;
    },
    configureActions(a: HologramCardActions) {
      actions = a;
    },
    get: computeModel,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
export const hologramTrashGridSource = makeTrashGridSource();
