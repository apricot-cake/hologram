'use strict';

// モデルマネージャ（#832、親 #98）向けの、1ファイル分のダウンロード→検証→
// コミット。Electron に依存しない（fetch + node:fs/crypto のみ）ので、
// native-host/media-download.mts のテストが使うのと同じ慣習
// （vi.stubGlobal('fetch', ...)）でスタブ化したグローバル fetch に対して
// 単体テストできる。
//
// 契約: fetchModelFile は、バイト列が `sha256` にハッシュされないファイルを
// `dest` に絶対に残さない（この呼び出しが追加したバイトだけでなく「全体の」
// ファイルに対して確認する——プロセスの再起動をまたぐと、再開したダウンロードの
// ハッシュはメモリ上のダイジェストから再開できず、ディスクから再計算する
// しかないため必要）。不一致の場合は、部分ダウンロードを削除する（先頭を
// 一度も持たなかった対象そのものではなく）ので、呼び出し元はすぐにリトライ
// できる。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface FetchProgress {
  /** これまでに .part ファイルへ書かれたバイト数。前回の実行分のバイトも含む。 */
  bytesDone: number;
  /** サーバーが長さを報告しなかった時は null。 */
  bytesTotal: number | null;
}

export class ModelFileVerificationError extends Error {
  constructor(
    public readonly url: string,
    public readonly expectedSha256: string,
    public readonly actualSha256: string,
  ) {
    super(`downloaded file did not match the pinned hash: ${url}`);
    this.name = 'ModelFileVerificationError';
  }
}

function partPathFor(dest: string): string {
  return `${dest}.part`;
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * `dest` が存在し、そのバイト列が既に `sha256` にハッシュされるなら true——
 * 「既にダウンロード済み／やることが無い」というケースで、ネットワーク呼び出しの
 * 前に確認する。
 */
export async function fileMatchesHash(dest: string, sha256: string): Promise<boolean> {
  try {
    const actual = await sha256OfFile(dest);
    return actual.toLowerCase() === sha256.toLowerCase();
  } catch {
    return false; // ENOENT も読み取りエラーも、どちらも「検証済みのコピーではない」を意味する
  }
}

/**
 * 1ファイルを `dest` へ取得する。中断された前回の呼び出しが残した `.part` の
 * 隣接ファイルを（HTTP Range で）再開し、完成したバイト列を `sha256` と照合
 * してから、`dest` として見えるようになるリネームを行う。
 *
 * 何度実行しても同じ: 成功後にもう一度呼ぶと何もしない（dest は既に一致
 * している）。検証失敗の後にもう一度呼ぶと、そのファイルを最初からやり直す
 * （失敗した .part は既に削除されている）。
 */
export async function fetchModelFile(url: string, dest: string, sha256: string, onProgress?: (p: FetchProgress) => void): Promise<void> {
  if (await fileMatchesHash(dest, sha256)) {
    onProgress?.({ bytesDone: (await fs.promises.stat(dest)).size, bytesTotal: null });
    return;
  }

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const part = partPathFor(dest);
  let resumeFrom = 0;
  try {
    resumeFrom = (await fs.promises.stat(part)).size;
  } catch {
    /* まだ部分ダウンロードが無い */
  }

  const res = await fetch(url, resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : undefined);
  if (resumeFrom > 0 && res.status === 200) {
    // サーバーが Range に対応していない（あるいは足元でリソースが変わった）:
    // ここでの 200 は末尾ではなくファイル「全体」なので、きれいに最初から
    // やり直す。
    resumeFrom = 0;
    await fs.promises.rm(part, { force: true });
  } else if (!res.ok || (resumeFrom > 0 && res.status !== 206)) {
    throw new Error(`could not fetch ${url}: HTTP ${res.status}`);
  }

  const contentLength = res.headers.get('content-length');
  const bytesTotal = contentLength ? resumeFrom + Number(contentLength) : null;

  const out = fs.createWriteStream(part, { flags: resumeFrom > 0 ? 'r+' : 'w', start: resumeFrom });
  let bytesDone = resumeFrom;
  const body = res.body;
  if (!body) throw new Error(`empty response body for ${url}`);
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    await new Promise<void>((resolve, reject) => out.write(chunk, (err) => (err ? reject(err) : resolve())));
    bytesDone += chunk.length;
    onProgress?.({ bytesDone, bytesTotal });
  }
  await new Promise<void>((resolve, reject) => out.end((err: unknown) => (err ? reject(err) : resolve())));

  const actual = await sha256OfFile(part);
  if (actual.toLowerCase() !== sha256.toLowerCase()) {
    await fs.promises.rm(part, { force: true });
    throw new ModelFileVerificationError(url, sha256, actual);
  }
  await fs.promises.rename(part, dest);
}
