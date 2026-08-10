// 画像ビューのズーム。舞台とツールバーの間の共有の層（#150）。
//
// ズームと移動そのものは react-zoom-pan-pinch で、image-tab/ImageTab.tsx の Zoomable の
// 中にいる。あれはスライドごとに載せ直される（`key={item.src}`）ので、アプリ上部の帯にある
// ツールバーが話しかける相手にはなれない。だから舞台は、載っている間ここへコントローラを
// 登録し、ツールバーが出すべきものを公開する。ツールバーは読むだけ。他の service
// （lightbox.ts / panels.ts）と同じイベント側の形で、状態はそれを決める規則の隣にあり、
// 両側のコンポーネントが購読する。
//
// 「コントローラが登録されていない」が「ズームするものが無い」の唯一の情報源＝動画の
// スライドとうごイラのスライド（どちらも Zoomable を描かない）を、それぞれが自分で
// 言わなくても覆う。
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';

// ホイールでのズームの調整値。今はツールバーの ± とも共有する（#134 → #150）＝ホイールの
// 1目盛りとボタンの1回押しは同じ乗算の刻みなので、2つの入力が別々のズームの段へ分かれる
// ことはない。
export const MIN_SCALE = 1;
export const MAX_SCALE = 40;
export const ZOOM_STEP = 1.25;
export const ZOOM_MS = 200;
// 全体表示⇄原寸の飛び移りは、自分の（より短い）緩急を持つ＝これは1回の飛び移りであって、
// 目盛りではない。
export const FIT_MS = 180;
// react-zoom-pan-pinch の尺度は全体表示を基準にしている（全体表示が 1）ので、「まだ全体表示か」
// は等号ではなく 1 の周りの帯になる。1.02 はダブルクリックの切り替えがずっと使ってきた
// しきい値。ツールバーも同じものを読むので、ボタンと操作の判断が一致する。
export const FIT_EPSILON = 1.02;
// 舞台より小さい画像は、全体表示の時点で既に画像の1px＝画面の1px なので、「原寸」は何もしない
// ことになる＝代わりに切り替えは決まった刻みで拡大する（従来のダブルクリックの挙動をそのまま
// 残したもの）。
export const SMALL_IMAGE_ZOOM = 2.5;
export const ACTUAL_MIN_RATIO = 1.05;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// `base` からズームを1目盛り動かす。dir は +1 が拡大、-1 が縮小。
export const steppedScale = (base: number, dir: number): number => clampScale(base * ZOOM_STEP ** dir);

// 画像の1px が CSS の1px を覆う尺度。offsetWidth は配置上の（全体表示の）幅で、CSS の
// transform はそれに触れないので、この比は厳密。画像がまだ本来の大きさを持たない間は
// 1（＝全体表示）を代わりに使う。
export const actualScaleOf = (naturalWidth: number, offsetWidth: number): number => (offsetWidth > 0 && naturalWidth > 0 ? naturalWidth / offsetWidth : 1);

export const isAtFit = (scale: number): boolean => scale <= FIT_EPSILON;

// 全体表示⇄原寸の切り替えが、ここから何をすべきか。関数を1つにしてあるので、ボタンと
// ダブルクリックと Ctrl+0/Ctrl+1 が、3つの違う切り替えを語ることはない。
export type FitToggleTarget = { fit: true } | { fit: false; scale: number };
export const fitToggleTarget = (scale: number, actual: number): FitToggleTarget => (isAtFit(scale) ? { fit: false, scale: actual > ACTUAL_MIN_RATIO ? actual : SMALL_IMAGE_ZOOM } : { fit: true });
// 全体表示ではない側だけを取り出したもの（Ctrl+1 と、切り替えの拡大側の分岐）。
export const actualTarget = (actual: number): number => (actual > ACTUAL_MIN_RATIO ? actual : SMALL_IMAGE_ZOOM);

