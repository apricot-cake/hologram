'use strict';

// カード画像のピクセルサイズ（shotW/shotH）。レコードが DB に入る時に一度だけ
// 計測する。
//
// レンダラーは、遅延読み込みの画像が届く「前」に、各 masonry カードの高さを
// shotW/shotH から確保する。だからグリッドは画像が届くたびに落ち着き直したり
// ガタついたりしない。#5 の 2026-07-21 設計コメントは、これを移行を生き延びる
// 列として固定している。
//
// なぜ書き込み時なのか: #302 まではこれは sidecar 走査の副作用だった——索引が
// 毎回のパスで shotW がまだ null のレコードを計測していた。その走査が無くなった
// 今、計測はレコードが書かれる瞬間の仕事になった。そしてそれは、数値が「新しい」
// 理由で間違いうる唯一の瞬間でもある（ファイルがたった今その隣に着地した
// ばかり）。保存フォルダを手にしている DB の書き手はすべて、writePost() の前に
// fillCardDims() を呼ぶ: 取込キューの消費側、legacy ZIP インポート／
// import-images、complete ZIP インポータ、孤児復旧。
//
// Electron に依存しない（fs/path のみ）ので、素の node で単体テストできる。

import fs from 'node:fs';
import path from 'node:path';
import { imageSize, webpIsAnimated } from './lib-imgsize.ts';

// jfif は別の拡張子を付けただけの素の JPEG（ローカル取り込みの IMPORTABLE_IMG が
// 受け付ける、importable-media.mts）——imageSize() はマジックバイトで既に
// 問題なくこれを読める。このゲートはそれを通すだけでよい（#12）。
// #8: avif もこの集合に加わる（nativeImage は webp 同様これをデコードできないが、
// ヘッダーはデコード無しで読める）——svg は違う: そのサイズは viewport／
// レイアウトの問題であってヘッダーの項目ではなく、v1 では範囲外のまま。
const IMG_EXT = /\.(jpe?g|jfif|png|gif|webp|avif)$/i;
// 計測可能な静止画を持たないメディアファイル: 動画と、pixiv のうごイラの
// アーカイブ（#119 St3）。records.ts の isVideoFile/isUgoiraFile を写す。
const UNMEASURABLE_EXT = /\.(mp4|webm|mov|m4v|zip)$/i;
const HEADER_BYTES = 65536; // JFIF／短い EXIF を越えた JPEG の SOF、および PNG/GIF/WebP をカバーする
const HEADER_BYTES_2 = 262144; // EXIF が大きい JPEG（Eagle からの移行）のための再試行の窓

// カードビューに表示されるファイル——レンダラーの densityImage('card') を写す:
// ダウンロードした原本（最初のメディアファイル）を優先し、無ければローカルから
// 取り込んだ画像を使う。services/records.ts の
// densityImage()/artworkFile() と歩調を合わせ続けることで、高さの確保が
// カードが実際に表示するのと「同じ」画像のサイズになるようにする。動画の
// ポスターは、その（計測不能な）ファイルの代わりを務める（#119 St1/St3）。
// ポスターが無い動画はカード画像を持たない。
function cardImageFile(rec: any): string {
  const media = Array.isArray(rec?.media) ? rec.media.filter((m: any) => m && m.file) : [];
  if (media.length) {
    const first = media[0];
    if (first.posterFile) return first.posterFile;
    if (UNMEASURABLE_EXT.test(first.file)) return '';
    return first.file;
  }
  return rec?.image || '';
}

