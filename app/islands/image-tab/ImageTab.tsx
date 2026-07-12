import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';

// Model built by viewer.js (renderImageTabView): the gallery items of ONE post
// group, the controlled index, and the tab-level actions. Zoom/pan state stays
// inside this island (ephemeral — each slide remounts fresh at fit via key).
export interface ImageTabItem {
  src: string;
  video?: boolean;
  alt?: string;
}
export interface ImageTabModel {
  items: ImageTabItem[];
  idx: number;
  missing?: boolean;
  inspectorOpen?: boolean;
  labels: Record<string, string>;
  onIndexChange?: (i: number) => void;
  onToggleInspector?: () => void;
  onCloseTab?: () => void;
}

const INFO_ICON = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="12" y1="7.6" x2="12" y2="7.7" />
  </svg>
);

// One image with Eagle-style zoom/pan (react-zoom-pan-pinch): wheel = zoom at
// the cursor, drag = pan, double-click = actual pixels ⇄ fit. The parent keys
// this on src so a slide change remounts at fit scale.
function Zoomable({ src, alt }: { src: string; alt: string }) {
  const twRef = useRef<ReactZoomPanPinchRef | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wheelEaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-click fit-toggle guard (#134 follow-up): two quick pan strokes can
  // land inside Chrome's double-click counter (~4px between presses, 500ms),
  // which used to yank a zoomed view back to fit mid-pan. A "click" that moved
  // is a pan stroke, not half of a double-click — record it and have onDouble
  // ignore the double-click that tails one.
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const dragEndAt = useRef(0);
  const onDouble = () => {
    if (performance.now() - dragEndAt.current < 400) return;
    const tw = twRef.current;
    const img = imgRef.current;
    if (!tw || !img) return;
    const scale = tw.instance.state.scale;
    // offsetWidth is the layout (fit) width — unaffected by the CSS transform —
    // so naturalWidth/offsetWidth is exactly the scale where 1 image px = 1
    // screen px. Images smaller than the viewport get a plain zoom step instead.
    const actual = img.offsetWidth ? img.naturalWidth / img.offsetWidth : 1;
    const target = actual > 1.05 ? actual : 2.5;
    if (scale > 1.02) tw.resetTransform(180);
    else tw.centerView(target, 180);
  };
  // The library applies wheel-zoom instantly (no built-in per-tick easing) — add
  // a short CSS transition, but ONLY while a wheel-zoom gesture is in flight, so
  // panning/dragging (a different code path) stays 1:1 with the pointer.
  const onWheelStart = (ref: ReactZoomPanPinchRef) => {
    if (wheelEaseTimer.current) clearTimeout(wheelEaseTimer.current);
    ref.instance.contentComponent?.classList.add('itv-wheel-ease');
  };
  const onWheelStop = (ref: ReactZoomPanPinchRef) => {
    // Let the in-flight transition finish before dropping the class, else the
    // last step in a fast scroll snaps instead of easing out.
    wheelEaseTimer.current = setTimeout(() => {
      ref.instance.contentComponent?.classList.remove('itv-wheel-ease');
    }, 120);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = downPos.current;
    downPos.current = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) dragEndAt.current = performance.now();
  };
  return (
    // wheel.step: smooth mode (library default) scales the per-event zoom delta by
    // the wheel event's raw deltaY, so 0.15 (10x the library's own 0.015 default)
    // meant a single mouse-wheel notch (deltaY~100) could jump the scale by ~15 —
    // most of the whole 1-40 range in one click. 0.01 keeps a standard notch to
    // roughly +1 scale (fit -> 2x), fine enough to stop on a target zoom (#134).
    //
    // disablePadding: without it the elastic padding lets cursor-anchored wheel
    // zoom-out drift the image sideways out of bounds, and the wheel-stop
    // alignment then animates it back ("slides away, then gets pulled home");
    // dragging past the image edge bounced back to center on release the same
    // way. Per-tick bounds clamping makes both motions dead straight.
    <TransformWrapper ref={twRef} minScale={1} maxScale={40} centerOnInit disablePadding doubleClick={{ disabled: true }} wheel={{ step: 0.01 }} onWheelStart={onWheelStart} onWheelStop={onWheelStop}>
      <TransformComponent wrapperClass="itv-tw" contentClass="itv-tc" wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img ref={imgRef} className="itv-media" src={src} alt={alt} draggable={false} onDoubleClick={onDouble} onPointerDown={onPointerDown} onPointerUp={onPointerUp} />
      </TransformComponent>
    </TransformWrapper>
  );
}

// The whole stage: media + prev/next + counter + the inspector toggle. The
// missing state (post deleted from the library) keeps the tab closable per the
// empty-state rule (always offer the next action).
export function ImageTab({ model }: { model: ImageTabModel }) {
  const { items, idx, missing, labels } = model;
  if (missing || !items.length) {
    return (
      <div className="itv-empty">
        <p>{labels.missing}</p>
        <button type="button" className="btn-outline" onClick={() => model.onCloseTab && model.onCloseTab()}>
          {labels.closeTab}
        </button>
      </div>
    );
  }
  const i = Math.max(0, Math.min(idx, items.length - 1));
  const item = items[i];
  const multi = items.length > 1;
  const step = (d: number) => model.onIndexChange && model.onIndexChange((i + d + items.length) % items.length);
  return (
    <div className="itv-stage">
      {item.video ? <video key={item.src} className="itv-media itv-video" src={item.src} controls playsInline preload="metadata" /> : <Zoomable key={item.src} src={item.src} alt={item.alt || ''} />}
      {multi && (
        <button type="button" className="itv-nav itv-prev" aria-label={labels.prev} onClick={() => step(-1)}>
          {'‹'}
        </button>
      )}
      {multi && (
        <button type="button" className="itv-nav itv-next" aria-label={labels.next} onClick={() => step(1)}>
          {'›'}
        </button>
      )}
      {multi && <div className="itv-counter">{i + 1 + ' / ' + items.length}</div>}
      <div className="itv-tools">
        <button type="button" className="icon-btn" data-tip={labels.info} aria-label={labels.info} aria-pressed={!!model.inspectorOpen} onClick={() => model.onToggleInspector && model.onToggleInspector()}>
          {INFO_ICON}
        </button>
      </div>
    </div>
  );
}
