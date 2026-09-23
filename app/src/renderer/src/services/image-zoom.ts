import { get as confirmGet } from './confirm.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';

// ホイールでのズームの調整値。今はツールバーの ± とも共有する（#134 → #150）＝ホイールの
// 1目盛りとボタンの1回押しは同じ乗算の刻みなので、2つの入力が別々のズームの段へ分かれる
// ことはない。
export const MIN_SCALE = 1;
export const MAX_SCALE = 40;
export const ZOOM_STEP = 1.25;
export const ZOOM_MS = 200;
// ウィンドウフィットへ戻すアニメーションの長さ。
export const FIT_MS = 180;
// react-zoom-pan-pinch の尺度は全体表示を基準にしている（全体表示が 1）ので、「まだ全体表示か」
// は等号ではなく 1 の周りの帯になる。1.02 はダブルクリックの切り替えがずっと使ってきた
// しきい値。ツールバーも同じものを読むので、ボタンと操作の判断が一致する。
export const FIT_EPSILON = 1.02;
export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// `base` からズームを1目盛り動かす。dir は +1 が拡大、-1 が縮小。
export const steppedScale = (base: number, dir: number): number => clampScale(base * ZOOM_STEP ** dir);

export const isAtFit = (scale: number): boolean => scale <= FIT_EPSILON;

// ツールバーが出す数値。ライブラリの尺度は全体表示を基準にしているので、尺度だけを読むと、
// 画素の38%で出ている絵にも100%と表示されてしまう＝画像自身の幅で正規化し、どのビューアの
// 表示もそうしているように、100%が原寸を意味するようにする。null はまだ分からないことを
// 表す（配置の箱が無い、または本来の大きさが届いていない）＝表示は 0 や NaN ではなく
// プレースホルダを出す。
export const zoomPercentOf = (scale: number, offsetWidth: number, naturalWidth: number): number | null => (offsetWidth > 0 && naturalWidth > 0 && Number.isFinite(scale) ? Math.round((scale * offsetWidth * 100) / naturalWidth) : null);

// ツールバー（と Ctrl+0）が出せる命令。実装するのは舞台の側。
export interface ImageZoomController {
  step(dir: 1 | -1): void;
  fit(): void;
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

// ウィンドウフィットのショートカットは、画像表示中だけ使える。
function canExecuteZoom(e: KeyboardEvent): boolean {
  if (!state.controller) return false;
  if (isTypingTarget(e)) return false;
  if (settingsIsOpen() || confirmGet()) return false;
  return true;
}

registerShortcut({
  id: 'zoom.fit',
  titleKey: 'shortcutZoomFit',
  defaultCombo: 'Ctrl+0',
  canExecute: canExecuteZoom,
  perform: () => state.controller?.fit(),
});

export function handleShortcutZoomKey(e: KeyboardEvent): void {
  tryRun('zoom.fit', e);
}
