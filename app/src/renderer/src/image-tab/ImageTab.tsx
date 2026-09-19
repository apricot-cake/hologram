import { copyImage, copyableImages } from '../services/image-copy.ts';
import { fileOfSrc } from '../services/asset-src.ts';
import { open as openMenu } from '../services/menu.ts';
import { t } from '../_shared/i18n.ts';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Crop, ImageOff, Info } from 'lucide-react';
import ReactCrop, { type PercentCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PLATE, PLATE_SURFACE } from './plate.ts';
import { fromPercentCrop, toPercentCrop } from './crop.ts';
import { UgoiraPlayer } from './UgoiraPlayer.tsx';
import { createNeighborPreloader, neighborPreloadSources, type NeighborPreloader } from './preload.ts';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { MAX_SCALE, MIN_SCALE, ZOOM_MS, FIT_MS, actualScaleOf, actualTarget, fitToggleTarget, isAtFit, publish as publishZoom, register as registerZoom, steppedScale, zoomPercentOf } from '../services/image-zoom.ts';
import { getState as getOverlayState, reset as resetOverlay, subscribe as subscribeOverlay } from '../services/image-overlay.ts';

// ホイールズームの調整（#134）: マウスホイールの1ノッチ（deltaY~100）は倍率に
// ZOOM_STEP を掛ける。掛け算にしてあるのは、1倍でも30倍でも1ノッチの効きを同じに
// 感じさせるため＝以前の足し算の刻み（1ノッチにつき +1）は1倍では画像を2倍にし、
// 高倍率ではほとんど動かなかった。1ノッチごとに ZOOM_MS かけて緩む。定数と計算は、
// ツールバーの ± がこれを共有し始めた時点で services/image-zoom.ts へ移した（#150）
// ＝ホイールとボタンで段は1つ。

// viewer.js（renderImageTabView）が組み立てるモデル。投稿グループ1つ分のギャラリー
// 項目、制御される添字、タブ単位の操作を持つ。ズーム・パンの状態はこのコンポーネントの
// 中に留まる（一時的なもの＝key によってスライドごとにウィンドウ合わせの状態で載せ直る）。
export interface ImageTabItem {
  src: string;
  video?: boolean;
  alt?: string;
  // pixiv のうごイラの書庫。ライブラリ内のファイル名と、再生に使うフレーム表を持つ
  // （#119 St3）。書庫が開くまでは `poster` が代役を務める。
  ugoira?: { file: string; frames: { file: string; delay: number }[] };
  poster?: string;
  postId?: string;
  mediaSeq?: number;
  crop?: CropRect | null;
  width?: number;
  height?: number;
}
export type CropRect = import('../../../../../native-host/post-schemas.mts').CropRectShape;
export interface ImageTabModel {
  positionLabel?: string;
  // 今表示しているタブ自身の id（#80）＝image-tab/index.tsx が <ImageTab> の key に
  // これを使う。だから画像タブから別の画像タブへ直接切り替えると（どちらも既に画像
  // ビューを出している）、このコンポーネントは使い回されずに載せ直される。それが
  // オーバーレイの切り替え（services/image-overlay.ts）をリセットし、タブをまたいで
  // 漏れるのを防いでいる。
  tabId: string;
  items: ImageTabItem[];
  idx: number;
  missing?: boolean;
  inspectorOpen?: boolean;
  labels: Record<string, string>;
  onIndexChange?: (i: number) => void;
  onToggleInspector?: () => void;
  onCloseTab?: () => void;
  onSetCrop?: (postId: string, mediaSeq: number, crop: CropRect | null) => Promise<boolean>;
}

