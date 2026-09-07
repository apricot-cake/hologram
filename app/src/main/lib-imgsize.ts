'use strict';

import { imageSize as readImageSize } from 'image-size';

// masonry のカード高と寸法ファセットに使う表示上のピクセル寸法。画像全体を復号せず、
// 呼び出し元が渡すヘッダの範囲だけを image-size で解析する。対応形式はローカル取り込みと
// 同じ JPEG/PNG/GIF/WebP/AVIF に限定し、ライブラリが読める他形式まで製品範囲を広げない。
const SUPPORTED_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);

// 壊れたヘッダが非現実的な寸法を申告しても、レイアウトやファセットへ伝播させない。
const MAX_DIMENSION = 65535;

// GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq: 対応外のパーサーへ渡さず、
// AVIF はゼロ長・親境界外のボックスを解析前に拒否する。
function safeImageHeader(bytes: Buffer): boolean {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
  if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return true;
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return true;
  if (bytes.toString('ascii', 4, 8) !== 'ftyp' || !['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) return false;
  const validBoxes = (start: number, end: number, depth: number): boolean => {
    if (depth > 4) return false;
    for (let offset = start; offset < end; ) {
      if (offset + 8 > end) return false;
      const size = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      // 呼び出し元は画像の先頭部分だけを渡す。末尾の媒体本体は切れていてよい。
      if (depth === 0 && type === 'mdat' && size > end - offset) return true;
      if (size < 8 || size > end - offset) return false;
      if (type === 'ispe' && size < 20) return false;
      if (type === 'meta' || type === 'iprp' || type === 'ipco') {
        const child = offset + (type === 'meta' ? 12 : 8);
        if (child > offset + size || !validBoxes(child, offset + size, depth + 1)) return false;
      }
      offset += size;
    }
    return true;
  };
  return validBoxes(0, bytes.length, 0);
}

export function imageSize(buf: Buffer | Uint8Array | null | undefined): { width: number; height: number } | null {
  if (!buf || buf.byteLength < 10) return null;
  try {
    let input = buf;
    // image-size 2.0.2 は静止 AVIF の major brand `avif` を認識するが、同じ箱構造を使う
    // image sequence の `avis` は認識しない。現行対応を保つため、解析用の写しだけを
    // `avif` として渡す。保存ファイルは変更しない。
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    if (!safeImageHeader(bytes)) return null;
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
