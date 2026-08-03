// Unit test for app/src/main/lib-imgsize.ts, the "header-only image size parser"
// the index uses to measure masonry cards up front. Builds a minimal synthetic
// header for each supported format and also checks rejection of broken input.

import { describe, expect, test } from 'vitest';
import { imageSize } from '../app/src/main/lib-imgsize';

// JPEG: SOI + SOF0 (precision, height, width, ...).
function jpeg(w: number, h: number) {
  return Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, len 17, precision 8
    (h >> 8) & 0xff,
    h & 0xff,
    (w >> 8) & 0xff,
    w & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
}

// JPEG with an APP0 (JFIF) segment before the SOF, like a real encoder emits.
function jpegWithApp0(w: number, h: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, jpeg(w, h).subarray(2)]);
}

function png(w: number, h: number) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

function gif(w: number, h: number) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

function webpVP8X(w: number, h: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  b[24] = (w - 1) & 0xff;
  b[25] = ((w - 1) >> 8) & 0xff;
  b[26] = ((w - 1) >> 16) & 0xff;
  b[27] = (h - 1) & 0xff;
  b[28] = ((h - 1) >> 8) & 0xff;
  b[29] = ((h - 1) >> 16) & 0xff;
  return b;
}

describe('ヘッダから寸法を読む', () => {
  test('jpeg SOF0', () => {
    expect(imageSize(jpeg(800, 1200))).toEqual({ width: 800, height: 1200 });
  });

  test('jpeg（SOF の前に APP0）', () => {
    expect(imageSize(jpegWithApp0(640, 480))).toEqual({ width: 640, height: 480 });
  });

  test('png IHDR', () => {
    expect(imageSize(png(1024, 768))).toEqual({ width: 1024, height: 768 });
  });

  test('gif logical screen', () => {
    expect(imageSize(gif(320, 240))).toEqual({ width: 320, height: 240 });
  });

  test('webp VP8X canvas', () => {
    expect(imageSize(webpVP8X(1024, 768))).toEqual({ width: 1024, height: 768 });
  });
});

describe('壊れた入力は null', () => {
  test('短すぎる', () => {
    expect(imageSize(Buffer.alloc(4))).toBeNull();
  });

  test('画像でないバイト列', () => {
    expect(imageSize(Buffer.from('not an image at all, just text'))).toBeNull();
  });

  test('null', () => {
    expect(imageSize(null)).toBeNull();
  });
});

// #12: a JPEG's SOF frame size is always the UNROTATED size — a portrait photo
// (Orientation 5-8) needs width/height swapped to match what Chromium actually
// renders (`image-orientation: from-image` is the default, unset in this repo).
// Build a minimal Exif APP1 segment (TIFF header + one-entry IFD0) so we can
// drive imageSize()'s orientation handling without a real photo in the repo.
function tiffIfd0(entries: Array<{ tag: number; type: number; count: number; value: number }>) {
  const b = Buffer.alloc(8 + 2 + entries.length * 12 + 4);
  b.write('II', 0, 'ascii'); // little-endian TIFF header
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4); // offset to IFD0
  let off = 8;
  b.writeUInt16LE(entries.length, off);
  off += 2;
  for (const e of entries) {
    b.writeUInt16LE(e.tag, off);
    b.writeUInt16LE(e.type, off + 2);
    b.writeUInt32LE(e.count, off + 4);
    b.writeUInt16LE(e.value, off + 8); // SHORT value in the first 2 bytes of the 4-byte slot
    off += 12;
  }
  b.writeUInt32LE(0, off); // next-IFD offset: none
  return b;
}

function exifApp1(tiff: Buffer) {
  const data = Buffer.concat([Buffer.from('Exif\x00\x00', 'ascii'), tiff]);
  const seg = Buffer.alloc(4);
  seg.writeUInt8(0xff, 0);
  seg.writeUInt8(0xe1, 1);
  seg.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([seg, data]);
}

const ORIENTATION_TAG = 0x0112;
const TYPE_SHORT = 3;

function jpegWithOrientation(w: number, h: number, orientation: number) {
  const app1 = exifApp1(tiffIfd0([{ tag: ORIENTATION_TAG, type: TYPE_SHORT, count: 1, value: orientation }]));
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, jpeg(w, h).subarray(2)]);
}

describe('EXIF Orientation を寸法へ畳む（#12）', () => {
  test('Orientation 1（正立）は寸法をそのまま返す', () => {
    expect(imageSize(jpegWithOrientation(800, 600, 1))).toEqual({ width: 800, height: 600 });
  });

  test('Orientation 6（90°回転）は width/height を入れ替える', () => {
    expect(imageSize(jpegWithOrientation(800, 600, 6))).toEqual({ width: 600, height: 800 });
  });

  test('Orientation 8（270°回転）も入れ替える', () => {
    expect(imageSize(jpegWithOrientation(800, 600, 8))).toEqual({ width: 600, height: 800 });
  });

  test('EXIF が無い JPEG は入れ替えない', () => {
    expect(imageSize(jpeg(800, 600))).toEqual({ width: 800, height: 600 });
  });

  test('壊れた EXIF（IFD0 のエントリ数が実データより多いと申告）でも例外を投げず、寸法はそのまま', () => {
    const badTiff = Buffer.alloc(8 + 2 + 12 + 4);
    badTiff.write('II', 0, 'ascii');
    badTiff.writeUInt16LE(42, 2);
    badTiff.writeUInt32LE(8, 4);
    badTiff.writeUInt16LE(50, 8); // claims 50 entries; buffer holds room for 1
    badTiff.writeUInt16LE(ORIENTATION_TAG, 10);
    badTiff.writeUInt16LE(TYPE_SHORT, 12);
    badTiff.writeUInt32LE(1, 14);
    badTiff.writeUInt16LE(6, 18); // Orientation 6, still readable despite the bogus count
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), exifApp1(badTiff), jpeg(800, 600).subarray(2)]);
    expect(imageSize(buf)).toEqual({ width: 600, height: 800 });
  });

  test('PNG（そもそも Exif Orientation を持たない）は寸法をそのまま返す', () => {
    expect(imageSize(png(1024, 768))).toEqual({ width: 1024, height: 768 });
  });
});

describe('非現実的な寸法はクランプして null（敵性入力対策・#12）', () => {
  test('PNG の IHDR が巨大な幅を申告 → 測れなかった扱い', () => {
    const b = png(100, 100);
    b.writeUInt32BE(0xffffffff, 16); // width
    expect(imageSize(b)).toBeNull();
  });

  test('WebP VP8X の幅が上限を超える → 測れなかった扱い', () => {
    const b = webpVP8X(100, 100);
    b[24] = 0xff;
    b[25] = 0xff;
    b[26] = 0xff; // 24-bit width field maxed out
    expect(imageSize(b)).toBeNull();
  });
});
