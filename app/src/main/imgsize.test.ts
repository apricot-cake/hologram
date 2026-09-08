// app/src/main/lib-imgsize.ts の単体テスト。masonry のカードを先に採寸するため索引作成の側が
// 使う「ヘッダだけを読む画像寸法ラッパー」を見る。対応する形式ごとに最小限の合成ヘッダを組み立て、
// 壊れた入力を弾くことも確認する。

import { describe, expect, test } from 'vitest';
import { imageSize, webpIsAnimated } from './lib-imgsize';

// JPEG: SOI と SOF0（精度、高さ、幅、…）。
function jpegSof(w: number, h: number) {
  return Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0、長さ17、精度8
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

// 実際のJPEGと同様に、SOIとSOFの間へJFIF APP0セグメントを置く。
function jpeg(w: number, h: number) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, jpegSof(w, h)]);
}

// SOF の前に APP0（JFIF）と COM セグメントを持つ JPEG。
function jpegWithApp0(w: number, h: number) {
  const comment = Buffer.from([0xff, 0xfe, 0x00, 0x06, 0x74, 0x65, 0x73, 0x74]);
  return Buffer.concat([jpeg(w, h).subarray(0, 20), comment, jpegSof(w, h)]);
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

function webpVP8X(w: number, h: number, animated = false) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  b.write('VP8X', 12, 'ascii');
  if (animated) b[20] = 0x02; // Animation フラグ＝VP8X の flags バイトの bit 1
  b[24] = (w - 1) & 0xff;
  b[25] = ((w - 1) >> 8) & 0xff;
  b[26] = ((w - 1) >> 16) & 0xff;
  b[27] = (h - 1) & 0xff;
  b[28] = ((h - 1) >> 8) & 0xff;
  b[29] = ((h - 1) >> 16) & 0xff;
  return b;
}

// AVIF: ftyp(brand) + meta[FullBox] > iprp > ipco > ispe[FullBox](width,height)。
// 最小の ISOBMFF ボックス木。このファイルの他の合成フィクスチャと同じく「足りるだけのバイト」
// で組む。
function isobmffBox(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, payload]);
}
function fullBoxPayload(inner: Buffer): Buffer {
  return Buffer.concat([Buffer.alloc(4), inner]); // version と flags。どちらも 0
}
function avif(w: number, h: number, brand = 'avif') {
  const ftyp = isobmffBox('ftyp', Buffer.concat([Buffer.from(brand, 'ascii'), Buffer.alloc(4)]));
  const ispePayload = Buffer.alloc(8);
  ispePayload.writeUInt32BE(w, 0);
  ispePayload.writeUInt32BE(h, 4);
  const ispe = isobmffBox('ispe', fullBoxPayload(ispePayload));
  const ipco = isobmffBox('ipco', ispe);
  const iprp = isobmffBox('iprp', ipco);
  const meta = isobmffBox('meta', fullBoxPayload(iprp));
  return Buffer.concat([ftyp, meta]);
}

