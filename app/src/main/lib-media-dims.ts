'use strict';

// レコードごとのメディアの大きさの集約（mediaMaxW/mediaMaxH/mediaMaxBytes）＝lib-card-dims.ts の
// shotW/shotH に対する #162 の相方で、レコードが DB へ入るときに1回だけ測る（書き込み時にのみ、
// という同じ約束事、同じ理由。#302 が、null のままのものを測り直していた定期のサイドカーの走査を
// 退けたので、測るのはレコードを書くその瞬間であって、後から掃き寄せるのではない＝
// lib-card-dims.ts 自身の「なぜ書き込み時か」のコメントを参照）。
//
// 何を集約するのか、そしてなぜ合計ではなく最大なのか。寸法・ファイルサイズのファセットの Why
// （#162）は "見せてほしいのは原寸の高解像度だけ／軽い画像だけ"＝レコードの中で最良の原寸の
// アセットであって、付いているもの全部の総重量ではない。合計は「この投稿全体はどれだけ重いか」に
// 答えることになるが、それはファセットが尋ねられたことのない別の問い。
//
// media[] が無いローカル画像では、image がレコード自身のアセットになる。ヘッダを
// 読み直すのではなく、既に測ってある shotW/shotH を幅と高さの代わりに使い、大きさは、そのファイル
// （cardImageFile＝fillCardDims 自身が測るのと同じファイル。その「画像を持たない動画だけの
// レコード」という限界も含めて）を stat して得る。だから1つのレコードに両方を走らせるときは、
// fillMediaDims が fillCardDims より後でなければならない。
//
// 動画やうごイラのアーカイブのメディア項目は mediaMaxBytes には効く（fs.stat はどんなファイルも
// 見る）が、mediaMaxW/mediaMaxH には効かない＝そのポスターのフレームは代役のサムネイルであって、
// 項目自身の解像度ではないし、それを代入するのは #119 の領分（fillCardDims 自身のポスター代入の
// 注記と同じ）で、ここの領分ではない。0 は「測った、大きさのあるものが無かった」の意味（動画だけ
// のレコード、あるいはヘッダが読めない）＝shotW/shotH と同じ番兵の約束事で、再試行の印では決して
// ない。
//
// #162 の設計上の決定（Issue のコメント、2026-07-18）: "既存 augment の逐次処理に乗せ"＝専用の
// 埋め戻しの走査ではなく、shotW/shotH と同じ書き込み時の仕組みに乗せる。これが入る前に保存された
// レコードは、ほかの何らかの理由で次に書かれる（編集、ゴミ箱への出し入れ、孤児の回収）まで
// mediaMaxW/H/Bytes を null のまま持つ。それまでファセットは、そのレコードに一致するものを単に
// 見つけない（0 と null は満たさない、というのが欠けたデータに対するファセット自身の判断。
// query.ts の makePostPredOf の 'dimension' の場合）。進捗の UI も、1回限りの掃き寄せも無い。
//
// lib-card-dims.ts と同じく Electron に依存しない（fs だけ）ので、素の node で単体テストできる。

import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from './lib-imgsize.ts';
import { cardImageFile, readImageDims, resolveWithin, IMG_EXT } from './lib-card-dims.ts';

type MediaMeasurement = { bytes: number; width: number; height: number; cacheable?: boolean };

// ZIP 全体で共有しても入力の参照数に比例して育ち続けない、小さな LRU。完了済みの通常ファイル
// だけを保持し、missing/directory は保持しない。処理中の promise は別に持つので、同じバッチ内の
// alias は重複計測しない一方、こちらも fillMediaDimsAsync の同時実行数（16）を越えて増えない。
class MediaMeasurementCache {
  readonly maxEntries: number;
  readonly maxKeyBytes: number;
  readonly maxSingleKeyBytes: number;
  private readonly settled = new Map<string, { value: MediaMeasurement; keyBytes: number }>();
  private readonly inFlight = new Map<string, Promise<MediaMeasurement>>();
  keyBytes = 0;

