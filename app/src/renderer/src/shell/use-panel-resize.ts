// Drag-to-resize behaviour for the side panels (#30), shared by the sidebar rail and
// the inspector's handle.
//
// The gesture is live/commit split: while the pointer is down the width is written
// straight to the DOM (a CSS variable) and never through React state — a re-render per
// pointermove would drag the whole grid with it — and only pointerup hands the final
// number to React and to config.json. Key presses have no "during", so they commit at
// once.
//
// Keyboard + ARIA follow the W3C APG window-splitter pattern, which neither shadcn's
// Sidebar (it has no resize at all) nor the community fork of it implements: arrows
// step, Home/End jump to the limits, and the handle reports its position so a screen
// reader can say how wide the panel is.
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef } from 'react';

const DRAG_SLOP = 3; // px of movement before a press counts as a drag rather than a click
const KEY_STEP = 16; // px per arrow key — matches the 4px spacing scale at 4 notches

export type PanelResize = {
  /** Spread onto the handle element. */
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
  /** Which side of the window the panel is docked to. A left panel widens as the
   *  pointer moves right; a right panel is the mirror. */
  side: 'left' | 'right';
  /** Current width in px — the value the handle reports and gestures start from. */
  width: number;
  min: number;
  max: number;
  label: string;
  /** Hold a proposed width inside the limits (viewport cap included). */
  clamp: (px: number) => number;
  /** Called on every frame of a drag. Must not touch React state or persistence. */
  onLive: (px: number) => void;
  /** Called once a gesture finishes: adopt the width and save it. */
  onCommit: (px: number) => void;
  /** Double-click: back to the component's own default width. */
  onReset: () => void;
  /** True while a pointer drag is in progress. The shell uses it to take the panels'
   *  width transition off, which otherwise leaves them 200ms behind the pointer. */
  onGesture?: (active: boolean) => void;
};

export function usePanelResize(opts: PanelResizeOptions): PanelResize {
  // Everything the pointer handlers read is in a ref: they are registered once, but the
  // width they start from changes on every commit.
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
    // One write per frame: pointermove fires faster than the compositor can lay the
    // grid out again, and every write reflows the whole content column.
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
    o.current.onGesture?.(true);
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
    o.current.onGesture?.(false);
    if (d.frame) cancelAnimationFrame(d.frame);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* the capture is already gone (pointercancel) — nothing to release */
    }
    if (!d.moved) return;
    o.current.onLive(d.next); // the last frame may still be pending — land it now
    o.current.onCommit(d.next);
  }, []);

  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLElement>) => {
    const { side, width, min, max, clamp, onLive, onCommit } = o.current;
    // Arrows are in screen terms, so a right-docked panel grows on ArrowLeft.
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
      // A cancelled pointer (the OS taking over, a touch turning into a gesture) ends
      // the drag exactly like a release: the width the user last saw is the answer.
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick,
    },
  };
}

/** Resolve a CSS length (`16rem`, `320px`) to px through the layout engine, so a
 *  default width can be read from the component's own token instead of being copied
 *  into a literal here — two numbers for one default is how they drift apart. */
export function resolveCssLength(value: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${value}`;
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return Math.round(px);
}
