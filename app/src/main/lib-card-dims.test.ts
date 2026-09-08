// app/src/main/lib-card-dims.ts の readImageDims()/fillCardDims() の単体テスト (#12)。
// とくに imgsize.test.ts では覆えない部分＝ディスク上の実ファイルが要るところ。IMG_EXT の
// 門（そもそもどの拡張子を測るか）と、二段の読み取り窓（SOF が最初の 64KB より後ろに落ちる
// JPEG）。素の node で、DB も Electron も絡まない＝lib-media-dims.test.ts と同じ書き方。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { fillCardDims, readImageDims, readWebpAnimated } from './lib-card-dims.ts';

function jpeg(w: number, h: number) {
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0、長さ 17、精度 8
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
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

// SOF が 64KB の1回目の読み取り窓より後ろに座る JPEG。目一杯に振った COM セグメント1つ
// (0xFFFE、長さの欄が 0xFFFF＝65533 バイトの詰め物) が、SOF0 が始まる前の時点でオフセットを
// 約 65539 バイトまで押し出し、readImageDims の 256KB での読み直しを強いる。
function jpegWithSofPastFirstWindow(w: number, h: number) {
  const fillerLen = 0xffff; // 長さの欄そのものの2バイトを含む
  const comHeader = Buffer.from([0xff, 0xfe, (fillerLen >> 8) & 0xff, fillerLen & 0xff]);
  const filler = Buffer.alloc(fillerLen - 2, 0x00);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), comHeader, filler, jpeg(w, h).subarray(2)]);
}

// #8: 最小の VP8X webp。Animation のフラグは flags バイト（オフセット 20）のビット1。
function webpVP8X(w: number, h: number, animated = false) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  if (animated) b[20] = 0x02;
  b[24] = (w - 1) & 0xff;
  b[25] = ((w - 1) >> 8) & 0xff;
  b[26] = ((w - 1) >> 16) & 0xff;
  b[27] = (h - 1) & 0xff;
  b[28] = ((h - 1) >> 8) & 0xff;
  b[29] = ((h - 1) >> 16) & 0xff;
  return b;
}

const dirs: string[] = [];
function mkFolder(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-card-dims-'));
  dirs.push(d);
  return d;
}
function write(folder: string, name: string, data: Buffer) {
  fs.writeFileSync(path.join(folder, name), data);
}

afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe('IMG_EXT ゲート（#12: .jfif も測る）', () => {
  test('.jfif 拡張子の実体は JPEG なので寸法が測れる', () => {
    const folder = mkFolder();
    write(folder, 'a.jfif', jpeg(640, 480));
    expect(readImageDims(folder, 'a.jfif')).toEqual({ width: 640, height: 480 });
  });

  test('fillCardDims も .jfif のカード画像を測る', () => {
    const folder = mkFolder();
    write(folder, 'cap-1.jfif', jpeg(300, 200));
    const rec: any = { image: 'cap-1.jfif', media: [] };
    fillCardDims(folder, rec);
    expect(rec.shotW).toBe(300);
    expect(rec.shotH).toBe(200);
  });

  test('対応外の拡張子（.bmp）はゲートで弾かれ 0/0 のまま（#12 の既知の限界＝v1 未対応）', () => {
    const folder = mkFolder();
    write(folder, 'cap-1.bmp', jpeg(300, 200)); // 中身は関係ない。ゲートはこれを一度も開かない
    const rec: any = { image: 'cap-1.bmp', media: [] };
    fillCardDims(folder, rec);
    expect(rec.shotW).toBe(0);
    expect(rec.shotH).toBe(0);
  });
});

describe('二段窓の境界（SOF が最初の64KB窓を越える）', () => {
  test('1回目の64KB窓で見つからなければ256KB窓に読み直して測る', () => {
    const folder = mkFolder();
    const buf = jpegWithSofPastFirstWindow(1920, 1080);
    expect(buf.length).toBeGreaterThan(65536);
    expect(buf.length).toBeLessThan(262144);
    write(folder, 'big-exif.jpg', buf);
    expect(readImageDims(folder, 'big-exif.jpg')).toEqual({ width: 1920, height: 1080 });
  });
});

describe('#8: avif も IMG_EXT ゲートを通る（nativeImage は測れないが、寸法は header sniff できる）', () => {
  test('.avif の寸法が測れる', () => {
    const folder = mkFolder();
    const isobmffBox = (type: string, payload: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + payload.length, 0);
      head.write(type, 4, 'ascii');
      return Buffer.concat([head, payload]);
    };
    const fullBoxPayload = (inner: Buffer) => Buffer.concat([Buffer.alloc(4), inner]);
    const ispePayload = Buffer.alloc(8);
    ispePayload.writeUInt32BE(400, 0);
    ispePayload.writeUInt32BE(300, 4);
    const buf = Buffer.concat([isobmffBox('ftyp', Buffer.concat([Buffer.from('avif', 'ascii'), Buffer.alloc(4)])), isobmffBox('meta', fullBoxPayload(isobmffBox('iprp', isobmffBox('ipco', isobmffBox('ispe', fullBoxPayload(ispePayload))))))]);
    write(folder, 'art.avif', buf);
    expect(readImageDims(folder, 'art.avif')).toEqual({ width: 400, height: 300 });
  });
});

describe('#8: readWebpAnimated（card image が animated webp かどうか）', () => {
  test('animated webp は true', () => {
    const folder = mkFolder();
    write(folder, 'loop.webp', webpVP8X(200, 200, true));
    expect(readWebpAnimated(folder, 'loop.webp')).toBe(true);
  });

  test('静止 webp は false', () => {
    const folder = mkFolder();
    write(folder, 'still.webp', webpVP8X(200, 200, false));
    expect(readWebpAnimated(folder, 'still.webp')).toBe(false);
  });

  test('webp 以外の拡張子は中身に関わらず false（この判定は webp 専用）', () => {
    const folder = mkFolder();
    write(folder, 'not-webp.png', webpVP8X(200, 200, true));
    expect(readWebpAnimated(folder, 'not-webp.png')).toBe(false);
  });
});

describe('#8: fillCardDims が shotAnimated を埋める', () => {
  test('カード画像が animated webp なら shotAnimated=true', () => {
    const folder = mkFolder();
    write(folder, 'cap-1.webp', webpVP8X(300, 200, true));
    const rec: any = { image: 'cap-1.webp', media: [] };
    fillCardDims(folder, rec);
    expect(rec.shotW).toBe(300);
    expect(rec.shotH).toBe(200);
    expect(rec.shotAnimated).toBe(true);
  });

  test('カード画像が静止 webp なら shotAnimated=false（サムネ化される側＝#8 の本題）', () => {
    const folder = mkFolder();
    write(folder, 'cap-1.webp', webpVP8X(300, 200, false));
    const rec: any = { image: 'cap-1.webp', media: [] };
    fillCardDims(folder, rec);
    expect(rec.shotAnimated).toBe(false);
  });

  test('jpeg など webp 以外は shotAnimated=false', () => {
    const folder = mkFolder();
    write(folder, 'cap-1.jpg', jpeg(300, 200));
    const rec: any = { image: 'cap-1.jpg', media: [] };
    fillCardDims(folder, rec);
    expect(rec.shotAnimated).toBe(false);
  });
});
