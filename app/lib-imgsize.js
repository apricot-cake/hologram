'use strict';

// Parse image pixel dimensions from a file's leading bytes — no decode, no deps.
// Used by lib-index.js to record each card image's size (shotW/shotH) so the
// renderer can reserve a masonry card's height BEFORE its (lazy) image loads,
// which removes the load-time settle/jitter. Header-only: callers pass the first
// ~64KB of the file. Electron-free, so it unit-tests in plain node.

// JPEG: scan marker segments until a Start-Of-Frame (SOFn) carries height/width.
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    } // resync over fill/pad
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off++;
      continue;
    } // run of 0xFF padding
    // Standalone markers (no length): SOI/EOI, RSTn, TEM.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    if (off + 4 > buf.length) break;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    // SOF0..SOF15 hold the frame size — except DHT(C4), JPG(C8), DAC(CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (off + 9 > buf.length) break;
      const h = buf.readUInt16BE(off + 5);
      const w = buf.readUInt16BE(off + 7);
      return w && h ? { width: w, height: h } : null;
    }
    off += 2 + len;
  }
  return null;
}

// PNG: IHDR is the first chunk; width@16, height@20 (big-endian).
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w && h ? { width: w, height: h } : null;
}

// GIF: logical screen width/height at offset 6/8 (little-endian).
function gifSize(buf) {
  if (buf.length < 10) return null;
  if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null; // "GIF"
  const w = buf.readUInt16LE(6);
  const h = buf.readUInt16LE(8);
  return w && h ? { width: w, height: h } : null;
}

// WebP: RIFF container, three sub-formats (lossy VP8, lossless VP8L, extended VP8X).
function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const fmt = buf.toString('ascii', 12, 16);
  if (fmt === 'VP8 ') {
    const w = (buf[26] | (buf[27] << 8)) & 0x3fff;
    const h = (buf[28] | (buf[29] << 8)) & 0x3fff;
    return w && h ? { width: w, height: h } : null;
  }
  if (fmt === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b0 = buf[21],
      b1 = buf[22],
      b2 = buf[23],
      b3 = buf[24];
    const w = 1 + (((b1 & 0x3f) << 8) | b0);
    const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return w && h ? { width: w, height: h } : null;
  }
  if (fmt === 'VP8X') {
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return w && h ? { width: w, height: h } : null;
  }
  return null;
}

// Detect format by signature and return { width, height } or null.
function imageSize(buf) {
  if (!buf || buf.length < 10) return null;
  return jpegSize(buf) || pngSize(buf) || gifSize(buf) || webpSize(buf) || null;
}

module.exports = { imageSize, jpegSize, pngSize, gifSize, webpSize };
