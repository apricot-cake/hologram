// 両方のグリッドのサイズの軸と、表示の変更の副作用＝旧 viewer.ts のモノリスから
// 切り出したもの。
// 投稿グリッドと投稿者グリッドは、それぞれ自前の密度とサイズの状態
// （viewSizeState/posterSizeState、tileGridMetrics/posterGridMetrics）を持ち、同じ
// geometry.ts の計算（colsFor/sizeFor/sliderTrack/trackCols）を駆動していた＝この
// モジュールが両方の唯一の持ち主で、viewer.ts にあったほぼ重複の2つの複製を置き換える。
// サイズの操作そのものは React の表示ポップオーバー（#154 P2②）。あちらが
// computeSizeTrack/computePosterSizeTrack をデータとして読み、setter を呼び返すので、
// ここがスライダーの要素に触れることはない。
//
// どちらのグリッドの表示の形もここには無い。それらは services/display.ts が持つ直交した
// ストアのキー＝投稿は3つ（#618）、投稿者は2つ（#630）。このモジュールはそれに反応するだけ＝
// 永続化し、新しい形が許す範囲へサイズを引き戻し、描画し直す。
import { clampGridSize, clampPosterGridSize, currentPosterShape, currentShape, GRID_MAX, gridMin, gutterFor, LIST_MAX, LIST_MIN, POSTER_GRID_MAX, posterGridMin, posterGutterFor, posterShapeSnapshot, shapeSnapshot } from './display.ts';
import { gridWidth, scroller } from './content-area.ts';
import { sizeFor, sliderTrack, trackCols, thumbW } from './geometry.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';
import { store } from './store.ts';
import { resolveZoomAnchor } from './zoom-anchor.ts';
import type { ZoomAnchor } from './zoom-anchor.ts';
import type { AppPrefs } from '../../../main/ipc-payloads.ts';

export interface GridDensityDeps {
  hologramIpc: { setPref(key: string, value: unknown): void };
  hologramPostGridSource: { setLiveColumnWidth(px: number | null): void; setZoomAnchor(anchor: ZoomAnchor | null): void };
  renderPosts(inPlace?: boolean): void;
  renderPosters(): void;
}

// サイズスライダーのトラックを、React が駆動する操作のためのデータとして表したもの。
// 自動で埋めるビューでは範囲が列数になる（min＝最も少ない＝タイルが最も大きい … max＝
// 最も多い＝最も小さい）。一覧では素のサムネイルの px。`single` は、幾何的に取りうる
// 位置が1つしかないことを表す＝呼び出し側はその操作を隠す（何も伝えないため）。
export interface HologramSizeTrack {
  min: number;
  max: number;
  value: number;
  step: number;
  single: boolean;
}

// サイズのトラックが写り込む3つのストアのキー。設定の名前も兼ねる（3つとも設定の名前と
// ストアのキーが同じ語）。そしてどれも数値を持つ＝だから、ストアの型を緩めずに、計算した
// キー経由で確定したサイズを書き込める。
type HologramSizeKey = 'gridSize' | 'listThumb' | 'posterGridSize';

// viewSizeState/posterSizeState が返すもの＝生きている値、その範囲、確定した値の行き先。
// 名前を付けてあるのは、この2つのリテラルが string へ広がらず HologramSizeKey のまま
// 型付けされるようにするため。
interface SizeState {
  get(): number;
  set(v: number): void;
  min: number;
  max: number;
  pref: HologramSizeKey;
  columns?: boolean;
}

