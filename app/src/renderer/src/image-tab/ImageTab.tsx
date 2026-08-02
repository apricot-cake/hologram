import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { HTMLAttributes, PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PLATE, PLATE_SURFACE } from './plate.ts';
import { UgoiraPlayer } from './UgoiraPlayer.tsx';
import { createNeighborPreloader, neighborPreloadSources, type NeighborPreloader } from './preload.ts';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { MAX_SCALE, MIN_SCALE, ZOOM_MS, FIT_MS, actualScaleOf, actualTarget, fitToggleTarget, isAtFit, publish as publishZoom, register as registerZoom, steppedScale, zoomPercentOf } from '../services/image-zoom.ts';
import { getState as getOverlayState, reset as resetOverlay, subscribe as subscribeOverlay } from '../services/image-overlay.ts';

// Wheel-zoom tuning (#134): one mouse-wheel notch (deltaY~100) MULTIPLIES the
// scale by ZOOM_STEP. Multiplicative so a notch feels equally strong at 1x
// and 30x — the old additive step (+1 per notch) doubled the image at 1x but
// barely moved it at high zoom. Each notch eases for ZOOM_MS. The constants and
// the arithmetic moved to services/image-zoom.ts when the toolbar's ± started
// sharing them (#150) — one ladder for the wheel and the buttons.

// Model built by viewer.js (renderImageTabView): the gallery items of ONE post
// group, the controlled index, and the tab-level actions. Zoom/pan state stays
// inside this component (ephemeral — each slide remounts fresh at fit via key).
export interface ImageTabItem {
  src: string;
  video?: boolean;
  alt?: string;
  // A pixiv ugoira archive: its library file name plus the frame table it
  // plays from (#119 St3). `poster` stands in until the archive is open.
  ugoira?: { file: string; frames: { file: string; delay: number }[] };
  poster?: string;
}
export interface ImageTabModel {
  // The active tab's own id (#80) — image-tab/index.tsx keys <ImageTab> on this, so a
  // switch straight from one image tab to another (both already showing their image
  // view) remounts this component instead of reusing it, which is what resets the
  // overlay toggles (services/image-overlay.ts) instead of leaking them across tabs.
  tabId: string;
  items: ImageTabItem[];
  idx: number;
  missing?: boolean;
  inspectorOpen?: boolean;
  labels: Record<string, string>;
  onIndexChange?: (i: number) => void;
  onToggleInspector?: () => void;
  onCloseTab?: () => void;
}

// One image with Eagle-style zoom/pan (react-zoom-pan-pinch): wheel = zoom at
// the cursor, drag = pan, double-click = actual pixels ⇄ fit. The parent keys
// this on src so a slide change remounts at fit scale.
// Rule-of-thirds grid (#80). One overlay element (design's "重ねる線1要素"), drawn as two
// gradient layers rather than four separate line divs. mix-blend-mode: difference inverts
// against whatever the image shows under each line, so a single near-white line reads on
// both a black night sky and a white page — no per-image color choice needed.
const THIRDS_GRID_LINES = [
  'linear-gradient(to right, transparent calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 + 0.5px), transparent calc(100%/3 + 0.5px), transparent calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 + 0.5px), transparent calc(200%/3 + 0.5px))',
  'linear-gradient(to bottom, transparent calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 - 0.5px), rgba(255,255,255,0.85) calc(100%/3 + 0.5px), transparent calc(100%/3 + 0.5px), transparent calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 - 0.5px), rgba(255,255,255,0.85) calc(200%/3 + 0.5px), transparent calc(200%/3 + 0.5px))',
].join(', ');

