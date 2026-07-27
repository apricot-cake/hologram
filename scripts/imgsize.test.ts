// app/src/main/lib-imgsize.ts のユニットテスト＝インデックスがメイソンリーのカードを
// 先に採寸するために使う「ヘッダだけ読む画像寸法パーサ」。対応形式ごとに最小の
// 合成ヘッダを作り、壊れた入力の拒否まで見る。

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
