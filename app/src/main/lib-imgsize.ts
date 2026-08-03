'use strict';

import ExifReader from 'exifreader';

// Parse image pixel dimensions from a file's leading bytes — no full decode.
// Used by lib-card-dims.ts/lib-media-dims.ts to record each card image's size
// (shotW/shotH) and the dimension facet (mediaMaxW/H, #162) so the renderer can
// reserve a masonry card's height BEFORE its (lazy) image loads, which removes
// the load-time settle/jitter, and so the facet answers with the pixel size the
// browser actually renders. Header-only: callers pass the first ~64KB of the
// file (see lib-card-dims.ts's two-stage read window).
//
// #12: Chromium's default `image-orientation: from-image` means it renders a
// JPEG rotated per its EXIF Orientation tag, but the SOF/IHDR/etc. parsers
// below only ever returned the UNROTATED frame size — so a portrait photo
// (Orientation 5-8) got a landscape shotW/shotH, misreporting its own aspect
// ratio and (once #162 shipped) its answer to the dimension facet. imageSize()
// now reads Orientation via exifreader (the same buffer window, no extra file
// read) and swaps width/height for 5-8 so callers always get the DISPLAYED
// size. exifreader also throws on unparseable input, so any failure to read
// Orientation (no EXIF, corrupt EXIF, non-JPEG) silently keeps the frame size
// as-is — orientation is a best-effort refinement, not a requirement.
//
// Electron-free, so it unit-tests in plain node.

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

// WebP 'Animation' flag: bit 1 of the VP8X flags byte (offset 20), per the
// container spec's `Rsv|I|L|E|X|A|R` layout — set only when the file carries
// ANIM/ANMF chunks, not merely wrapped in VP8X for alpha/ICC/Exif/XMP. A plain
// VP8/VP8L file (no VP8X container at all) can never be an animation. #8: this
// is what tells an animated webp apart from a static one so records.ts can give
// only the former the same "skip the thumbnail, keep it playing" treatment
// .gif already gets — a static webp is exactly the case this issue wants
// thumbnailed.
function webpIsAnimated(buf) {
  if (!buf || buf.length < 21) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  if (buf.toString('ascii', 12, 16) !== 'VP8X') return false;
  return (buf[20] & 0x02) !== 0;
}

// AVIF: an ISOBMFF (box) container, the same family as HEIF/MP4. Width/height
// live in the 'ispe' (Image Spatial Extents) property, reached by walking
// ftyp -> meta -> iprp -> ipco -> ispe. Bounded, defensive box walk (mirrors
// this file's own style for the other formats): any box whose declared size
// doesn't fit the buffer, or a size <= 0, stops the walk and reports "couldn't
// measure" rather than looping or reading out of bounds.
function readBoxHeader(buf, off, limit) {
  if (off + 8 > limit) return null;
  let size = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  let headerLen = 8;
  if (size === 1) {
    // 64-bit extended size — only the low 32 bits matter for a header-window
    // read this small; a box that large could never fit anyway.
    if (off + 16 > limit) return null;
    size = buf.readUInt32BE(off + 12);
    headerLen = 16;
  } else if (size === 0) {
    size = limit - off; // "extends to the end of the enclosing box"
  }
  if (size < headerLen) return null;
  return { type, headerLen, size };
}
function findBox(buf, start, end, targetType) {
  let off = start;
  while (off + 8 <= end) {
    const box = readBoxHeader(buf, off, end);
    if (!box) return null;
    if (box.type === targetType) return { start: off + box.headerLen, end: Math.min(off + box.size, end) };
    if (box.size <= 0) return null; // guard against an infinite loop on corrupt input
    off += box.size;
  }
  return null;
}
function avifSize(buf) {
  if (!buf || buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brand = buf.toString('ascii', 8, 12);
  if (brand !== 'avif' && brand !== 'avis') return null; // not AVIF's ftyp — HEIC/HEIF share this container
  const meta = findBox(buf, 0, buf.length, 'meta');
  if (!meta) return null;
  const iprp = findBox(buf, meta.start + 4, meta.end, 'iprp'); // meta is a FullBox: 4-byte version+flags before its children
  if (!iprp) return null;
  const ipco = findBox(buf, iprp.start, iprp.end, 'ipco');
  if (!ipco) return null;
  // Multiple 'ispe' boxes can exist (thumbnail + primary item, an alpha plane);
  // the first one is the primary image's in every encoder this was checked
  // against (libavif) — good enough for a best-effort header sniff.
  let off = ipco.start;
  while (off + 8 <= ipco.end) {
    const box = readBoxHeader(buf, off, ipco.end);
    if (!box) break;
    if (box.type === 'ispe' && off + box.headerLen + 12 <= ipco.end) {
      // ispe is a FullBox (4-byte version+flags) then image_width/image_height, big-endian uint32.
      const w = buf.readUInt32BE(off + box.headerLen + 4);
      const h = buf.readUInt32BE(off + box.headerLen + 8);
      return w && h ? { width: w, height: h } : null;
    }
    if (box.size <= 0) break;
    off += box.size;
  }
  return null;
}

// No real photo, screen, or scan legitimately exceeds this on either axis;
// PNG's IHDR (32-bit) and WebP VP8X (24-bit) width/height fields can otherwise
// claim billions of pixels from a few attacker-controlled bytes. Treat that as
// "couldn't measure" rather than propagating it — the save-folder path
// containment (resolveWithin, lib-card-dims.ts) applies the same "don't trust
// record-derived input" rule to paths; this is the same rule for numbers.
const MAX_DIMENSION = 65535;

// EXIF Orientation (tag 0x0112): 1 = normal, 5-8 = the frame is rotated 90°,
// so width/height must swap to match what's actually displayed. Reads from the
// SAME buffer already passed to imageSize() — Orientation lives in IFD0, right
// after the TIFF header, so it's always within the header window callers pass
// in, even for the big-EXIF retry case. No-EXIF and corrupt-EXIF images throw
// or return no tag, either way this falls back to null (unrotated).
function readOrientation(buf) {
  try {
    const tags = ExifReader.load(buf, { includeTags: { exif: ['Orientation'] } });
    const value = tags?.Orientation?.value;
    return typeof value === 'number' && value >= 1 && value <= 8 ? value : null;
  } catch {
    return null;
  }
}

// Detect format by signature and return { width, height } or null.
function imageSize(buf) {
  if (!buf || buf.length < 10) return null;
  const dim = jpegSize(buf) || pngSize(buf) || gifSize(buf) || webpSize(buf) || avifSize(buf) || null;
  if (!dim || dim.width > MAX_DIMENSION || dim.height > MAX_DIMENSION) return null;
  const orientation = readOrientation(buf);
  return orientation && orientation >= 5 ? { width: dim.height, height: dim.width } : dim;
}

export { imageSize, jpegSize, pngSize, gifSize, webpSize, avifSize, webpIsAnimated };