export function makeGridDensity(deps: GridDensityDeps) {
  // --- 投稿グリッド。サイズの状態（表示の形は display.ts にある） ---
  let gridSize = 280; // グリッド＝列の幅の px（設定 gridSize）
  let listThumb = 88; // 一覧＝サムネイルの幅の px（設定 listThumb）

  // サムネイルの幅はセルに追従し、セルが大きくなっても鮮明さを保つ（60px のバケット）。
  // 画質は形の軸に従う（2026-07-19 に確定）。正方形のセルは thumbnailer が配る切り抜いた
  // 静止画で、元の縦横比のセルは従来どおりのカード（DPR を見て、thumbnailer の上限 720px で
  // 頭打ち＝main.js の getThumbnail）。どちらの下限も、その軸が許す最小のセル以下に置いて
  // ある。thumbnailer は 64px から配るので、main 側は何も変わらない。
  const _dpr = Math.min(2, window.devicePixelRatio || 1);
  const gridThumbW = () => (currentShape().square ? thumbW(gridSize * 1.4, 120, 960) : thumbW(gridSize * 1.3 * _dpr, 240, 720));
  const listThumbW = () => thumbW(listThumb * 1.5 * _dpr, 120, 720);

  // ビューのサイズのスライダー。どちらの配置にもある。グリッドは実際の幅を「何列入るか」へ
  // 量子化するので、そのトラックは列数に対応する（1目盛りがちょうど1列で、無駄な刻みが
  // 無い）。一覧は全幅の積み重ねなので、そのトラックはサムネイルの px にそのまま対応する。
  // 右が大きい。ドラッグ中に更新されるのは生きている列の幅だけで、永続化とサムネイルの
  // 取り直しは指を離した時に起きる。
  function viewSizeState(): SizeState {
    const shape = currentShape();
    if (shape.list)
      return {
        get: () => listThumb,
        set: (v: number) => {
          listThumb = v;
        },
        min: LIST_MIN,
        max: LIST_MAX,
        pref: 'listThumb',
        columns: false,
      };
    return {
      get: () => gridSize,
      set: (v: number) => {
        gridSize = v;
      },
      // 下限は「情報を表示」のスイッチに連動する。素のセルは俯瞰のズームまで下がれるが
      // （#141）、メタデータの塊を載せたセルは下がれない。
      min: gridMin(shape.info),
      max: GRID_MAX,
      pref: 'gridSize',
      columns: true,
    };
  }

  function setViewSize(px: number, commit = true) {
    const st = viewSizeState();
    st.set(Math.max(st.min, Math.min(st.max, px)));
    if (!commit) {
      // ドラッグ中の実時間の再配置（masonic は columnWidth が変わると positioner を
      // 作り直す）は、hologramStore ではなく意図した脇道を通す＝ドラッグの入力を毎回
      // ストアへ書くと、pointermove のたびに再計算と通知が走り、何の得も無い。
      if (st.columns) deps.hologramPostGridSource.setLiveColumnWidth(st.get());
      return;
    }
    deps.hologramIpc.setPref(st.pref, st.get());
    // 確定したサイズは hologramStore へ写る＝投稿グリッドの source が、そこから
    // columnWidth/itemHeightEstimate を導く。ドラッグ中の上書きは消しておく。そうしないと、
    // 後のビューの変更（別のキーを読む）が古い値を見てしまう。
    store.setState({ [st.pref]: st.get() });
    deps.hologramPostGridSource.setLiveColumnWidth(null);
    // その場での再配置。サイズの変更は同じ投稿の集合を並べ直すだけ。ここでのフラグの意味は
    // それ＝約9千件のレコードを絞り込み直さずグループ化済みの集合を使い回し、登場の
    // アニメーションも飛ばす。これが無いと、ズームの1目盛りごと（そしてスライダーを離す
    // たび）にカードの導入が再生され、グリッドが足元で更新されているように見える。
    // サムネイルは新しいサイズで戻ってくる。確定したサイズは上でストアへ入り、グリッドの
    // source がそこから各カードのモデル（tileThumbW）を導き直すため。
    deps.renderPosts(true);
  }

  // グリッド自身の箱を実測したもの。溝は計算済みスタイルではなく、配置自身の定数＝隙間を
  // 描くのは masonic で、入れ物には隙間が無い。
  function postGridMetrics(): HologramGridMetrics | null {
    const W = gridWidth('post');
    if (!W) return null;
    return { W, g: gutterFor(currentShape()) };
  }

  let _dragMetrics: HologramGridMetrics | null = null; // サイズのドラッグ1回の間だけキャッシュするグリッドの寸法

  // サイズスライダーのトラックをデータとして表したもの（React の表示ポップオーバーが
  // これを読む。旧 #tileSlider の DOM の経路は無くなった）。グリッドは列数のトラック
  // （1目盛り＝1列で、無駄な刻みが無い）、一覧は素の px。
  function computeSizeTrack(): HologramSizeTrack | null {
    const st = viewSizeState();
    if (!st.columns) return { min: st.min, max: st.max, value: st.get(), step: 8, single: false };
    const m = postGridMetrics();
    if (!m) return null;
    // 元の縦横比のセルはグリッドと同じ幅まで広げてよい（1列は、風変わりではあっても正当な
    // 読みやすさの幅）。一方、巨大なタイル1つだけの正方形の格子は、もはや格子ではない。
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m, currentShape().square ? undefined : { minCols: 1 });
    return { min: tr.nBig, max: tr.nSmall, value: tr.value, step: 1, single: tr.single };
  }

  // スライダーの値を適用する（#tileSlider の代わりに、ポップオーバーの Slider がこれを
  // 駆動する）。ドラッグの途中（commit=false）はキャッシュした寸法を使い回し、生きている
  // 列の幅を更新する。確定時は永続化してサムネイルを取り直す。min/max は呼び出し側が最後に
  // 読んだトラックのものなので、列の反転の戻しがずれない。
  function setSizeFromSlider(value: number, min: number, max: number, commit: boolean) {
    const st = viewSizeState();
    if (!st.columns) {
      setViewSize(value, commit);
      return;
    }
    const m = (!commit && _dragMetrics) || postGridMetrics();
    if (!m) return;
    _dragMetrics = commit ? null : m;
    setViewSize(sizeFor(trackCols(value, min, max), m), commit);
  }

  // Ctrl+- / Ctrl+= は、今出ているグリッド（投稿グリッドでも投稿者グリッドでも）で
  // コンテンツのサイズを1目盛り動かす。動かすのは表示ポップオーバーの Slider が読むのと
  // 同じトラック＝突くべきスライダーの要素はもう無い。登録は GlobalShortcuts
  // コンポーネント（app/App.tsx）にある。
  //
  // #246: この2つの和音は今、登録簿の中で個別に付け替えできる別々のコマンドとして存在する
  // （サイズを上げる／下げる）。ここに残るのは防ぎと目盛りのロジック。どちらの和音も
  // ignoreShift（元の実装も e.shiftKey を見ていなかった）＝'+' は shortcut-registry.ts の
  // normalizeKey で '=' に正規化されるので、物理的な Numpad+ でも Shift+= でも、今までどおり
  // サイズを上げるコマンドに着く。
  //
  // preventDefault は、入力の焦点の防ぎを通った時点ですぐ走る。元の実装と同じ＝その目盛りで
  // 実際に何かが動くか（ここにサイズの軸が存在し、しかも既に min/max の端に張り付いていないか）を
  // 決めるのは防ぎではなく操作の中。
  function stepSize(dir: 1 | -1) {
    const posters = store.getState().browseMode === 'posters';
    const tr = posters ? computePosterSizeTrack() : computeSizeTrack();
    // ここにサイズの軸が無い（投稿者の一覧ビュー）か、幾何的に取りうる位置が1つしかない。
    if (!tr || tr.single) return;
    const next = Math.max(tr.min, Math.min(tr.max, tr.value + dir * tr.step));
    if (next === tr.value) return;
    if (posters) setPosterSizeFromSlider(next, tr.min, tr.max);
    else setSizeFromSlider(next, tr.min, tr.max, true);
  }
  function canExecuteSizeStep(e: KeyboardEvent) {
    return !isTypingTarget(e);
  }
  registerShortcut({ id: 'grid.sizeIncrease', titleKey: 'shortcutSizeIncrease', defaultCombo: 'Ctrl+=', ignoreShift: true, canExecute: canExecuteSizeStep, perform: () => stepSize(1) });
  registerShortcut({ id: 'grid.sizeDecrease', titleKey: 'shortcutSizeDecrease', defaultCombo: 'Ctrl+-', ignoreShift: true, canExecute: canExecuteSizeStep, perform: () => stepSize(-1) });

  function handleShortcutSizeKey(e: KeyboardEvent) {
    if (tryRun('grid.sizeIncrease', e)) return;
    tryRun('grid.sizeDecrease', e);
  }

  // Ctrl＋ホイールは同じトラックを1目盛り動かす（エクスプローラーの標準。トラックパッドの
  // ピンチは合成された ctrlKey 付きのホイールとして届くので、これもここに来る）。キーボードの
  // 目盛りと違い、こちらはカーソルの下の投稿をその場に留める＝それがズームの要点で、これが
  // 無いと俯瞰のサイズまで引いた時に、利用者はライブラリの別の場所へ放り出される。登録は
  // 非 passive（GlobalShortcuts、App.tsx）。下の preventDefault が Chromium 自身のページの
  // ズームを止める。
  //
  // その位置を保つ処理はここでは行わない（#282）。このモジュールが知っているのはサイズの
  // 軸だけで、新しいサイズがどの投稿をどこへ置くかは知らない。それを突き止めるために以前
  // やっていたこと＝DOM でカードを探し、1フレーム待ち、ずれていたら scrollTop を押し戻す＝は
  // どれも、別の場所で計算された配置についての当て推量だった。だからズームは、留めるべき投稿を
  // 名指しするだけにする（services/zoom-anchor.ts がグリッドの島に尋ね、島は自分の配置の
  // モデルから答える）。そのアンカーを新しいサイズと一緒に渡し、島が、再配置と同じ層・同じ
  // コミットの中で位置を合わせる。
  let _zoomCommitT: any = null;
  // 1回のまとまりにつき最初の目盛りで1度だけ解決する。目盛りごとに読み直すと、再配置ごとの
  // 丸めが積み重なる。最初のものを保つことで、長く引いた時のどの目盛りでも、同じ投稿を画面の
  // 同じ高さに狙い続けられる。
  let _zoomAnchor: ZoomAnchor | null = null;

  // 俯瞰の尺度ではサイズの適用が高くつく＝masonic は窓全体にわたって positioner を組み直し、
  // タイルが小さくなると窓は数百セルになる（9千件のライブラリで実測: 200px で1目盛り約50ms、
  // 48px で約200ms）。ホイールはそれよりずっと速く目盛りを届けるので、イベントごとに適用すると
  // 利用者が回している間ずっとメインスレッドが塞がる。代わりに目盛りを溜め、1フレームにつき
  // 1回だけ適用する。サイズはホイールに追従したまま、速く引いた時の配置の回数は、クリック
  // ごとに1回ではなく数回で済む。
  let _zoomNotches = 0;
  let _zoomRaf: any = null;
  // このまとまりで実際にサイズが動いたか。トラックのどちらの端でも目盛りは何もしないが、
  // 下の確定処理はそれでもコミットしてしまう＝コミットはグリッドを描き直し、サムネイルを
  // すべて取り直す。限界を越えてスクロールし続けた時に見える「更新」がそれなので、何かが
  // 変わっていない限り確定処理は飛ばす。
  let _zoomChanged = false;

  // 値が同じでも毎回新しいオブジェクトを作る。グリッドの島はアンカーの同一性で構え直し、
  // 下の適用はそれぞれ別の再配置で、その間ずっと位置を保ち続ける必要があるため。
  function pushZoomAnchor(a: ZoomAnchor | null) {
    deps.hologramPostGridSource.setZoomAnchor(a && { ...a });
  }

  function applyPendingZoom() {
    _zoomRaf = null;
    const notches = _zoomNotches;
    _zoomNotches = 0;
    if (!notches) return;
    const posters = store.getState().browseMode === 'posters';
    const tr = posters ? computePosterSizeTrack() : computeSizeTrack();
    if (!tr || tr.single) return;
    const next = Math.max(tr.min, Math.min(tr.max, tr.value + notches * tr.step));
    if (next === tr.value) return;
    if (posters) {
      setPosterSizeFromSlider(next, tr.min, tr.max);
      return;
    }
    // アンカーが先。再配置を引き起こすのはサイズの変更で、島は、その再配置が描画の元に
    // するモデルそのものからアンカーを読むため。
    pushZoomAnchor(_zoomAnchor);
    setSizeFromSlider(next, tr.min, tr.max, false);
    _zoomChanged = true;
  }

  function handleZoomWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !e.deltaY) return;
    const el = scroller();
    if (!el || !el.contains(e.target as Node)) return;
    e.preventDefault();
    // ホイールを上げる＝ズームイン＝タイルが大きい＝列が少ない。トラックは既にそう反転して
    // いるので、正の目盛りはそのまま「大きく」を意味する。
    _zoomNotches += e.deltaY < 0 ? 1 : -1;
    // イベントの時点では、カーソルの下にあるものは必ず画面に出ている。だからグリッドの島は
    // 常に答えられる＝待つ必要も、配置が動いた後に読み直す必要も無い。
    if (!_zoomAnchor) _zoomAnchor = resolveZoomAnchor(e.clientX, e.clientY);
    if (_zoomRaf == null) _zoomRaf = requestAnimationFrame(applyPendingZoom);
    // 上のフレームは生きたまま動く（CSS の変数と列の幅だけ）。サイズが確定するのは、ホイールが
    // 止まった後の1回だけ＝目盛りごとにコミットすると、クリックのたびにサムネイルを全部
    // 取り直すことになる。まだフレームを待っている目盛りがあれば先に流し切る。そうしないと、
    // フレームの途中で終わったまとまりが、自分の最後の目盛りより前のサイズで確定してしまう。
    clearTimeout(_zoomCommitT);
    _zoomCommitT = setTimeout(() => {
      if (_zoomRaf != null) {
        cancelAnimationFrame(_zoomRaf);
        applyPendingZoom();
      }
      const posters = store.getState().browseMode === 'posters';
      // 下で何が起きようと、このまとまりはここで終わる。次のまとまりは、その時カーソルが
      // ある場所から自分のアンカーを解決する。
      const ending = _zoomAnchor;
      _zoomAnchor = null;
      if (posters) return; // 投稿者側の経路は1目盛りごとにコミットする
      if (!_zoomChanged) return; // トラックの端に張り付いている＝永続化するものも描き直すものも無い
      _zoomChanged = false;
      const settled = computeSizeTrack();
      if (!settled) return;
      // コミットはグリッドを描き直し（renderPosts）、新しい項目の集合は positioner を
      // 初期化する＝位置の保持が生き延びなければならない2回目の再配置。だから島には推測を
      // させず、同じアンカーをもう一度渡す。
      pushZoomAnchor(ending);
      setSizeFromSlider(settled.value, settled.min, settled.max, true);
    }, 150);
  }

  // 表示のスイッチは表示ポップオーバーにあり、あちらは services/display.ts の3つのストアの
  // キーだけを書く。そのどれかが変わった時に払うのがこれ＝永続化し、新しい形が許す範囲へ
  // サイズを引き戻し、描画し直す。subscribe() の登録は React が持ち（StoreSubscriptions、
  // App.tsx）、この関数を直接 import する（viewer.ts がモジュールスコープの export へ結ぶ）。
  // 描画のやり直しは1回描いた後へ回す。押された操作が先に新しい状態を描き、その後で（より
  // 重い）グリッドのグループ化し直しが走るようにするため＝旧密度のハンドラが使っていた、
  // 押下に先に反応する形。
  let _shapeSig = shapeSnapshot();
  let _displayRenderT: ReturnType<typeof setTimeout> | undefined;
  let _restoring = false; // restorePrefs は保存した形を押し込む。それは利用者による変更ではない
  function handleDisplayStoreChange() {
    if (_restoring) return;
    const sig = shapeSnapshot();
    if (sig === _shapeSig) return;
    _shapeSig = sig;
    const shape = currentShape();
    deps.hologramIpc.setPref('layoutMode', shape.list ? 'list' : 'grid');
    deps.hologramIpc.setPref('squareThumbs', shape.square);
    deps.hologramIpc.setPref('showInfo', shape.info);
    deps.hologramIpc.setPref('showAvatar', shape.avatar);
    // 「情報を表示」はグリッドの下限を上げるので、俯瞰のサイズにいるグリッドはそれに
    // つられて上がる必要がある。そうしないとメタデータの塊が 48px の列に描かれてしまう。
    if (!shape.list) {
      const clamped = clampGridSize(gridSize, shape.info);
      if (clamped !== gridSize) {
        gridSize = clamped;
        store.setState({ gridSize: gridSize });
        deps.hologramIpc.setPref('gridSize', gridSize);
      }
    }
    clearTimeout(_displayRenderT);
    _displayRenderT = setTimeout(() => deps.renderPosts(), 0);
  }

  // --- 投稿者グリッド。サイズの状態（表示の形は display.ts にある。#630） ---
  // 投稿側とは分けてある。投稿者の軸は3つではなく2つなので、キーを1つ共有すると投稿者
  // モードで「正方形」が未定義のまま残ってしまう。
  let posterGridSize = 200; // グリッド＝列の幅の px（設定 posterGridSize）

  // スライダーが駆動するサイズ。投稿側とまったく同じく、配置ごとに1つ。グリッドには列の幅が
  // あり、一覧には無い（投稿者の行は決まった1行＝GitHub の貢献者の行にもサイズの操作は
  // 無い）。だから一覧は null を返し、呼び出し側がスライダーを隠す。
  function posterSizeState(): SizeState | null {
    if (currentPosterShape().list) return null;
    return {
      get: () => posterGridSize,
      set: (v: number) => {
        posterGridSize = v;
      },
      // 下限は投稿グリッドと同じく「情報を表示」に連動する。素のセルはアイコンだけなので
      // 俯瞰のズームまで下がれるが、メタデータの塊があるセルは下がれない。
      min: posterGridMin(currentPosterShape().info),
      max: POSTER_GRID_MAX,
      pref: 'posterGridSize',
    };
  }

  // スライダーのトラックは素の px ではなく列数に対応する（投稿のタイルのスライダーと同じ）。
  // 自動で埋める minmax(size,1fr) のグリッドは列を伸ばすので、最小値を変えても、配置が動くのは
  // 列数のしきい値のところだけ。右が大きい＝列が少ない。
  function posterGridMetrics(): HologramGridMetrics | null {
    const W = gridWidth('poster');
    if (!W) return null;
    // 溝は今や入れ物の CSS ではなく masonic のモデルにある（services/grid.ts）＝式は1つで、
    // 両方が display.ts から読む。
    return { W, g: posterGutterFor(currentPosterShape()) };
  }

  // 投稿者のサイズスライダーのトラックをデータとして表したもの（computeSizeTrack の鏡）。
  // 一覧ビューではサイズの軸が無いので null → 呼び出し側がその操作を隠す。
  function computePosterSizeTrack(): HologramSizeTrack | null {
    const st = posterSizeState();
    if (!st) return null;
    const m = posterGridMetrics();
    if (!m) return null;
    const tr = sliderTrack({ min: st.min, max: st.max, size: st.get() }, m);
    return { min: tr.nBig, max: tr.nSmall, value: tr.value, step: 1, single: tr.single };
  }

  // 投稿者のスライダーの値を適用する（ポップオーバーの Slider がこれを駆動する）。投稿者
  // グリッドは1目盛りごとにコミットする＝ドラッグ中と確定時を分けない。どちらにせよ
  // masonic は columnWidth の変更で positioner を作り直すため。`value` は反転している
  // （右が大きい）ので、呼び出し側が最後に読んだトラックの min/max と一緒に trackCols を通す。
  function setPosterSizeFromSlider(value: number, min: number, max: number) {
    const st = posterSizeState();
    const m = posterGridMetrics();
    if (!st || !m) return;
    const size = Math.max(st.min, Math.min(st.max, sizeFor(trackCols(value, min, max), m)));
    st.set(size);
    // hologramStore へ写す＝投稿者グリッドの source がそこから columnWidth を導く。
    // 投稿グリッドが gridSize でやっているのと同じ。
    store.setState({ [st.pref]: size });
    deps.hologramIpc.setPref(st.pref, size);
  }

  // 投稿者の表示のスイッチは表示ポップオーバーにあり、あちらは services/display.ts の投稿者の
  // 2つのキーだけを書く（#630）。そのどちらかが変わった時に払うのがこれ＝上の
  // handleDisplayStoreChange の投稿者側の双子。永続化し、新しい形が許す範囲へサイズを引き
  // 戻し、描画し直す。subscribe() の登録は React が持ち（StoreSubscriptions、App.tsx）、この
  // 関数を直接 import する。押された操作がグループ化し直しより先に描かれるよう、1回描いた
  // 後へ回す。
  let _posterShapeSig = posterShapeSnapshot();
  let _posterDisplayRenderT: ReturnType<typeof setTimeout> | undefined;
  function handlePosterDisplayStoreChange() {
    if (_restoring) return;
    const sig = posterShapeSnapshot();
    if (sig === _posterShapeSig) return;
    _posterShapeSig = sig;
    const shape = currentPosterShape();
    deps.hologramIpc.setPref('posterLayoutMode', shape.list ? 'list' : 'grid');
    deps.hologramIpc.setPref('posterShowInfo', shape.info);
    if (!shape.list) {
      const clamped = clampPosterGridSize(posterGridSize, shape.info);
      if (clamped !== posterGridSize) {
        posterGridSize = clamped;
        store.setState({ posterGridSize: posterGridSize });
        deps.hologramIpc.setPref('posterGridSize', posterGridSize);
      }
    }
    clearTimeout(_posterDisplayRenderT);
    _posterDisplayRenderT = setTimeout(() => deps.renderPosters(), 0);
  }

  // 保存した表示の形とサイズを読み込む（viewer.ts の getPrefs().then から呼ばれる）。
  // 3つの表示のキーはストアへ直接入る＝ポップオーバーも描画側も、そこから読むため。その間は
  // handleDisplayStoreChange を黙らせる。復元は利用者による変更ではないし、通してしまうと
  // 形をキー1つずつ書き戻し、半分だけ適用された形に対してサイズを丸めてしまう。
  function restorePrefs(prefs: AppPrefs) {
    _restoring = true;
    try {
      store.setState({ layout: prefs.layoutMode === 'list' ? 'list' : 'grid' });
      store.setState({ squareThumbs: prefs.squareThumbs === true });
      store.setState({ showInfo: prefs.showInfo !== false });
      store.setState({ showAvatar: prefs.showAvatar !== false });
      store.setState({ posterLayout: prefs.posterLayoutMode === 'list' ? 'list' : 'grid' });
      store.setState({ posterShowInfo: prefs.posterShowInfo !== false });
    } finally {
      _restoring = false;
      _shapeSig = shapeSnapshot();
      _posterShapeSig = posterShapeSnapshot();
    }
    // 投稿者グリッドのサイズも hologramStore へ写す。上のブロックが今戻したばかりの
    // 「情報を表示」のスイッチに対して丸めた上で。
    if (Number.isFinite(prefs.posterGridSize)) {
      posterGridSize = clampPosterGridSize(prefs.posterGridSize as number, currentPosterShape().info);
      store.setState({ posterGridSize: posterGridSize });
    }
    // 投稿グリッドのサイズも hologramStore へ写る（setViewSize を参照）。グリッドの保存
    // された幅は、今の「情報を表示」のスイッチに対して丸める。そのスイッチは上のブロックが
    // 既に戻している。
    if (Number.isFinite(prefs.gridSize)) {
      gridSize = clampGridSize(prefs.gridSize as number, currentShape().info);
      store.setState({ gridSize: gridSize });
    }
    if (Number.isFinite(prefs.listThumb)) {
      listThumb = Math.max(LIST_MIN, Math.min(LIST_MAX, prefs.listThumb as number));
      store.setState({ listThumb: listThumb });
    }
  }

  return {
    gridThumbW,
    listThumbW,
    computeSizeTrack,
    setSizeFromSlider,
    handleShortcutSizeKey,
    handleZoomWheel,
    handleDisplayStoreChange,
    computePosterSizeTrack,
    setPosterSizeFromSlider,
    handlePosterDisplayStoreChange,
    restorePrefs,
  };
}