  constructor({ maxEntries = 512, maxKeyBytes = 64 * 1024, maxSingleKeyBytes = 4096 }: { maxEntries?: number; maxKeyBytes?: number; maxSingleKeyBytes?: number } = {}) {
    this.maxEntries = Math.max(0, maxEntries);
    this.maxKeyBytes = Math.max(0, maxKeyBytes);
    this.maxSingleKeyBytes = Math.max(0, maxSingleKeyBytes);
  }

  get size(): number {
    return this.settled.size;
  }

  measure(identity: string, work: () => Promise<MediaMeasurement>): Promise<MediaMeasurement> {
    const hit = this.settled.get(identity);
    if (hit) {
      this.settled.delete(identity);
      this.settled.set(identity, hit);
      return Promise.resolve(hit.value);
    }
    const pending = this.inFlight.get(identity);
    if (pending) return pending;
    const task = work().then(
      (value) => {
        this.inFlight.delete(identity);
        if (value.cacheable) this.remember(identity, value);
        return value;
      },
      (error) => {
        this.inFlight.delete(identity);
        throw error;
      },
    );
    this.inFlight.set(identity, task);
    return task;
  }

  private remember(identity: string, value: MediaMeasurement): void {
    const keyBytes = Buffer.byteLength(identity);
    if (!this.maxEntries || keyBytes > this.maxSingleKeyBytes || keyBytes > this.maxKeyBytes) return;
    while (this.settled.size >= this.maxEntries || this.keyBytes + keyBytes > this.maxKeyBytes) {
      const oldest = this.settled.entries().next().value as [string, { value: MediaMeasurement; keyBytes: number }] | undefined;
      if (!oldest) break;
      this.settled.delete(oldest[0]);
      this.keyBytes -= oldest[1].keyBytes;
    }
    this.settled.set(identity, { value, keyBytes });
    this.keyBytes += keyBytes;
  }
}

// ZIP 取り込みでは同じ実ファイルを別表記で参照するレコードがあり得る。解決後の絶対パスを
// identity にすることで、`image.png` と `image.png/.` のどちらが先でも同じ計測を再利用する。
// 拡張子の判定も必ずこの正規化済み identity に対して行う。cache key だけ正規化して元の file で
// 判定すると、先に別名を見た順序によって null が正規名の結果を汚染するためである。
async function measureMedia(folder: string, file: string, cache: MediaMeasurementCache): Promise<MediaMeasurement> {
  if (!file) return { bytes: 0, width: 0, height: 0 };
  const full = resolveWithin(folder, file);
  if (!full) return { bytes: 0, width: 0, height: 0 };
  const identity = path.normalize(full);
  return cache.measure(identity, async () => {
    let bytes = 0;
    try {
      const stat = await fs.promises.stat(identity);
      if (!stat.isFile()) return { bytes: 0, width: 0, height: 0 };
      bytes = stat.size;
    } catch {
      return { bytes: 0, width: 0, height: 0 };
    }
    if (!IMG_EXT.test(identity)) return { bytes, width: 0, height: 0, cacheable: true };
    try {
      const handle = await fs.promises.open(identity, 'r');
      try {
        const header = Buffer.alloc(262144);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const dim = imageSize(header.subarray(0, bytesRead));
        return { bytes, width: dim?.width || 0, height: dim?.height || 0, cacheable: true };
      } finally {
        await handle.close();
      }
    } catch {
      return { bytes, width: 0, height: 0, cacheable: true };
    }
  });
}