// レコード由来のファイル名を、開く前に `folder` の「内側」へ縛る。カード画像は
// 攻撃者の影響を受けうる（悪意あるエクスポート ZIP のレコードはそのまま読まれる
// ——zip-slip の防御はエントリ名だけを検査し、レコード内の値までは見ない）
// ので、`"image": "../../../x.png"` がフォルダを脱出してはいけない。解決してから
// 包含チェックし、外側にあるものはすべてスキップする——resolveInFolder
// （asset 経路）や delete-post の path.basename が、まさにこの rec.image /
// media[].file の値に対して既に適用しているのと同じ規則。#216。
function resolveWithin(folder: string, file: string): string | null {
  const root = path.resolve(folder);
  const full = path.resolve(root, String(file));
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

// 画像のヘッダーだけを読み（デコードはしない）、{ width, height } または null を返す。
function readImageDims(folder: string, file: string): { width: number; height: number } | null {
  const full = resolveWithin(folder, file);
  if (!full) return null; // 保存フォルダを脱出する -> スキップ（一切開かない）
  let fd: number | null = null;
  try {
    fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    let dim = imageSize(buf.subarray(0, bytesRead));
    if (!dim && bytesRead === HEADER_BYTES) {
      // 最初の窓を越えた SOF（大きい EXIF）——もっと読む
      const buf2 = Buffer.alloc(HEADER_BYTES_2);
      const read2 = fs.readSync(fd, buf2, 0, HEADER_BYTES_2, 0);
      dim = imageSize(buf2.subarray(0, read2));
    }
    return dim;
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 既に閉じている */
      }
    }
  }
}

// #8: カード画像が「アニメーション」webp かどうか——readImageDims からは分けて
// ある（その戻り値の形に畳み込むのではなく）ので、readImageDims の既存の
// 呼び出し元／テストはすべて {width,height} という正確な契約を保てる。
// 「はい」と答えられる唯一の拡張子のためだけに、もう1回、小さなヘッダー読み取りを
// 行う（VP8X のフラグバイトはファイルの先頭近くの固定オフセットにある）。
function readWebpAnimated(folder: string, file: string): boolean {
  if (!/\.webp$/i.test(file)) return false;
  const full = resolveWithin(folder, file);
  if (!full) return false;
  let fd: number | null = null;
  try {
    fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(21); // オフセット20の VP8X フラグバイトをカバーする
    const bytesRead = fs.readSync(fd, buf, 0, 21, 0);
    return webpIsAnimated(buf.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 既に閉じている */
      }
    }
  }
}

// `rec` の shotW/shotH が無い時にそれを埋め、同じレコードを返すので呼び出し元は
// writePost() へそのまま組み込める。番兵値 0/0 は「試したが、サイズを測れな
// かった」ことを意味する（ポスターの無い動画、壊れている、ファイルが無い）——
// これは再試行の印ではなく本物の値なので、レンダラーは永遠に測り直し続ける
// のではなく、学習済みのアスペクト比キャッシュへちょうど一度だけ代わりに
// 使う側へ回る。既に寸法を持つレコード（complete エクスポート ZIP の往復）は
// それをそのまま保つ。
//
// shotAnimated は同じ一度限りのゲート（#8）に乗る: カード画像がアニメーション
// webp なら 1 になり、records.ts はそれに対して、拡張子だけで本物の .gif が
// 既に受けているのと同じ「原寸のまま、再生を続ける」という特別扱いを与えられる
// ——委譲先のサムネイル生成（lib-thumbnails.ts）は、そうしなければこれを他の
// webp と同じように静止 JPEG へ平坦化してしまう。それは「静止した」webp には
// 正しいが、アニメーションのものには間違っている。
function fillCardDims<T extends { shotW?: number | null; shotH?: number | null; shotAnimated?: boolean | null }>(folder: string | null | undefined, rec: T): T {
  if (!rec || rec.shotW != null || !folder) return rec;
  const file = cardImageFile(rec);
  const dim = file && IMG_EXT.test(file) ? readImageDims(folder, file) : null;
  rec.shotW = dim && dim.width > 0 ? dim.width : 0;
  rec.shotH = dim && dim.height > 0 ? dim.height : 0;
  rec.shotAnimated = !!(file && readWebpAnimated(folder, file));
  return rec;
}

// IMG_EXT/resolveWithin は lib-media-dims.ts（#162 の mediaMaxW/H/Bytes）でも
// 再利用される——同じ「計測可能な静止画」ゲートと、攻撃者の影響を受けうる
// レコードフィールドに対する同じ zip-slip の防御。どちらも2つ目のコピーでは
// ない。
export { cardImageFile, fillCardDims, readImageDims, readWebpAnimated, resolveWithin, IMG_EXT };
