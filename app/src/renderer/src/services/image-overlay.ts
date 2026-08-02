// Image-view drawing-aid overlay toggles (#80): flip horizontal, grid, grayscale — the
// viewer toolbar's SECOND cluster, right of the zoom cluster (image-zoom.ts).
//
// Unlike zoom, this state lives ABOVE the per-slide remount: image-tab/ImageTab.tsx keys
// Zoomable / <video> / UgoiraPlayer on `item.src`, so a naive per-slide store would reset
// on every page turn — but #80's confirmed design (2026-07-17) has the toggles survive
// paging within one image view ("タブ内一時・ページ送りで維持"). So this module is a plain
// module-level store, written directly by the toolbar buttons and read directly by the
// stage — no per-slide register/unregister like image-zoom.ts needs (there is no imperative
// DOM instance to hand over here, just three booleans).
//
// The leak this guards against: switching from one image tab straight to another (both
// already showing their own image view) never unmounts image-tab/index.tsx's host — only
// the `activeImageTab` store value changes identity. image-tab/ImageTab.tsx keys itself on
// the tab id specifically so THIS module's reset() runs on that switch (see its mount
// effect) — the toggles must never carry from one tab's picture into another's.
export interface ImageOverlayState {
  readonly flip: boolean;
  readonly grid: boolean;
  readonly gray: boolean;
}

const IDLE: ImageOverlayState = { flip: false, grid: false, gray: false };

// Replaced (never mutated) so useSyncExternalStore's snapshot identity is a real change signal.
let state: ImageOverlayState = IDLE;
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

export const getState = (): ImageOverlayState => state;
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function toggleFlip(): void {
  state = { ...state, flip: !state.flip };
  notify();
}
export function toggleGrid(): void {
  state = { ...state, grid: !state.grid };
  notify();
}
export function toggleGray(): void {
  state = { ...state, gray: !state.gray };
  notify();
}

// Called once by image-tab/ImageTab.tsx's mount effect — fires on every distinct image
// tab (its key is the tab id) so the three toggles always start OFF for a freshly opened
// or switched-to view, per #80's confirmed lifetime (never persisted, never carried over).
export function reset(): void {
  state = IDLE;
  notify();
}