// Eagle 風のズーム・パンを持つ画像1枚（react-zoom-pan-pinch）。ホイールでカーソル位置を
// 軸にズーム、ドラッグでパン、ダブルクリックで原寸 ⇄ ウィンドウ合わせ。親は src を key に
// しているので、スライドが変わるとウィンドウ合わせの倍率で載せ直る。
// 三分割のグリッド（#80）。オーバーレイは1要素（設計の「重ねる線1要素」）で、線の div を
// 4つ並べるのではなく2枚のグラデーションとして描く。mix-blend-mode: difference は各線の
// 下に画像が見せている色に対して反転するので、ほぼ白の線1本で黒い夜空でも白い紙面でも
// 読める＝画像ごとに色を選ぶ必要がない。
const THIRDS_GRID_LINES = [
  'linear-gradient(to right, transparent calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 + 0.5px), transparent calc(100%/3 + 0.5px), transparent calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 + 0.5px), transparent calc(200%/3 + 0.5px))',
  'linear-gradient(to bottom, transparent calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 + 0.5px), transparent calc(100%/3 + 0.5px), transparent calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 + 0.5px), transparent calc(200%/3 + 0.5px))',
].join(', ');

function Zoomable({ src, alt, flip, gray, grid, crop, sourceWidth, sourceHeight }: { src: string; alt: string; flip: boolean; gray: boolean; grid: boolean; crop?: CropRect | null; sourceWidth?: number; sourceHeight?: number }) {
  const twRef = useRef<ReactZoomPanPinchRef | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  // ダブルクリックでのウィンドウ合わせ切り替えの防ぎ（#134 の後続）。素早いパンを2回
  // 続けると Chrome のダブルクリック判定（押下の間隔が 4px ほど・500ms）に入ってしまい、
  // 以前はパンの途中でズームした表示がウィンドウ合わせへ引き戻されていた。動きを伴った
  // 「クリック」はパンの一筆であって、ダブルクリックの片割れではない＝それを記録し、
  // onDouble にはその後ろに続くダブルクリックを無視させる。
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const dragEndAt = useRef(0);
  // 積み上げたズームの目標値。刻みは生きている倍率ではなく、必ずこの値から連なる。
  // 生きている値はホイールが回っている間は補間の途中なので、そこから刻むと1ノッチ分が
  // 部分的に呑まれ、ズームの合計がホイールを回す速さに左右されてしまった。null は同期が
  // 切れた状態（ウィンドウ合わせ・原寸へ跳ぶと刻みの段から外れる）→ 生きている倍率から
  // 種を入れ直す。ツールバーの ± も同じ ref から連なる（#150）＝＋ボタンの連打は速い
  // ホイールと同じ積み上げの問題であり、蓄積器が2つあると補間を取り合ってしまう。
  const zoomTarget = useRef<number | null>(null);
  // 倍率の変更とアンカーを1か所にまとめる。ホイールはカーソルを、ツールバーの ± は
  // ステージの中央をアンカーにする。生きている bounding rect ではなくインスタンスの
  // state を読むことが、アニメーションの途中でもこれを正確にしている＝下の #134 を参照。
  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
    const tw = twRef.current;
    const wrapper = tw?.instance.wrapperComponent;
    if (!tw || !wrapper) return;
    const { scale, positionX, positionY } = tw.instance.state;
    const wr = wrapper.getBoundingClientRect(); // 動かない要素＝トランジション中でもずれない
    const ax = clientX ?? wr.left + wr.width / 2;
    const ay = clientY ?? wr.top + wr.height / 2;
    // 倍率が変わっても、アンカーの下にある内容の点を動かさない。
    const cx = (ax - wr.left - positionX) / scale;
    const cy = (ay - wr.top - positionY) / scale;
    // 内容の箱は wrapper を 1:1 で埋める（contentStyle 100%）ので、境界は wrapper の
    // 寸法に対して直接丸める（disablePadding と揃えている）。
    const nx = Math.min(0, Math.max(wr.width - wr.width * next, ax - wr.left - cx * next));
    const ny = Math.min(0, Math.max(wr.height - wr.height * next, ay - wr.top - cy * next));
    tw.setTransform(nx, ny, next, ZOOM_MS, 'easeOut');
  }, []);
  // ツールバーが表示する数値を送り出す。ライブラリの onTransform がアニメーションの
  // フレームごとに呼び、レイアウト上の幅が動きうるとき（画像の読み込み、ステージの
  // 寸法変更）にも改めて呼ぶ。百分率は 倍率 × レイアウト上の幅 ÷ 本来の幅 なので、
  // 3つの入力すべてがこれを起こせなければならない。
  const publish = useCallback(() => {
    const tw = twRef.current;
    const img = imgRef.current;
    if (!tw || !img) return;
    const scale = tw.instance.state.scale;
    // ± ボタンの有効・無効は、生きている倍率ではなく積み上げた目標値で決める。補間の
    // 途中の値では、無効にした原因の刻みが着地する前にボタンが一瞬また有効に戻る。
    const base = zoomTarget.current ?? scale;
    publishZoom({ percent: zoomPercentOf(scale, img.offsetWidth, img.naturalWidth), atFit: isAtFit(scale), canZoomIn: base < MAX_SCALE, canZoomOut: base > MIN_SCALE });
  }, []);
  const step = useCallback(
    (dir: 1 | -1) => {
      const tw = twRef.current;
      if (!tw) return;
      const base = zoomTarget.current ?? tw.instance.state.scale;
      const next = steppedScale(base, dir);
      if (next === base) return;
      zoomTarget.current = next;
      zoomTo(next);
    },
    [zoomTo],
  );
  // resetTransform / centerView は刻みの段の外へ跳ぶので、通り道で蓄積器を消す
  // （下の3つとも）。
  const fit = useCallback(() => {
    const tw = twRef.current;
    if (!tw) return;
    zoomTarget.current = null;
    tw.resetTransform(FIT_MS);
  }, []);
  const actual = useCallback(() => {
    const tw = twRef.current;
    const img = imgRef.current;
    if (!tw || !img) return;
    zoomTarget.current = null;
    tw.centerView(actualTarget(actualScaleOf(img.naturalWidth, img.offsetWidth)), FIT_MS);
  }, []);
  const toggleFitActual = useCallback(() => {
    const tw = twRef.current;
    const img = imgRef.current;
    if (!tw || !img) return;
    const target = fitToggleTarget(tw.instance.state.scale, actualScaleOf(img.naturalWidth, img.offsetWidth));
    zoomTarget.current = null;
    if (target.fit) tw.resetTransform(FIT_MS);
    else tw.centerView(target.scale, FIT_MS);
  }, []);
  // ダブルクリックは同じ切り替えの、ジェスチャ側の半分（自前の防ぎは別として）。
  const onDouble = () => {
    if (performance.now() - dragEndAt.current < 400) return;
    toggleFitActual();
  };
  // このスライドが載っている間、操作をツールバー / Ctrl+0 / Ctrl+1 へ渡す。動画や
  // うごイラのスライドは Zoomable を一切描かないので、「何も登録されていない」が
  // そのまま「ズームするものがない」になる（services/image-zoom.ts）。
  useEffect(() => registerZoom({ step, toggleFitActual, fit, actual }), [step, toggleFitActual, fit, actual]);
  // 自前のホイールズーム。アニメーションはライブラリ自身の setTransform に任せる
  // （#134）。ライブラリはホイールの差分を即座に適用する。それを CSS のトランジションで
  // 緩めると、ライブラリのカーソルアンカーの計算が壊れた＝ライブラリは毎ティック内容の
  // 生きている bounding rect を読むが、トランジションの途中ではそれが state に遅れる
  // ので、アンカーがカーソルから数百 px ずれた。アンカーを効かせた目標値をインスタンスの
  // state から計算すれば、アニメーションの途中でも正確になる（アニメーターがフレーム
  // ごとに state と描画を揃えている）。しかも setTransform は、緩めることと前の補間を
  // 打ち切ることの両方をやる。
  useEffect(() => {
    const wrapper = twRef.current?.instance.wrapperComponent;
    if (!wrapper) return undefined;
    const onWheel = (e: WheelEvent) => {
      const tw = twRef.current;
      if (!tw) return;
      e.preventDefault();
      const base = zoomTarget.current ?? tw.instance.state.scale;
      const next = steppedScale(base, -e.deltaY / 100);
      if (next === base) return;
      zoomTarget.current = next;
      zoomTo(next, e.clientX, e.clientY);
    };
    // React は wheel を passive で付けるので、preventDefault には passive でない
    // ネイティブのリスナーが要る（でないとズームの裏でページがスクロールする）。
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [zoomTo]);
  // ステージは transform が動かないまま幅が変わりうるし（ウィンドウの寸法変更、詳細
  // パネルが開く）、百分率はその幅を基準に測っている。
  useEffect(() => {
    const img = imgRef.current;
    if (!img || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => publish());
    ro.observe(img);
    return () => ro.disconnect();
  }, [publish]);
  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = downPos.current;
    downPos.current = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) dragEndAt.current = performance.now();
  };
  const cropWidth = sourceWidth || naturalSize?.width;
  const cropHeight = sourceHeight || naturalSize?.height;
  const visibleCrop = crop && cropWidth && cropHeight ? crop : null;
  const cropAspect = visibleCrop && cropWidth && cropHeight ? `${cropWidth * visibleCrop.width}/${cropHeight * visibleCrop.height}` : undefined;
  return (
    // wheel.disabled: ホイールは上の自前のアンカー付きズームの effect が扱う。
    // ライブラリ自身の即時ホイール経路は切ったままにする。
    //
    // disablePadding: これが無いと、伸び縮みする余白のせいでカーソルを軸にした
    // ホイールの縮小が画像を横へ境界の外まで流し、ホイールが止まった後の位置合わせが
    // それを戻すアニメーションになる（「流れていって、家に引っ張り戻される」）。画像の
    // 端を越えてドラッグした場合も、離した瞬間に同じように中央へ跳ね返っていた。
    // ティックごとに境界へ丸めれば、どちらの動きも真っ直ぐになる。
    <TransformWrapper ref={twRef} minScale={MIN_SCALE} maxScale={MAX_SCALE} centerOnInit disablePadding doubleClick={{ disabled: true }} wheel={{ disabled: true }} onTransform={publish}>
      {/* 上のホイールのリスナーが付くのはこの wrapper なので、検証スクリプトがホイールの
          イベントを狙える名前が要る。キャストはこちらではなくライブラリの型付けの都合＝
          wrapperProps は React.HTMLAttributes として宣言されていて data-* の索引シグネチャ
          を持たない。オブジェクトは本物の <div> へ展開される。 */}
      <TransformComponent wrapperProps={{ 'data-slot': 'viewer-zoom-wrapper' } as HTMLAttributes<HTMLDivElement>} wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* decoding="async"（#241）: この <img> こそが画面そのものなので、同期デコードが
            歩調を合わせるべき「他の DOM の内容」が存在しない＝できるのは、フレーム（と
            送りのボタンと枚数表示）を数メガピクセルのデコードの人質に取ることだけ。
            グリッドのカードが既に出しているのと同じ答え。async がスライドの切り替えで
            残しうる空白の一瞬は、反対側から埋めている＝preload.ts が送りの前にデコードを
            温めておく。 */}
        {/* onTransform だけでなく onLoad も: 百分率は naturalWidth で割るが、本来の寸法が
            届くまでそれは 0 ＝画像が本当にそこに来た後の2度目が無ければ、最初の publish は
            何も表示できない。キャッシュ済みの画像なら、この要素が一度も transform しない
            うちに読み込みが終わっていることもある。 */}
        {/* pointer-events-auto! は飾りではない。react-zoom-pan-pinch 自身のスタイルシートが
            内容の箱の中のすべての <img> に pointer-events:none を置いていて（ネイティブの
            画像ドラッグ対策）、それが本物の入力に対して、ダブルクリックのウィンドウ合わせ
            切り替えとつかむカーソルの両方を黙って殺していた。あのシートはレイヤーに属さ
            ないので、どれだけ詳細度を上げてもレイヤー内のユーティリティより順位が上に
            なる＝そう書かれた第三者の規則に対して残された手が important 修飾子。ここで
            イベントを受け取っても安全なのは、そもそも画像が draggable={false} だから。 */}
        {/* #80 のグリッドは TransformComponent 自身の内容の div ではなく、この追加の
            wrapper に置く。img とオーバーレイが1つのグリッドのセルを共有するので
            （`display:grid` と同じ gridArea）、オーバーレイは img が実際に描かれた箱まで
            きっちり伸びる＝object-contain はより大きな箱の中で上下に余白を作りうるし、
            この wrapper はステージではなく img 自身の内容の箱に合わせて寸法が決まる
            （max-h/max-w だけで、明示的な寸法は無い）。別に測る必要はない。グリッドは
            Zoomable 限定（v1 の設計、#80 の 2026-07-17 修正 #2）＝動画・うごイラには
            吊るす先の Zoomable が無いので、このコンポーネントが載っていない間はツールバー
            がグリッドのボタンを無効にする（image-zoom.ts の `off`。もともと「このスライド
            には Zoomable が無い」と同じ合図）。左右反転とグレースケールは代わりに <img>
            自身へ直接かかる＝周りのステージではなく絵にかかるので、上の wrapper や内容の
            div にライブラリ自身がかける transform と争わずに、パン・ズームの下でも正しい
            ままでいる。 */}
        <div className="relative grid max-h-full max-w-full overflow-hidden" style={cropAspect ? { aspectRatio: cropAspect, width: '100%' } : undefined}>
          <img
            ref={imgRef}
            data-slot="viewer-image"
            style={
              visibleCrop
                ? {
                    gridArea: '1 / 1',
                    position: 'absolute',
                    width: `${100 / visibleCrop.width}%`,
                    height: `${100 / visibleCrop.height}%`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    left: `${(-visibleCrop.x / visibleCrop.width) * 100}%`,
                    top: `${(-visibleCrop.y / visibleCrop.height) * 100}%`,
                  }
                : { gridArea: '1 / 1' }
            }
            className={`pointer-events-auto! max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing ${flip ? 'scale-x-[-1]' : ''} ${gray ? 'grayscale' : ''}`}
            src={src}
            alt={alt}
            decoding="async"
            draggable={false}
            onLoad={(event) => {
              setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
              publish();
            }}
            onDoubleClick={onDouble}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
          />
          {grid && <div aria-hidden data-slot="viewer-grid-overlay" style={{ gridArea: '1 / 1', mixBlendMode: 'difference', backgroundImage: THIRDS_GRID_LINES }} className="pointer-events-none" />}
        </div>
      </TransformComponent>
    </TransformWrapper>
  );
}