// 大きな ZIP のための非同期版。全項目を集計し、件数 cap で結果を切り捨てない。一度に発行する
// filesystem work だけを有限にし、各バッチの後でイベントループへ明示的に譲る。cache は ZIP
// 全体で共有でき、同一実ファイルの stat/header 読みを重複させない。
async function fillMediaDimsAsync<T extends { media?: unknown; image?: string | null; mediaMaxW?: number | null; mediaMaxH?: number | null; mediaMaxBytes?: number | null; shotW?: number | null; shotH?: number | null }>(
  folder: string | null | undefined,
  rec: T,
  cache: MediaMeasurementCache = new MediaMeasurementCache(),
): Promise<T> {
  if (!rec || rec.mediaMaxW != null || !folder) return rec;
  const media = Array.isArray(rec.media) ? (rec.media as Array<{ file?: string; width?: number | null; height?: number | null }>).filter((m) => m && m.file) : [];
  if (!media.length) {
    rec.mediaMaxW = rec.shotW && rec.shotW > 0 ? rec.shotW : 0;
    rec.mediaMaxH = rec.shotH && rec.shotH > 0 ? rec.shotH : 0;
    rec.mediaMaxBytes = (await measureMedia(folder, cardImageFile(rec), cache)).bytes;
    return rec;
  }
  let maxW = 0;
  let maxH = 0;
  let maxBytes = 0;
  const batchSize = 16;
  for (let start = 0; start < media.length; start += batchSize) {
    const batch = media.slice(start, start + batchSize);
    const measurements = await Promise.all(batch.map((m) => measureMedia(folder, m.file as string, cache)));
    for (let i = 0; i < batch.length; i++) {
      const m = batch[i];
      const measured = measurements[i];
      if (measured.bytes > maxBytes) maxBytes = measured.bytes;
      if (measured.width > 0 && measured.height > 0) {
        if (m.width == null) m.width = measured.width;
        if (m.height == null) m.height = measured.height;
        if (measured.width > maxW) maxW = measured.width;
        if (measured.height > maxH) maxH = measured.height;
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  rec.mediaMaxW = maxW;
  rec.mediaMaxH = maxH;
  rec.mediaMaxBytes = maxBytes;
  return rec;
}

// `file`（`folder` からの相対）のバイト数。読めないときやフォルダの外にあるときは 0＝
// resolveWithin は readImageDims が使うのと同じ zip-slip の番人で、ここでも同じ理由から必要。
// 取り込み・書き出しされたレコードのファイルの欄は、攻撃者の影響を受け得る（#216）。
function fileBytes(folder: string, file: string | null | undefined): number {
  if (!file) return 0;
  const full = resolveWithin(folder, file);
  if (!full) return 0;
  try {
    return fs.statSync(full).size;
  } catch {
    return 0;
  }
}

// `rec` に mediaMaxW/mediaMaxH/mediaMaxBytes が無ければ埋め、同じレコードを返すので、呼び出し元は
// writePost() の中へそのまま書ける（fillCardDims 自身の形と同じ）。1回だけにするゲート
// （mediaMaxW != null）は shotW/shotH と揃えてある。既に値を持つレコード（完全エクスポートの ZIP
// を往復したもの）は、そのまま触らない。
function fillMediaDims<T extends { media?: unknown; image?: string | null; mediaMaxW?: number | null; mediaMaxH?: number | null; mediaMaxBytes?: number | null; shotW?: number | null; shotH?: number | null }>(folder: string | null | undefined, rec: T): T {
  if (!rec || rec.mediaMaxW != null || !folder) return rec;
  const media = Array.isArray(rec.media) ? (rec.media as Array<{ file?: string; width?: number | null; height?: number | null }>).filter((m) => m && m.file) : [];
  if (!media.length) {
    rec.mediaMaxW = rec.shotW && rec.shotW > 0 ? rec.shotW : 0;
    rec.mediaMaxH = rec.shotH && rec.shotH > 0 ? rec.shotH : 0;
    rec.mediaMaxBytes = fileBytes(folder, cardImageFile(rec));
    return rec;
  }
  let maxW = 0;
  let maxH = 0;
  let maxBytes = 0;
  for (const m of media) {
    const file = m.file as string;
    const bytes = fileBytes(folder, file);
    if (bytes > maxBytes) maxBytes = bytes;
    if (IMG_EXT.test(file)) {
      const dim = readImageDims(folder, file);
      if (dim) {
        if (m.width == null) m.width = dim.width;
        if (m.height == null) m.height = dim.height;
        if (dim.width > maxW) maxW = dim.width;
        if (dim.height > maxH) maxH = dim.height;
      }
    }
  }
  rec.mediaMaxW = maxW;
  rec.mediaMaxH = maxH;
  rec.mediaMaxBytes = maxBytes;
  return rec;
}

export { fillMediaDims, fillMediaDimsAsync, fileBytes, MediaMeasurementCache };
