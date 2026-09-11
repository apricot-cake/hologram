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
function postLayout(shape: DisplayShape, gridSize: number) {
  const infoBlock = 96; // 正方形の下の poster/excerpt/meta ブロックのおおよその高さ
  return {
    shape,
    // サイズ軸の小さい側の端が概観ズームそのもの（#141）: その縮尺では
    // セルはまるごとサムネイルで、その上に描かれるバッジは数えている対象を
    // 覆ってしまう。
    overview: gridSize < 96,
    columnWidth: gridSize,
    square: shape.square && !shape.info,
    rowGutter: gutterFor(shape),
    itemHeightEstimate: shape.square ? gridSize + (shape.info ? infoBlock : 0) : Math.round(gridSize * 1.2),
  };
}

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
        /* 握りつぶす */
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
  subscribeKeys(['postGroups', ...DISPLAY_KEYS, 'gridSize', 'browseMode'], notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = store.getState().postGroups;
    if (items == null) return null; // undefined（まだ何も描画されていない）または明示的な null（グリッドが空）
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    const layout = postLayout(currentShape(), store.getState().gridSize);
    return {
      ...layout,
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

function posterLayout(shape: PosterShape, gridSize: number) {
  const infoBlock = 78; // 名前／ハンドル／プラットフォーム＋件数ブロックのおおよその高さ
  return {
    posterShape: shape,
    columnWidth: gridSize,
    square: !shape.info,
    rowGutter: posterGutterFor(shape),
    itemHeightEstimate: gridSize + (shape.info ? infoBlock : 0),
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
  let revealKey: string | number | null = null;
  let revealSeq = 0;
  let lastItems: any;
  let itemsKeySeq = 0;
  let paintSeq = 0;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of [...subs]) {
      try {
        cb();
      } catch (_e) {
        /* 握りつぶす */
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
      revealIndex: revealKey == null ? null : items.findIndex((item, index) => config?.keyOf(item, index) === revealKey),
      revealSeq,
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
    reveal(key: string | number) {
      revealKey = key;
      revealSeq++;
      notify();
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
        /* 握りつぶす */
      }
    }
  };
  subscribeKeys(['trashGroups', ...DISPLAY_KEYS, 'gridSize'], notify);
  function computeModel(): HologramGridModel | null {
    if (!config) return null;
    const items = store.getState().trashGroups;
    if (items == null) return null; // undefined（一度も読み込んでいない）または明示的な null（ゴミ箱が空）
    if (items !== lastItems) {
      lastItems = items;
      itemsKeySeq++;
    }
    return {
      ...postLayout(currentShape(), store.getState().gridSize),
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
