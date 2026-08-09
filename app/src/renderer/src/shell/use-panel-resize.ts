// 横のパネルをドラッグで幅変更する振る舞い（#30）。サイドバーのレールと詳細パネルの
// ハンドルが共有する。
//
// ジェスチャは実時間側と確定側に分かれている。ポインタが下りている間、幅は React の状態を
// 通さず DOM（CSS 変数）へ直に書く＝pointermove ごとに再描画すればグリッドまるごとを
// 引きずることになる。最終的な数値を React と config.json へ渡すのは pointerup だけ。
// キーの押下には「その間」が無いので、押した時点で確定する。
//
// キーボードと ARIA は W3C APG の window splitter のパターンに従う。shadcn の Sidebar
// （そもそも幅変更を持たない）も、その community fork も実装していない＝矢印で刻み、
// Home/End で限界へ飛び、ハンドルが自分の位置を報告するのでスクリーンリーダーがパネルの
// 幅を読み上げられる。
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef } from 'react';

const DRAG_SLOP = 3; // 押下をクリックでなくドラッグと見なすまでに要る移動量（px）
const KEY_STEP = 16; // 矢印キー1回あたりの px＝4px の間隔スケールで4刻みぶん

export type PanelResize = {
  /** ハンドルの要素へ展開して渡す。 */
  handleProps: {
    role: 'separator';
    tabIndex: 0;
    'aria-orientation': 'vertical';
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
    'aria-label': string;
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };
};

export type PanelResizeOptions = {
  /** パネルがウィンドウのどちら側に付いているか。左のパネルはポインタが右へ動くと
   *  広がり、右のパネルはその鏡像。 */
  side: 'left' | 'right';
  /** 現在の幅（px）＝ハンドルが報告し、ジェスチャの起点にもなる値。 */
  width: number;
  min: number;
  max: number;
  label: string;
  /** 提示された幅を限界の内側へ収める（ビューポートの上限も含む）。 */
  clamp: (px: number) => number;
  /** ドラッグのフレームごとに呼ばれる。React の状態にも永続化にも触ってはいけない。 */
  onLive: (px: number) => void;
  /** ジェスチャが終わった時点で1回呼ばれる＝その幅を採用して保存する。 */
  onCommit: (px: number) => void;
  /** ダブルクリック＝コンポーネント自身の既定の幅へ戻す。 */
  onReset: () => void;
};

export function usePanelResize(opts: PanelResizeOptions): PanelResize {
  // ポインタのハンドラが読むものはすべて ref に入れてある＝ハンドラの登録は1回きりだが、
  // 起点にする幅は確定のたびに変わる。
  const o = useRef(opts);
  o.current = opts;

  const drag = useRef<{ startX: number; startW: number; moved: boolean; frame: number; next: number } | null>(null);

  const apply = useCallback((clientX: number) => {
    const d = drag.current;
    if (!d) return;
    const delta = o.current.side === 'left' ? clientX - d.startX : d.startX - clientX;
    if (!d.moved && Math.abs(delta) < DRAG_SLOP) return;
    d.moved = true;
    d.next = o.current.clamp(d.startW + delta);
    // 書き込みは1フレームに1回＝pointermove はコンポジタがグリッドを組み直せるより速く
    // 飛び、書き込みのたびに内容の列まるごとがリフローする。
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      o.current.onLive(d.next);
    });
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    drag.current = { startX: e.clientX, startW: o.current.width, moved: false, frame: 0, next: o.current.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (drag.current) apply(e.clientX);
    },
    [apply],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* キャプチャは既に外れている（pointercancel）＝解放するものが無い */
    }
    if (!d.moved) return;
    o.current.onLive(d.next); // 最後のフレームがまだ保留かもしれない＝ここで着地させる
    o.current.onCommit(d.next);
  }, []);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const { side, width, min, max, clamp, onLive, onCommit } = o.current;
    // 矢印は画面上の向きで解釈するので、右に付いたパネルは ArrowLeft で広がる。
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    let next: number | null = null;
    if (e.key === grow) next = clamp(width + KEY_STEP);
    else if (e.key === shrink) next = clamp(width - KEY_STEP);
    else if (e.key === 'Home') next = clamp(min);
    else if (e.key === 'End') next = clamp(max);
    if (next === null) return;
    e.preventDefault();
    onLive(next);
    onCommit(next);
  }, []);

  const onDoubleClick = useCallback(() => {
    o.current.onReset();
  }, []);

  return {
    handleProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-valuenow': opts.width,
      'aria-valuemin': opts.min,
      'aria-valuemax': opts.max,
      'aria-label': opts.label,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      // 取り消されたポインタ（OS が横取りした、タッチがジェスチャになった）は、離したとき
      // と全く同じようにドラッグを終える＝利用者が最後に見た幅が答え。
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick,
    },
  };
}

/** CSS の長さ（`16rem`・`320px`）をレイアウトエンジンに通して px へ解決する。既定の幅を
 *  ここのリテラルへ写さず、コンポーネント自身のトークンから読めるようにするため＝1つの
 *  既定に対して数値が2つあることが、両者のずれていく原因になる。 */
export function resolveCssLength(value: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${value}`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return Math.round(px);
}