function Zoomable({ src, alt, flip, gray, grid }: { src: string; alt: string; flip: boolean; gray: boolean; grid: boolean }) {
  const twRef = useRef<ReactZoomPanPinchRef | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Double-click fit-toggle guard (#134 follow-up): two quick pan strokes can
  // land inside Chrome's double-click counter (~4px between presses, 500ms),
  // which used to yank a zoomed view back to fit mid-pan. A "click" that moved
  // is a pan stroke, not half of a double-click — record it and have onDouble
  // ignore the double-click that tails one.
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const dragEndAt = useRef(0);
  // Accumulated zoom target. Steps chain off this, NOT the live scale: the live
  // value is mid-tween while the wheel is still spinning, so stepping from it
  // swallowed part of each notch and the total zoom depended on how fast the
  // wheel was turned. null = out of sync (a fit/actual jump leaves the step
  // ladder) → re-seed from the live scale. The toolbar's ± chains off the SAME
  // ref (#150) — a mashed ＋ button is the same accumulation problem as a fast
  // wheel, and two separate accumulators would fight over the tween.
  const zoomTarget = useRef<number | null>(null);
  // Scale change + anchor, in one place: the wheel anchors on the cursor, the
  // toolbar's ± on the middle of the stage. Reading the instance STATE (not the
  // live bounding rect) is what makes this exact mid-animation — see #134 below.
  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
    const tw = twRef.current;
    const wrapper = tw?.instance.wrapperComponent;
    if (!tw || !wrapper) return;
    const { scale, positionX, positionY } = tw.instance.state;
    const wr = wrapper.getBoundingClientRect(); // static element — transition-safe
    const ax = clientX ?? wr.left + wr.width / 2;
    const ay = clientY ?? wr.top + wr.height / 2;
    // Keep the content point under the anchor fixed across the scale change.
    const cx = (ax - wr.left - positionX) / scale;
    const cy = (ay - wr.top - positionY) / scale;
    // The content box fills the wrapper 1:1 (contentStyle 100%), so bounds
    // clamp directly against the wrapper size (mirrors disablePadding).
    const nx = Math.min(0, Math.max(wr.width - wr.width * next, ax - wr.left - cx * next));
    const ny = Math.min(0, Math.max(wr.height - wr.height * next, ay - wr.top - cy * next));
    tw.setTransform(nx, ny, next, ZOOM_MS, 'easeOut');
  }, []);
  // Push the readout the toolbar prints. Called per animation frame by the
  // library's onTransform, and again whenever the layout width can have moved
  // (image load, stage resize) — the percent is scale × layout width ÷ intrinsic
  // width, so all three inputs have to be able to trigger it.
  const publish = useCallback(() => {
    const tw = twRef.current;
    const img = imgRef.current;
    if (!tw || !img) return;
    const scale = tw.instance.state.scale;
    // The ± buttons enable off the accumulated TARGET, not the live scale: a
    // mid-tween value would flicker a button back on before the step it was
    // disabled for had landed.
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
  // resetTransform/centerView jump outside the step ladder, so they clear the
  // accumulator on the way through (all three below).
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
  // Double-click is the gesture half of the same toggle (its own guard aside).
  const onDouble = () => {
    if (performance.now() - dragEndAt.current < 400) return;
    toggleFitActual();
  };
  // Hand the commands to the toolbar / Ctrl+0 / Ctrl+1 for as long as this slide
  // is mounted. A video or ugoira slide renders no Zoomable at all, so "nothing
  // registered" is exactly "nothing to zoom" (services/image-zoom.ts).
  useEffect(() => registerZoom({ step, toggleFitActual, fit, actual }), [step, toggleFitActual, fit, actual]);
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
      const base = zoomTarget.current ?? tw.instance.state.scale;
      const next = steppedScale(base, -e.deltaY / 100);
      if (next === base) return;
      zoomTarget.current = next;
      zoomTo(next, e.clientX, e.clientY);
    };
    // React attaches wheel passively — a native non-passive listener is needed
    // for preventDefault (else the page scrolls behind the zoom).
    wrapper.addEventListener('wheel', onWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', onWheel);
  }, [zoomTo]);
  // The stage can change width without the transform moving (window resize, the
  // inspector opening), and the percent is measured against that width.
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
  return (
    // wheel.disabled: the wheel is handled by the custom anchored-zoom effect
    // above; the library's own instant wheel path stays off.
    //
    // disablePadding: without it the elastic padding lets cursor-anchored wheel
    // zoom-out drift the image sideways out of bounds, and the wheel-stop
    // alignment then animates it back ("slides away, then gets pulled home");
    // dragging past the image edge bounced back to center on release the same
    // way. Per-tick bounds clamping makes both motions dead straight.
    <TransformWrapper ref={twRef} minScale={MIN_SCALE} maxScale={MAX_SCALE} centerOnInit disablePadding doubleClick={{ disabled: true }} wheel={{ disabled: true }} onTransform={publish}>
      {/* The wrapper is where the wheel listener above lives, so it needs a name the
          verify script can aim a wheel event at. The cast is the library's typing, not
          ours: wrapperProps is declared as React.HTMLAttributes, which has no data-*
          index signature — the object is spread onto a real <div>. */}
      <TransformComponent wrapperProps={{ 'data-slot': 'viewer-zoom-wrapper' } as HTMLAttributes<HTMLDivElement>} wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* decoding="async" (#241): this <img> IS the surface, so there is no
            "other DOM content" that a sync decode would keep in step with — all
            it could do is hold the frame (and the nav buttons, and the counter)
            hostage to a multi-megapixel decode. Same answer the grid's cards
            already give. The blank moment async can leave on a slide change is
            covered from the other side, by preload.ts warming the decode before
            the step happens. */}
        {/* onLoad, not just onTransform: the percent divides by naturalWidth, which
            is 0 until the intrinsic size arrives — the first publish would print
            nothing at all without a second one once the image is really there. A
            cached image can also be complete before this element ever transforms. */}
        {/* pointer-events-auto! is not decoration: react-zoom-pan-pinch's own stylesheet
            sets pointer-events:none on every <img> inside its content box (native
            img-drag protection), which silently killed BOTH the double-click fit toggle
            and the grab cursor for real input. That sheet is unlayered, so it outranks
            any layered utility no matter how specific — the important modifier is what a
            third-party rule written that way leaves available. Receiving the events is
            safe here because the image is draggable={false} in the first place. */}
        {/* #80's grid lives in this extra wrapper, not on TransformComponent's own content
            div: img and the overlay share one grid cell (`display:grid` + the same
            gridArea), so the overlay STRETCHES to exactly the img's own rendered box —
            object-contain can letterbox inside a larger box, and this wrapper is sized to
            the img's OWN content box (max-h/max-w, no explicit size), not the stage — with
            no separate measurement needed. Grid is Zoomable-only (v1 design, #80's
            2026-07-17 fix #2): video/ugoira have no Zoomable to hang it on, so the toolbar
            disables the grid button whenever this component isn't mounted (image-zoom.ts's
            `off`, already the same "no Zoomable this slide" signal). Flip/grayscale land
            directly on the <img> itself instead — the picture, not the stage around it —
            so they stay correct under pan/zoom without fighting the library's own
            transform on the wrapper/content divs above. */}
        <div className="grid max-h-full max-w-full">
          <img
            ref={imgRef}
            data-slot="viewer-image"
            style={{ gridArea: '1 / 1' }}
            className={`pointer-events-auto! max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing ${flip ? 'scale-x-[-1]' : ''} ${gray ? 'grayscale' : ''}`}
            src={src}
            alt={alt}
            decoding="async"
            draggable={false}
            onLoad={publish}
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

// The whole stage: media + prev/next + counter + the inspector toggle. The
// missing state (post deleted from the library) keeps the tab closable per the
// empty-state rule (always offer the next action) — and wears the same Empty
// anatomy as every other empty state in the app now (P2⑫).
export function ImageTab({ model }: { model: ImageTabModel }) {
  const { items, idx, missing, labels } = model;
  const i = items.length ? Math.max(0, Math.min(idx, items.length - 1)) : 0;
  // Keep the neighbours fetched AND decoded (#241). Above the missing-state
  // return so the hook order is stable: an empty list simply preloads nothing
  // and drops whatever the previous tab was holding.
  const preloader = useRef<NeighborPreloader | null>(null);
  useEffect(() => {
    if (!preloader.current) preloader.current = createNeighborPreloader();
    preloader.current.sync(neighborPreloadSources(items, i));
  }, [items, i]);
  useEffect(() => () => preloader.current?.clear(), []);
  // #80's flip/grid/grayscale toggles — read here so every slide type below can apply
  // them, written by image-tab/ViewerToolbar.tsx (services/image-overlay.ts is the
  // shared layer, same event-half shape as image-zoom.ts). Reset once per mount: this
  // component is keyed on model.tabId (image-tab/index.tsx), so a mount here always
  // means either a genuinely fresh image view or a switch to a DIFFERENT tab — never a
  // page turn within the same one (that only changes `idx`, not the key) — matching
  // #80's confirmed lifetime (ephemeral per tab, never carried into another).
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
  const step = (d: number) => model.onIndexChange && model.onIndexChange((i + d + items.length) % items.length);
  return (
    // The per-slide `key` stays (#241 left the choice to implementation). It is
    // what resets zoom/pan to fit on a step, and it is what stops one slide's
    // playback state (ugoira decode loop, <video> position) from bleeding into
    // the next. Dropping it would mean re-deriving all of that from a src-change
    // effect — a strictly larger surface than the thing being sped up — and it
    // would buy nothing here, because what made the step feel cold was the cold
    // fetch+decode, not the remount. With preload.ts warming the neighbours, the
    // remounted <img> hits a warm resource and a warm decode.
    <div data-slot="image-tab-stage" className="relative flex min-w-0 flex-1 overflow-hidden">
      {item.ugoira ? (
        <UgoiraPlayer key={item.src} file={item.ugoira.file} frames={item.ugoira.frames} poster={item.poster} alt={item.alt} labels={labels} flip={overlay.flip} gray={overlay.gray} />
      ) : item.video ? (
        <video key={item.src} data-slot="viewer-video" className={`m-auto max-h-full max-w-full object-contain ${overlay.flip ? 'scale-x-[-1]' : ''} ${overlay.gray ? 'grayscale' : ''}`} src={item.src} controls playsInline preload="metadata" />
      ) : (
        <Zoomable key={item.src} src={item.src} alt={item.alt || ''} flip={overlay.flip} gray={overlay.gray} grid={overlay.grid} />
      )}
      {multi && (
        <>
          {/* Tall and narrow, at the stage's own edges — the shape every image viewer
              (Windows Photos / Eagle / IrfanView) gives these, because the target has to be
              hittable without aiming while the eye is on the picture. */}
          <Button data-slot="image-tab-prev" variant="ghost" size="icon" aria-label={labels.prev} onClick={() => step(-1)} className={`-translate-y-1/2 absolute top-1/2 left-3 z-2 h-14 w-10 ${PLATE}`}>
            <ChevronLeft className="size-6" />
          </Button>
          <Button data-slot="image-tab-next" variant="ghost" size="icon" aria-label={labels.next} onClick={() => step(1)} className={`-translate-y-1/2 absolute top-1/2 right-3 z-2 h-14 w-10 ${PLATE}`}>
            <ChevronRight className="size-6" />
          </Button>
          {/* Not a Badge: this is a live readout of where you are, not a status chip, and
              tabular-nums keeps it from twitching as the index crosses a digit. */}
          <div data-slot="image-tab-counter" className={`-translate-x-1/2 absolute bottom-4 left-1/2 z-2 rounded-full border px-2.5 py-0.5 text-muted-foreground text-xs tabular-nums ${PLATE_SURFACE}`}>
            {i + 1} / {items.length}
          </div>
        </>
      )}
      {/* The inspector toggle rides on the picture because the picture is the whole
          window here; the tooltip is the app's own (shadcn), not the legacy data-tip
          layer, so it matches the zoom cluster in the toolbar band. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button data-slot="image-tab-info" variant="ghost" size="icon-sm" aria-label={labels.info} aria-pressed={!!model.inspectorOpen} onClick={() => model.onToggleInspector?.()} className={`absolute top-3 right-3 z-2 ${model.inspectorOpen ? `${PLATE_SURFACE} text-foreground` : PLATE}`}>
              <Info />
            </Button>
          }
        />
        <TooltipContent side="left">{labels.info}</TooltipContent>
      </Tooltip>
    </div>
  );
}