function CropEditor({ src, alt, initial, labels, onApply, onCancel }: { src: string; alt: string; initial?: CropRect | null; labels: Record<string, string>; onApply: (crop: CropRect) => Promise<void>; onCancel: () => void }) {
  const [crop, setCrop] = useState<PercentCrop>(() => {
    const rect = initial ?? { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    return toPercentCrop(rect);
  });
  const [saving, setSaving] = useState(false);

  return (
    <div data-slot="crop-editor" className="absolute inset-0 z-3 flex items-center justify-center bg-black/85 p-12">
      <ReactCrop
        crop={crop}
        onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
        keepSelection
        minWidth={12}
        minHeight={12}
        className="max-h-full max-w-full"
        style={{ maxHeight: '100%' }}
        ariaLabels={{
          cropArea: labels.cropArea,
          nwDragHandle: labels.cropHandleNW,
          nDragHandle: labels.cropHandleN,
          neDragHandle: labels.cropHandleNE,
          eDragHandle: labels.cropHandleE,
          seDragHandle: labels.cropHandleSE,
          sDragHandle: labels.cropHandleS,
          swDragHandle: labels.cropHandleSW,
          wDragHandle: labels.cropHandleW,
        }}
        renderSelectionAddon={() => <span data-slot="crop-selection" />}
      >
        <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full object-contain" />
      </ReactCrop>
      <div className={`absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 rounded-lg border p-2 ${PLATE_SURFACE}`}>
        <Button variant="outline" disabled={saving} onClick={onCancel}>
          {labels.cropCancel}
        </Button>
        <Button
          disabled={saving}
          onClick={async () => {
            const rect = fromPercentCrop(crop);
            if (!rect) return;
            setSaving(true);
            await onApply(rect);
            setSaving(false);
          }}
        >
          {labels.cropApply}
        </Button>
      </div>
    </div>
  );
}

// ステージ全体。メディア＋前後の送り＋枚数表示＋インスペクタの切り替え。欠落した状態
// （投稿がライブラリから削除された）でも、空状態の規則（次の行動を必ず示す）に従って
// タブを閉じられるままにする。そして今は、アプリの他のすべての空状態と同じ Empty の
// 作りを着ている（P2⑫）。
export function ImageTab({ model }: { model: ImageTabModel }) {
  const { items, idx, missing, labels } = model;
  const i = items.length ? Math.max(0, Math.min(idx, items.length - 1)) : 0;
  // 隣を取得済みかつデコード済みに保つ（#241）。フックの順序を安定させるため、欠落状態
  // の return より上に置く。一覧が空なら、何も先読みせず前のタブが抱えていたものを手放す
  // だけになる。
  const preloader = useRef<NeighborPreloader | null>(null);
  const [editingCrop, setEditingCrop] = useState(false);
  useEffect(() => {
    if (!preloader.current) preloader.current = createNeighborPreloader();
    preloader.current.sync(neighborPreloadSources(items, i));
  }, [items, i]);
  useEffect(() => () => preloader.current?.clear(), []);
  // #80 の左右反転・グリッド・グレースケールの切り替え。下のどのスライドの種別からも
  // 適用できるよう、ここで読む。書き込むのは image-tab/ViewerToolbar.tsx
  // （services/image-overlay.ts が共有の層で、image-zoom.ts と同じイベント半分の形）。
  // 載せるたびに1回リセットする。このコンポーネントは model.tabId を key にしているので
  // （image-tab/index.tsx）、ここで載るのは必ず、まっさらな画像ビューか別のタブへの
  // 切り替えのどちらか＝同じタブの中でのページ送りではない（あれは key ではなく `idx`
  // しか変えない）。#80 が確認した寿命（タブごとに一時的で、他のタブへは持ち越さない）と
  // 一致する。
  const overlay = useSyncExternalStore(subscribeOverlay, getOverlayState);
  useEffect(() => {
    resetOverlay();
  }, []);
  if (missing || !items.length) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageOff />
          </EmptyMedia>
          <EmptyTitle>{labels.missing}</EmptyTitle>
          <EmptyDescription>{labels.missingDesc}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => model.onCloseTab?.()}>
            {labels.closeTab}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }
  const item = items[i];
  const multi = items.length > 1;
  const step = (d: number) => {
    setEditingCrop(false);
    model.onIndexChange?.((i + d + items.length) % items.length);
  };
  return (
    // スライドごとの `key` は残す（#241 は選択を実装に委ねた）。送りのたびにズーム・パンを
    // ウィンドウ合わせへ戻すのはこれだし、あるスライドの再生状態（うごイラのデコードの
    // ループ、<video> の再生位置）が次へ滲み出すのを止めているのもこれ。外せば、それらを
    // すべて src の変化を見る effect から導き直すことになる＝速くしたい対象より確実に
    // 広い面になる。しかもここでは何も得られない。送りが冷たく感じられた原因は、載せ
    // 直しではなく冷たい取得とデコードだったから。preload.ts が隣を温めていれば、載せ
    // 直された <img> は温まった資源と温まったデコードに当たる。
    <div
      data-slot="image-tab-stage"
      className="relative flex min-w-0 flex-1 overflow-hidden"
      onContextMenu={(event) => {
        const file = !item.video && !item.ugoira && copyableImages([fileOfSrc(item.src)])[0];
        if (!file || editingCrop) return;
        event.preventDefault();
        openMenu({ x: event.clientX, y: event.clientY, items: [{ label: t('ctxCopyImage'), act: 'copyImage' }] }, () => {
          void copyImage(file);
        });
      }}
    >
      {item.ugoira ? (
        <UgoiraPlayer key={item.src} file={item.ugoira.file} frames={item.ugoira.frames} poster={item.poster} alt={item.alt} labels={labels} flip={overlay.flip} gray={overlay.gray} />
      ) : item.video ? (
        <video key={item.src} data-slot="viewer-video" className={`m-auto max-h-full max-w-full object-contain ${overlay.flip ? 'scale-x-[-1]' : ''} ${overlay.gray ? 'grayscale' : ''}`} src={item.src} controls playsInline preload="metadata" />
      ) : (
        <Zoomable key={`${item.src}:${JSON.stringify(item.crop ?? null)}`} src={item.src} alt={item.alt || ''} flip={overlay.flip} gray={overlay.gray} grid={overlay.grid} crop={item.crop} sourceWidth={item.width} sourceHeight={item.height} />
      )}
      {editingCrop && item.postId && item.mediaSeq != null && (
        <CropEditor
          src={item.src}
          alt={item.alt || ''}
          initial={item.crop}
          labels={labels}
          onCancel={() => setEditingCrop(false)}
          onApply={async (crop) => {
            if (await model.onSetCrop?.(item.postId as string, item.mediaSeq as number, crop)) setEditingCrop(false);
          }}
        />
      )}
      {multi && (
        <>
          {/* 左右の縁全体を送り領域にする。中央の矢印だけを狙わせると、縦長の画像で
              上下端をクリックしたときに反応せず、隣の画像へ進む操作として読めない。 */}
          <Button data-slot="image-tab-prev" variant="ghost" size="icon" aria-label={labels.prev} onClick={() => step(-1)} className="absolute inset-y-0 left-0 z-2 h-auto w-16 rounded-none bg-transparent p-0 hover:bg-transparent">
            <span className={`flex size-10 items-center justify-center rounded-md ${PLATE}`}>
              <ChevronLeft className="size-6" />
            </span>
          </Button>
          <Button data-slot="image-tab-next" variant="ghost" size="icon" aria-label={labels.next} onClick={() => step(1)} className="absolute inset-y-0 right-0 z-2 h-auto w-16 rounded-none bg-transparent p-0 hover:bg-transparent">
            <span className={`flex size-10 items-center justify-center rounded-md ${PLATE}`}>
              <ChevronRight className="size-6" />
            </span>
          </Button>
          {/* Badge ではない。これは状態を示すチップではなく、今どこにいるかを実時間で
              示す表示で、tabular-nums は添字が桁を跨ぐときの震えを抑える。 */}
          <div data-slot="image-tab-counter" className="-translate-x-1/2 absolute bottom-4 left-1/2 z-2 whitespace-nowrap rounded-full border bg-muted/95 px-3 py-1 text-foreground text-xs tabular-nums backdrop-blur-sm">
            {model.positionLabel || `${i + 1} / ${items.length}`}
          </div>
        </>
      )}
      {/* ここでは絵がウィンドウの全部なので、インスペクタの切り替えは絵の上に乗る。
          ツールチップは旧来の data-tip の層ではなくアプリ自身のもの（shadcn）なので、
          ツールバーの帯にあるズームのまとまりと揃う。 */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button data-slot="image-tab-info" variant="ghost" size="icon-sm" aria-label={labels.info} aria-pressed={!!model.inspectorOpen} onClick={() => model.onToggleInspector?.()} className={`absolute top-3 right-3 z-2 ${model.inspectorOpen ? `${PLATE_SURFACE} text-foreground` : PLATE}`}>
              <Info />
            </Button>
          }
        />
        <TooltipContent side="bottom">{labels.info}</TooltipContent>
      </Tooltip>
      {!item.video && !item.ugoira && item.postId && item.mediaSeq != null && !editingCrop && (
        <div className="absolute top-3 right-14 z-2 flex gap-1">
          {item.crop && (
            <Button data-slot="image-tab-remove-crop" variant="ghost" size="sm" className={PLATE} onClick={() => void model.onSetCrop?.(item.postId as string, item.mediaSeq as number, null)}>
              {labels.cropRemove}
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button data-slot="image-tab-crop" variant="ghost" size="icon-sm" aria-label={labels.crop} onClick={() => setEditingCrop(true)} className={PLATE}>
                  <Crop />
                </Button>
              }
            />
            <TooltipContent side="bottom">{labels.crop}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
