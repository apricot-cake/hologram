'use strict';

// Unit test for app/lib-imgsize.js — the header-only image dimension parser used
// by the index to size masonry cards up front. Synthetic minimal headers for each
// supported format, plus garbage rejection.
//
//   node scripts/test-imgsize.js

const assert = require('node:assert');
const { imageSize } = require('../app/lib-imgsize.mts');

// JPEG: SOI + SOF0 (precision, height, width, ...).
function jpeg(w, h) {
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
function jpegWithApp0(w, h) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, jpeg(w, h).subarray(2)]);
}
function png(w, h) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function gif(w, h) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}
function webpVP8X(w, h) {
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

const eq = (got, w, h, msg) => assert.deepStrictEqual(got, { width: w, height: h }, msg);

eq(imageSize(jpeg(800, 1200)), 800, 1200, 'jpeg SOF0');
eq(imageSize(jpegWithApp0(640, 480)), 640, 480, 'jpeg with APP0 before SOF');
eq(imageSize(png(1024, 768)), 1024, 768, 'png IHDR');
eq(imageSize(gif(320, 240)), 320, 240, 'gif logical screen');
eq(imageSize(webpVP8X(1024, 768)), 1024, 768, 'webp VP8X canvas');

assert.strictEqual(imageSize(Buffer.alloc(4)), null, 'too short -> null');
assert.strictEqual(imageSize(Buffer.from('not an image at all, just text')), null, 'garbage -> null');
assert.strictEqual(imageSize(null), null, 'null -> null');

console.log('PASS test-imgsize: jpeg(+APP0)/png/gif/webp sizes parsed, garbage rejected');
