'use strict';

import { imageSize as readImageSize } from 'image-size';

// masonry のカード高と寸法ファセットに使う表示上のピクセル寸法。画像全体を復号せず、
// 呼び出し元が渡すヘッダの範囲だけを image-size で解析する。対応形式はローカル取り込みと
// 同じ JPEG/PNG/GIF/WebP/AVIF に限定し、ライブラリが読める他形式まで製品範囲を広げない。
const SUPPORTED_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);

// 壊れたヘッダが非現実的な寸法を申告しても、レイアウトやファセットへ伝播させない。
const MAX_DIMENSION = 65535;

export function imageSize(buf: Buffer | Uint8Array | null | undefined): { width: number; height: number } | null {
  if (!buf || buf.byteLength < 10) return null;
  try {
    let input = buf;
    // image-size 2.0.2 は静止 AVIF の major brand `avif` を認識するが、同じ箱構造を使う
    // image sequence の `avis` は認識しない。現行対応を保つため、解析用の写しだけを
    // `avif` として渡す。保存ファイルは変更しない。
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    if (bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.toString('ascii', 8, 12) === 'avis') {
      const copy = Buffer.from(bytes);
      copy.write('avif', 8, 'ascii');
      input = copy;
    }
    const measured = readImageSize(input);
    if (!SUPPORTED_TYPES.has(String(measured.type || '').toLowerCase())) return null;
    let width = measured.width;
    let height = measured.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;

    // Chromium の image-orientation: from-image と同じ表示寸法にする。JPEG の EXIF
    // Orientation 5〜8 はフレームを90度回すため、幅と高さを入れ替える。
    if (measured.orientation != null && measured.orientation >= 5) [width, height] = [height, width];
    return { width, height };
  } catch {
    return null;
  }
}

// WebP の Animation フラグは寸法ライブラリの責務外。VP8X の flags バイトの bit 1 だけを
// 読み、アニメーションWebPを静止サムネイルへ平坦化しないために残す。
export function webpIsAnimated(buf: Buffer | Uint8Array | null | undefined): boolean {
  if (!buf || buf.byteLength < 21) return false;
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return false;
  if (bytes.toString('ascii', 12, 16) !== 'VP8X') return false;
  return (bytes[20] & 0x02) !== 0;
}
