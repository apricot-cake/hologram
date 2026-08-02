// Unit tests for app/src/main/lib-media-dims.ts (#162 — mediaMaxW/mediaMaxH/
// mediaMaxBytes, the dimension/file-size facet's per-record aggregate). Real
// files on a real temp folder (fillMediaDims reads headers and stats bytes,
// same as lib-card-dims.ts's fillCardDims it's meant to run alongside), no DB
// or Electron involved — plain node, like lib-card-dims.ts itself.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, describe, expect, test } from 'vitest';
import { fillMediaDims } from '../app/src/main/lib-media-dims.ts';

// --- A real PNG whose dimensions can actually be measured (same tiny encoder
// clipboard-intake.test.ts uses — readImageDims reads the header, so it needs
// a byte sequence with real content, not a stub). ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc(h * (1 + w * 3), 0x40);
  for (let y = 0; y < h; y++) raw[y * (1 + w * 3)] = 0; // filter: none
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

const dirs: string[] = [];
function mkFolder(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-media-dims-'));
  dirs.push(d);
  return d;
}
function write(folder: string, name: string, data: Buffer) {
  fs.writeFileSync(path.join(folder, name), data);
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('media[] あり: 幅・高さは画像の最大値、サイズは全ファイルの最大バイト数', () => {
  test('複数画像 — 最大の幅・高さを別々に集約（同じ1枚である必要はない）', () => {
    const folder = mkFolder();
    const small = makePng(100, 400); // tall
    const big = makePng(800, 200); // wide
    write(folder, 'a.png', small);
    write(folder, 'b.png', big);
    const rec: any = { media: [{ file: 'a.png' }, { file: 'b.png' }] };
    fillMediaDims(folder, rec);
    expect(rec.mediaMaxW).toBe(800); // from b.png
    expect(rec.mediaMaxH).toBe(400); // from a.png
    expect(rec.mediaMaxBytes).toBe(Math.max(small.length, big.length));
  });

  test('動画混在 — 動画ファイルは寸法に寄与しないが、サイズ最大には寄与しうる', () => {
    const folder = mkFolder();
    const still = makePng(50, 60);
    const video = Buffer.alloc(999999, 0x11); // far bigger than the still, but not measurable as an image
    write(folder, 'still.png', still);
    write(folder, 'clip.mp4', video);
    const rec: any = { media: [{ file: 'still.png' }, { file: 'clip.mp4', type: 'video' }] };
    fillMediaDims(folder, rec);
    expect(rec.mediaMaxW).toBe(50);
    expect(rec.mediaMaxH).toBe(60);
    expect(rec.mediaMaxBytes).toBe(video.length); // the video is the biggest FILE, even though it's not the biggest picture
  });

  test('全て動画（測れる画像が無い） — 幅・高さは0、サイズは動画のバイト数（ポスターでの代用はしない・#119 の領分）', () => {
    const folder = mkFolder();
    const video = Buffer.alloc(4096, 0x22);
    write(folder, 'clip.mp4', video);
    const rec: any = { media: [{ file: 'clip.mp4', type: 'video', posterFile: 'poster.jpg' }] };
    fillMediaDims(folder, rec);
    expect(rec.mediaMaxW).toBe(0);
    expect(rec.mediaMaxH).toBe(0);
    expect(rec.mediaMaxBytes).toBe(video.length);
  });

  test('存在しないファイル参照 — 0扱いに落ちる（例外を投げない）', () => {
    const folder = mkFolder();
    const rec: any = { media: [{ file: 'missing.png' }] };
    fillMediaDims(folder, rec);
    expect(rec.mediaMaxW).toBe(0);
    expect(rec.mediaMaxH).toBe(0);
    expect(rec.mediaMaxBytes).toBe(0);
  });
});

describe('media[] が空 — カード画像（shotW/H・その実ファイル）にフォールバック', () => {
  test('shotW/H を再利用し、カード画像ファイルの実バイト数を測る', () => {
    const folder = mkFolder();
    const shot = makePng(640, 480);
    write(folder, 'cap-1.png', shot);
    const rec: any = { media: [], image: 'cap-1.png', shotW: 640, shotH: 480 };
    fillMediaDims(folder, rec);
    expect(rec.mediaMaxW).toBe(640);
    expect(rec.mediaMaxH).toBe(480);
    expect(rec.mediaMaxBytes).toBe(shot.length);
  });

  test('shotW/H が0（採寸不能）のまま伝播する', () => {
    const folder = mkFolder();
    const rec: any = { media: [], image: '', shotW: 0, shotH: 0 };
    fillMediaDims(folder, rec);
    expect(rec.mediaMaxW).toBe(0);
    expect(rec.mediaMaxH).toBe(0);
    expect(rec.mediaMaxBytes).toBe(0); // no card image file at all
  });
});

describe('一度だけ測る（既にある値は上書きしない）・folder が無ければ何もしない', () => {
  test('mediaMaxW が既に入っていれば再測定しない（ZIP round-trip 等）', () => {
    const folder = mkFolder();
    write(folder, 'a.png', makePng(999, 999));
    const rec: any = { media: [{ file: 'a.png' }], mediaMaxW: 10, mediaMaxH: 20, mediaMaxBytes: 30 };
    fillMediaDims(folder, rec);
    expect(rec).toMatchObject({ mediaMaxW: 10, mediaMaxH: 20, mediaMaxBytes: 30 });
  });

  test('folder が無ければ触らない', () => {
    const rec: any = { media: [{ file: 'a.png' }] };
    fillMediaDims(null, rec);
    expect(rec.mediaMaxW).toBeUndefined();
  });
});
