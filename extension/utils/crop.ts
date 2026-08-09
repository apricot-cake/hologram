// captureVisibleTab のスクリーンショットを、1件の投稿の矩形まで切り出す。
//
// スクリーンショットを撮る2つの保存経路（単発の Alt+S バナー（capture.ts）
// とブックマークの一括取り込み（bulk-capture.ts））は、どちらも background
// から同じ {type:'cropImage'} メッセージに応答するため、計算はここに一本化
// してあり、2つのメッセージハンドラへ複製してずれるのを避けている。

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// `liveRect` は投稿を「今」測り直す＝スクリーンショットが撮られたのはキャプ
// チャが要求された瞬間ではなく少し前のことで、その間に慣性スクロールや遅延
// 読み込み画像のレイアウト確定が投稿の位置をずらすことがある。要素が消えて
// いれば null を返し、その場合は background が返してきた矩形を使う。
//
// 結果はビューポートにクランプする。captureVisibleTab が持つのは可視ピクセ
// ルだけなので、はみ出した矩形は保存画像の端に欠落領域を黒帯として焼き込ん
// でしまう。
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
