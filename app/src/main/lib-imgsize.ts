'use strict';

import ExifReader from 'exifreader';

// ファイルの先頭のバイト列から画像のピクセル寸法を読み取る＝完全な復号はしない。
// lib-card-dims.ts と lib-media-dims.ts が、カードごとの画像の大きさ（shotW/shotH）と寸法の
// ファセット（mediaMaxW/H、#162）を記録するのに使う。レンダラーが masonry のカードの高さを、
// （遅延読み込みの）画像が載る前に確保できるようになって読み込み時の落ち着き直し・揺れが消えるし、
// ファセットもブラウザが実際に描くピクセルの大きさで答えられる。ヘッダだけを見る。呼び出し元は
// ファイルの先頭の約64KB を渡す（lib-card-dims.ts の2段構えの読み取り窓を参照）。
//
// #12: Chromium の既定の `image-orientation: from-image` は、JPEG を EXIF の Orientation タグに
// 従って回転して描くことを意味する。しかし下の SOF・IHDR などの解析はいつも回転前のフレームの
// 大きさしか返していなかった＝だから縦長の写真（Orientation 5-8）は横長の shotW/shotH を持ち、
// 自分の縦横比を、そして（#162 が入ってからは）寸法のファセットへの答えを誤って報告していた。
// imageSize() は今や exifreader 経由で Orientation を読み（同じバッファの窓で、ファイルの
// 読み直しは無い）、5-8 では幅と高さを入れ替えるので、呼び出し元は常に表示される大きさを得る。
// exifreader は解析できない入力に対して例外を投げもするので、Orientation を読めなかった場合
// （EXIF が無い、EXIF が壊れている、JPEG ではない）は黙ってフレームの大きさをそのままにする＝
// 向きはできる範囲での精度向上であって、必須ではない。
//
// Electron に依存しないので、素の node で単体テストできる。

// JPEG: Start-Of-Frame（SOFn）が高さと幅を載せるまで、マーカーの区間を走査する。
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // SOI
  let off = 2;
  while (off + 4 <= buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    } // 詰め物の上で同期を取り直す
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off++;
      continue;
    } // 0xFF の詰め物の連なり
    // 単独のマーカー（長さを持たない）。SOI/EOI、RSTn、TEM。
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      off += 2;
      continue;
    }
    if (off + 4 > buf.length) break;
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    // SOF0..SOF15 がフレームの大きさを持つ＝ただし DHT(C4)、JPG(C8)、DAC(CC) は除く。
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

// PNG: IHDR が最初のチャンク。幅は 16、高さは 20 のオフセット（ビッグエンディアン）。
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return w && h ? { width: w, height: h } : null;
}

// GIF: 論理画面の幅と高さがオフセット 6 と 8（リトルエンディアン）。
function gifSize(buf) {
  if (buf.length < 10) return null;
  if (buf[0] !== 0x47 || buf[1] !== 0x49 || buf[2] !== 0x46) return null; // "GIF"
  const w = buf.readUInt16LE(6);
  const h = buf.readUInt16LE(8);
  return w && h ? { width: w, height: h } : null;
}

// WebP: RIFF のコンテナで、下位の形式が3つ（非可逆の VP8、可逆の VP8L、拡張の VP8X）。
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

// WebP の 'Animation' の旗。コンテナ仕様の `Rsv|I|L|E|X|A|R` の並びに従い、VP8X の旗のバイト
// （オフセット20）のビット1＝ファイルが ANIM/ANMF のチャンクを持つときだけ立ち、alpha・ICC・
// Exif・XMP のために VP8X で包んだだけでは立たない。素の VP8/VP8L のファイル（VP8X のコンテナが
// そもそも無い）は決してアニメーションになり得ない。#8: 動く webp と静止した webp を見分けるのが
// これで、records.ts が前者にだけ、.gif が既に受けているのと同じ「サムネイルを飛ばし、再生させて
// おく」扱いを与えられる＝静止した webp こそ、この Issue がサムネイルを付けたい対象。
function webpIsAnimated(buf) {
  if (!buf || buf.length < 21) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  if (buf.toString('ascii', 12, 16) !== 'VP8X') return false;
  return (buf[20] & 0x02) !== 0;
}

