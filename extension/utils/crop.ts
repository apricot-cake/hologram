// Crop a captureVisibleTab screenshot down to one post's rectangle.
//
// Both save paths that take a screenshot — the single-shot Alt+S banner
// (capture.ts) and the bookmarks bulk intake (bulk-capture.ts) — answer the
// same {type:'cropImage'} message from the background, so the arithmetic lives
// here rather than being mirrored in two message handlers that could drift.

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// `liveRect` re-measures the post NOW: the screenshot was taken moments ago,
// not when the capture was requested, and inertial scroll or a lazy image
// finishing layout can shift the post in between. It returns null when the
// element is gone, in which case the rect the background echoed back is used.
//
// The result is clamped to the viewport because captureVisibleTab only has
// visible pixels — an overflowing rect would encode the missing area as black
// bands down the side of the saved image.
export function cropScreenshot(dataUrl: string, rect: CropRect, liveRect?: () => CropRect | null): Promise<string | null> {
  return new Promise((resolve) => {
    let use = rect;
    if (liveRect) {
      try {
        use = liveRect() || rect;
      } catch {
        use = rect;
      }
    }
    const dpr = window.devicePixelRatio || 1;
    const cx = Math.max(0, use.x);
    const cy = Math.max(0, use.y);
    const cw = Math.max(1, Math.min(use.x + use.width, window.innerWidth) - cx);
    const ch = Math.max(1, Math.min(use.y + use.height, window.innerHeight) - cy);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const w = Math.round(cw * dpr);
      const h = Math.round(ch * dpr);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(img, Math.round(cx * dpr), Math.round(cy * dpr), w, h, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