describe('ヘッダから寸法を読む', () => {
  test('無限ループを起こすゼロ長のAVIFプロパティを拒否する', () => {
    const bytes = avif(640, 480);
    bytes.writeUInt32BE(0, bytes.indexOf(Buffer.from('ispe')) - 4);
    expect(imageSize(bytes)).toBeNull();
  });

  test('ICNSとJXLは対応外のパーサーへ渡さない', () => {
    expect(imageSize(Buffer.concat([Buffer.from('icns'), Buffer.alloc(24)]))).toBeNull();
    expect(imageSize(Buffer.from([0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10, 0, 0, 0, 0]))).toBeNull();
  });

  test('AVIFの媒体本体がヘッダ読み取りの上限で切れても寸法を読める', () => {
    const mdat = Buffer.alloc(8);
    mdat.writeUInt32BE(1000000);
    mdat.write('mdat', 4);
    expect(imageSize(Buffer.concat([avif(640, 480), mdat]))).toEqual({ width: 640, height: 480 });
  });

  test('jpeg SOF0', () => {
    expect(imageSize(jpeg(800, 1200))).toEqual({ width: 800, height: 1200 });
  });

  test('jpeg（SOF の前に APP0 と COM）', () => {
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

  test('avif ftyp/meta/iprp/ipco/ispe', () => {
    expect(imageSize(avif(1200, 900))).toEqual({ width: 1200, height: 900 });
  });
});

describe('#8: webp の Animation フラグ（VP8X flags バイトの bit1）', () => {
  test('フラグが立っていれば animated', () => {
    expect(webpIsAnimated(webpVP8X(100, 100, true))).toBe(true);
  });

  test('フラグが立っていなければ静止画', () => {
    expect(webpIsAnimated(webpVP8X(100, 100, false))).toBe(false);
  });

  test('VP8X コンテナでない webp（単純な VP8/VP8L）は animated になりようがない', () => {
    const b = Buffer.alloc(21);
    b.write('RIFF', 0, 'ascii');
    b.write('WEBP', 8, 'ascii');
    b.write('VP8 ', 12, 'ascii');
    expect(webpIsAnimated(b)).toBe(false);
  });

  test('webp ですらないバイト列', () => {
    expect(webpIsAnimated(Buffer.from('not a webp at all'))).toBe(false);
  });
});

describe('#8: avif の ftyp brand', () => {
  test('avif ブランドは測れる', () => {
    expect(imageSize(avif(640, 480, 'avif'))).toEqual({ width: 640, height: 480 });
  });

  test('avis（アニメーション avif）ブランドも測れる', () => {
    expect(imageSize(avif(640, 480, 'avis'))).toEqual({ width: 640, height: 480 });
  });

  test('heic 等 AVIF 以外の ftyp ブランドは null（同じ ISOBMFF コンテナを共有するだけ）', () => {
    expect(imageSize(avif(640, 480, 'heic'))).toBeNull();
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

// #12: JPEG の SOF が持つフレームの寸法は、必ず回転を当てる前の寸法。縦長の写真
// （Orientation 5-8）は、Chromium が実際に描くものへ合わせるために width/height を入れ替える
// 必要がある（`image-orientation: from-image` が既定で、このリポジトリでは設定していない）。
// 本物の写真をリポジトリに置かずに imageSize() の Orientation の扱いを動かせるよう、最小の
// Exif APP1 セグメント（TIFF ヘッダと1エントリの IFD0）を組む。
function tiffIfd0(entries: Array<{ tag: number; type: number; count: number; value: number }>) {
  const b = Buffer.alloc(8 + 2 + entries.length * 12 + 4);
  b.write('II', 0, 'ascii'); // リトルエンディアンの TIFF ヘッダ
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(8, 4); // IFD0 への offset
  let off = 8;
  b.writeUInt16LE(entries.length, off);
  off += 2;
  for (const e of entries) {
    b.writeUInt16LE(e.tag, off);
    b.writeUInt16LE(e.type, off + 2);
    b.writeUInt32LE(e.count, off + 4);
    b.writeUInt16LE(e.value, off + 8); // 4バイトの枠の先頭2バイトに入る SHORT の値
    off += 12;
  }
  b.writeUInt32LE(0, off); // 次の IFD への offset。無し
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
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, jpegSof(w, h)]);
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
    badTiff.writeUInt16LE(50, 8); // 50エントリと申告するが、バッファに入る余地は1つ分
    badTiff.writeUInt16LE(ORIENTATION_TAG, 10);
    badTiff.writeUInt16LE(TYPE_SHORT, 12);
    badTiff.writeUInt32LE(1, 14);
    badTiff.writeUInt16LE(6, 18); // Orientation 6。でたらめな件数でもなお読める
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), exifApp1(badTiff), jpegSof(800, 600)]);
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
    b[26] = 0xff; // 24ビットの width 欄を上限まで埋める
    expect(imageSize(b)).toBeNull();
  });
});
