import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';

// Wheel-zoom tuning (#134): one mouse-wheel notch (deltaY~100) changes the
// scale by ~1 — fine enough to stop on a target zoom (the old 0.15 library
// step swung ~15x scale per notch). Each notch animates for WHEEL_ZOOM_MS.
const MIN_SCALE = 1;
const MAX_SCALE = 40;
const WHEEL_STEP = 0.01;
const WHEEL_ZOOM_MS = 110;

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
  // Custom wheel zoom, animated by the library's own setTransform (#134). The
  // library applies wheel deltas instantly; easing them with a CSS transition
  // corrupted its cursor-anchor math — it reads the content's LIVE bounding
  // rect per tick, which mid-transition lags the state, so the anchor drifted
  // hundreds of px off the cursor. Computing the anchored target from instance
  // STATE is exact even mid-animation (the animator keeps state and paint in
  // sync per frame), and setTransform both eases and cancels the prior tween.
  useEffect(() => {
    const wrapper = twRef.current?.instance.wrapperComponent;
    if (!wrapper) return undefined;
    const onWheel = (e: WheelEvent) => {
      const tw = twRef.current;
      if (!tw) return;
      e.preventDefault();
      const { scale, positionX, positionY } = tw.instance.state;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale + (e.deltaY < 0 ? 1 : -1) * WHEEL_STEP * Math.abs(e.deltaY)));
      if (next === scale) return;
      // Keep the content point under the cursor fixed across the scale change.
      const wr = wrapper.getBoundingClientRect(); // static element — transition-safe
      const cx = (e.clientX - wr.left - positionX) / scale;
      const cy = (e.clientY - wr.top - positionY) / scale;
      // The content box fills the wrapper 1:1 (contentStyle 100%), so bounds
      // clamp directly against the wrapper size (mirrors disablePadding).
      const nx = Math.min(0, Math.max(wr.width - wr.width * next, e.clientX - wr.left - cx * next));
      const ny = Math.min(0, Math.max(wr.height - wr.height * next, e.clientY - wr.top - cy * next));
      tw.setTransform(nx, ny, next, WHEEL_ZOOM_MS, 'easeOut');
    };
    // React attaches wheel passively — a native non-passive listener is needed
    // for preventDefault (else the page scrolls behind the zoom).
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, []);
  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    downPos.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLImageElement>) => {
    const d = downPos.current;
    downPos.current = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) dragEndAt.current = performance.now();
  };
  return (
    // wheel.disabled: the wheel is handled by the custom anchored-zoom effect
    // above; the library's own instant wheel path stays off.
    //
    // disablePadding: without it the elastic padding lets cursor-anchored wheel
    // zoom-out drift the image sideways out of bounds, and the wheel-stop
    // alignment then animates it back ("slides away, then gets pulled home");
    // dragging past the image edge bounced back to center on release the same
    // way. Per-tick bounds clamping makes both motions dead straight.
    <TransformWrapper ref={twRef} minScale={MIN_SCALE} maxScale={MAX_SCALE} centerOnInit disablePadding doubleClick={{ disabled: true }} wheel={{ disabled: true }}>
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
