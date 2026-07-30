// Image-view zoom: the shared layer between the stage and the toolbar (#150).
//
// Zoom/pan itself is react-zoom-pan-pinch, living inside image-tab/ImageTab.tsx's
// Zoomable — which is remounted per slide (`key={item.src}`) and therefore cannot be
// the thing a toolbar in the app's top band talks to. So the stage REGISTERS a
// controller here while it is mounted, and PUBLISHES what the toolbar has to show;
// the toolbar only reads. Same event-half shape as the other services (lightbox.ts /
// panels.ts): the state lives next to the rules that decide it, and the components
// on either side subscribe.
//
// "No controller registered" is the single source for "there is nothing to zoom" —
// it covers a video slide and an うごイラ slide (neither renders a Zoomable) without
// either of them having to say so.
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';

// Wheel-zoom tuning, now shared by the toolbar's ± (#134 → #150): one wheel notch
// and one button press are the SAME multiplicative step, so the two inputs cannot
// drift into different zoom ladders.
export const MIN_SCALE = 1;
export const MAX_SCALE = 40;
export const ZOOM_STEP = 1.25;
export const ZOOM_MS = 200;
// The fit⇄actual jump keeps its own (shorter) easing — it is one jump, not a notch.
export const FIT_MS = 180;
// react-zoom-pan-pinch's scale is FIT-based (fit = 1), so "am I still at fit" is a
// band around 1, not an equality. 1.02 is the threshold the double-click toggle has
// always used; the toolbar reads the same one so the button and the gesture agree.
export const FIT_EPSILON = 1.02;
// An image smaller than the stage is already at 1 image px = 1 screen px when it is
// fitted, so "actual size" would be a no-op — the toggle zooms in a fixed step
// instead (existing double-click behaviour, kept).
export const SMALL_IMAGE_ZOOM = 2.5;
export const ACTUAL_MIN_RATIO = 1.05;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

// One notch of zoom off `base`. dir = +1 in, -1 out.
export const steppedScale = (base: number, dir: number): number => clampScale(base * ZOOM_STEP ** dir);

// The scale at which one image pixel covers one CSS pixel. offsetWidth is the LAYOUT
// (fit) width — the CSS transform does not touch it — so this ratio is exact.
// Falls back to 1 (= fit) while the image has no intrinsic size yet.
export const actualScaleOf = (naturalWidth: number, offsetWidth: number): number => (offsetWidth > 0 && naturalWidth > 0 ? naturalWidth / offsetWidth : 1);

export const isAtFit = (scale: number): boolean => scale <= FIT_EPSILON;

// What the fit⇄actual toggle should do from here. One function so the button, the
// double-click and Ctrl+0/Ctrl+1 cannot describe three different toggles.
export type FitToggleTarget = { fit: true } | { fit: false; scale: number };
export const fitToggleTarget = (scale: number, actual: number): FitToggleTarget => (isAtFit(scale) ? { fit: false, scale: actual > ACTUAL_MIN_RATIO ? actual : SMALL_IMAGE_ZOOM } : { fit: true });
// The non-fit half on its own (Ctrl+1 / the toggle's zoom-in branch).
export const actualTarget = (actual: number): number => (actual > ACTUAL_MIN_RATIO ? actual : SMALL_IMAGE_ZOOM);

// The number the toolbar prints. The library's scale is fit-based, so scale alone
// would read 100% on a picture shown at 38% of its pixels — normalise it against the
// image's own width so 100% means actual size, the way every viewer's readout does.
// null = not knowable yet (no layout box, or the intrinsic size has not arrived) —
// the readout shows a placeholder rather than a 0 or a NaN.
export const zoomPercentOf = (scale: number, offsetWidth: number, naturalWidth: number): number | null => (offsetWidth > 0 && naturalWidth > 0 && Number.isFinite(scale) ? Math.round((scale * offsetWidth * 100) / naturalWidth) : null);

// The commands the toolbar (and Ctrl+0/Ctrl+1) can issue. Implemented by the stage.
export interface ImageZoomController {
  step(dir: 1 | -1): void;
  toggleFitActual(): void;
  fit(): void;
  actual(): void;
}

export interface ImageZoomState {
  // null ⟺ the current slide has no zoom (video / うごイラ / no image tab at all).
  readonly controller: ImageZoomController | null;
  readonly percent: number | null;
  readonly atFit: boolean;
  readonly canZoomIn: boolean;
  readonly canZoomOut: boolean;
}

export type ImageZoomView = Omit<ImageZoomState, 'controller'>;

const IDLE: ImageZoomState = { controller: null, percent: null, atFit: true, canZoomIn: false, canZoomOut: false };

// Replaced (never mutated) so useSyncExternalStore's snapshot identity is a real
// change signal.
let state: ImageZoomState = IDLE;
const subs = new Set<() => void>();

const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* a bad subscriber must not stop the rest */
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

// Called by the mounted stage. Unregistering only clears when the caller is still the
// live one — a keyed remount can tear down the old slide after the new one registered.
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
  if (!s.controller) return; // nothing is mounted — a late frame from a dead slide
  if (s.percent === view.percent && s.atFit === view.atFit && s.canZoomIn === view.canZoomIn && s.canZoomOut === view.canZoomOut) return;
  state = { controller: s.controller, ...view };
  notify();
}

// Ctrl+0 = fit, Ctrl+1 = actual size (the browser / Photoshop / Windows フォト
// convention). Registered in App.tsx's GlobalShortcuts.
//
// The registered controller IS the guard for "an image is on screen": it only exists
// while a zoomable slide is mounted. The overlay checks mirror the ←/→ handler in
// image-tab/index.tsx — a dialog over the image view owns the keyboard.
export function handleShortcutZoomKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if (e.key !== '0' && e.key !== '1') return;
  const ctl = state.controller;
  if (!ctl) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (lightboxIsOpen() || settingsIsOpen() || confirmGet()) return;
  e.preventDefault();
  if (e.key === '0') ctl.fit();
  else ctl.actual();
}