// ツールバーが出す数値。ライブラリの尺度は全体表示を基準にしているので、尺度だけを読むと、
// 画素の38%で出ている絵にも100%と表示されてしまう＝画像自身の幅で正規化し、どのビューアの
// 表示もそうしているように、100%が原寸を意味するようにする。null はまだ分からないことを
// 表す（配置の箱が無い、または本来の大きさが届いていない）＝表示は 0 や NaN ではなく
// プレースホルダを出す。
export const zoomPercentOf = (scale: number, offsetWidth: number, naturalWidth: number): number | null => (offsetWidth > 0 && naturalWidth > 0 && Number.isFinite(scale) ? Math.round((scale * offsetWidth * 100) / naturalWidth) : null);

// ツールバー（と Ctrl+0/Ctrl+1）が出せる命令。実装するのは舞台の側。
export interface ImageZoomController {
  step(dir: 1 | -1): void;
  toggleFitActual(): void;
  fit(): void;
  actual(): void;
}

export interface ImageZoomState {
  // null は、今のスライドにズームが無いことと同値（動画、うごイラ、そもそも画像タブが無い）。
  readonly controller: ImageZoomController | null;
  readonly percent: number | null;
  readonly atFit: boolean;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
}

export type ImageZoomView = Omit<ImageZoomState, 'controller'>;

const IDLE: ImageZoomState = { controller: null, percent: null, atFit: true, canZoomIn: false, canZoomOut: false };

// 書き換えず必ず差し替える。そうすれば useSyncExternalStore のスナップショットの同一性が、
// 本物の変化の信号になる。
let state: ImageZoomState = IDLE;
const subs = new Set<() => void>();

const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 1つの購読側の不調で、残りを止めてはいけない */
    }
  }
};

export const getState = (): ImageZoomState => state;
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// 載っている舞台が呼ぶ。登録の解除は、呼び出し側がまだ生きている登録である時にだけ消す＝
// key 付きの載せ直しでは、新しいスライドが登録した後で古いスライドが畳まれることがある。
export function register(controller: ImageZoomController): () => void {
  state = { ...IDLE, controller };
  notify();
  return () => {
    if (state.controller !== controller) return;
    state = IDLE;
    notify();
  };
}

export function publish(view: ImageZoomView): void {
  const s = state;
  if (!s.controller) return; // 何も載っていない＝死んだスライドからの遅れたフレーム
  if (s.percent === view.percent && s.atFit === view.atFit && s.canZoomIn === view.canZoomIn && s.canZoomOut === view.canZoomOut) return;
  state = { controller: s.controller, ...view };
  notify();
}

// Ctrl+0 が全体表示、Ctrl+1 が原寸（ブラウザ／Photoshop／Windows のフォトアプリの作法）。
// 登録は App.tsx の GlobalShortcuts。
//
// 登録されたコントローラが、そのまま「画像が画面に出ている」の防ぎになる＝ズームできる
// スライドが載っている間しか存在しないから。オーバーレイの検査は image-tab/index.tsx の
// ←/→ のハンドラを写したもの＝画像ビューの上のダイアログがキーボードを持つ。
// #246: この2つの和音（Ctrl+0 / Ctrl+1）は今、登録簿の中で個別に付け替えできる別々の
// コマンドとして存在する。ここに残るのは共有の防ぎの連なりと、2つの操作。canExecute の
// `!state.controller` の検査が、#246 の「登録されているが走らせるものが無い」の受け入れ条件
// （「実行可否の判定が偽を返し、例外を投げずに何も起きない」）そのもの＝登録簿ができる前から、
// まったくこの形だった。
function canExecuteZoom(e: KeyboardEvent): boolean {
  if (!state.controller) return false;
  if (isTypingTarget(e)) return false;
  if (lightboxIsOpen() || settingsIsOpen() || confirmGet()) return false;
  return true;
}

registerShortcut({
  id: 'zoom.fit',
  titleKey: 'shortcutZoomFit',
  defaultCombo: 'Ctrl+0',
  canExecute: canExecuteZoom,
  perform: () => state.controller?.fit(),
});
registerShortcut({
  id: 'zoom.actual',
  titleKey: 'shortcutZoomActual',
  defaultCombo: 'Ctrl+1',
  canExecute: canExecuteZoom,
  perform: () => state.controller?.actual(),
});

export function handleShortcutZoomKey(e: KeyboardEvent): void {
  if (tryRun('zoom.fit', e)) return;
  tryRun('zoom.actual', e);
}