// AVIF: ISOBMFF（box）のコンテナで、HEIF や MP4 と同じ系統。幅と高さは 'ispe'（Image Spatial
// Extents）のプロパティにあり、ftyp → meta → iprp → ipco → ispe と歩いて辿り着く。範囲を切った
// 防御的な box の走査（このファイルがほかの形式でも取っている流儀に倣う）。宣言された大きさが
// バッファに収まらない box や、大きさが 0 以下の box が出たら、ループしたり範囲外を読んだりせず、
// 走査を止めて「測れなかった」と報告する。
function readBoxHeader(buf, off, limit) {
  if (off + 8 > limit) return null;
  let size = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  let headerLen = 8;
  if (size === 1) {
    // 64ビットの拡張された大きさ＝これほど小さなヘッダの窓の読み取りでは下位32ビットしか効かない。
    // それだけ大きな box はどのみち収まらない。
    if (off + 16 > limit) return null;
    size = buf.readUInt32BE(off + 12);
    headerLen = 16;
  } else if (size === 0) {
    size = limit - off; // 「囲んでいる box の終わりまで伸びる」
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
    if (box.size <= 0) return null; // 壊れた入力での無限ループを防ぐ
    off += box.size;
  }
  return null;
}
function avifSize(buf) {
  if (!buf || buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return null;
  const brand = buf.toString('ascii', 8, 12);
  if (brand !== 'avif' && brand !== 'avis') return null; // AVIF の ftyp ではない＝HEIC/HEIF が同じコンテナを共有している
  const meta = findBox(buf, 0, buf.length, 'meta');
  if (!meta) return null;
  const iprp = findBox(buf, meta.start + 4, meta.end, 'iprp'); // meta は FullBox。子の前に4バイトの version+flags がある
  if (!iprp) return null;
  const ipco = findBox(buf, iprp.start, iprp.end, 'ipco');
  if (!ipco) return null;
  // 'ispe' の box は複数あり得る（サムネイル＋主たる項目、アルファのプレーン）。突き合わせた
  // どのエンコーダ（libavif）でも最初のものが主画像のものだった＝できる範囲でのヘッダの
  // 嗅ぎ分けとしては十分。
  let off = ipco.start;
  while (off + 8 <= ipco.end) {
    const box = readBoxHeader(buf, off, ipco.end);
    if (!box) break;
    if (box.type === 'ispe' && off + box.headerLen + 12 <= ipco.end) {
      // ispe は FullBox（4バイトの version+flags）の後に image_width と image_height。ビッグエンディアンの uint32。
      const w = buf.readUInt32BE(off + box.headerLen + 4);
      const h = buf.readUInt32BE(off + box.headerLen + 8);
      return w && h ? { width: w, height: h } : null;
    }
    if (box.size <= 0) break;
    off += box.size;
  }
  return null;
}

// 実在の写真・画面・スキャンで、どちらの軸についてもこれを正当に超えるものは無い。そうでないと、
// PNG の IHDR（32ビット）や WebP VP8X（24ビット）の幅と高さの欄は、攻撃者の握る数バイトから数十億
// ピクセルを名乗れてしまう。それを伝播させず「測れなかった」として扱う＝保存先フォルダのパスの
// 内包（resolveWithin、lib-card-dims.ts）は「レコード由来の入力を信用しない」という同じ規則を
// パスに当てている。これはその規則を数値に当てたもの。
const MAX_DIMENSION = 65535;

// EXIF の Orientation（タグ 0x0112）。1 は通常、5-8 はフレームが90度回っているので、実際に表示
// されるものに合わせて幅と高さを入れ替えなければならない。読むのは imageSize() へ既に渡された
// のと同じバッファ＝Orientation は TIFF ヘッダのすぐ後の IFD0 にあるので、EXIF が大きくて読み
// 直す場合でも、呼び出し元が渡すヘッダの窓の中に必ず収まる。EXIF が無い画像と EXIF が壊れた画像は
// 例外を投げるかタグを返さないかで、どちらにせよ null（回転なし）を代わりに使う。
function readOrientation(buf) {
  try {
    const tags = ExifReader.load(buf, { includeTags: { exif: ['Orientation'] } });
    const value = tags?.Orientation?.value;
    return typeof value === 'number' && value >= 1 && value <= 8 ? value : null;
  } catch {
    return null;
  }
}

// 署名から形式を判別し、{ width, height } か null を返す。
function imageSize(buf) {
  if (!buf || buf.length < 10) return null;
  const dim = jpegSize(buf) || pngSize(buf) || gifSize(buf) || webpSize(buf) || avifSize(buf) || null;
  if (!dim || dim.width > MAX_DIMENSION || dim.height > MAX_DIMENSION) return null;
  const orientation = readOrientation(buf);
  return orientation && orientation >= 5 ? { width: dim.height, height: dim.width } : dim;
}

export { imageSize, jpegSize, pngSize, gifSize, webpSize, avifSize, webpIsAnimated };
