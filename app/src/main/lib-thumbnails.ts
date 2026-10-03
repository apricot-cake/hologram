'use strict';

// asset:// のスキームと、その裏にあるサムネイルのキャッシュ（#227）＝index.ts の
// `// --- 画像のプロトコル ---` の塊を丸ごと移したもの。1つのモジュールにしてあるのは、
// キャッシュがこのハンドラのためだけに在るから。サムネイルを作るのは `?w=N` だけだし、縮小
// しない応答が自分を何だと言うかを決めるのは MIME の表だけ。
//
// 保存先フォルダの内包の確認はここに無い。resolveInFolder は index.ts のほかのファイルの補助と
// 一緒に残る（あれはすべてのファイルハンドラが共有する規則であって、このハンドラ固有のものでは
// ない）ので、registerImageProtocol はそれを取りに戻らず依存として受け取る。

import { protocol, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { configDir } from './native-host.ts';
import { getSaveFolder } from './lib-config.ts';
import { assetSecurityHeaders } from './asset-headers.ts';
import { sharedJobPool } from './lib-job-pool.ts';
import { imageSize, webpIsAnimated } from './lib-imgsize.ts';
import { parseAssetByteRange } from './lib-http-range.ts';

/** registerImageProtocol が組み立ての側から必要とするもの。 */
export interface ImageProtocolDeps {
  /** 名前を保存先フォルダの中で解決する。外へ出てしまうなら null。 */
  resolveInFolder(name: string): string | null;
}

// 画像は JPEG のほか png/webp/gif のこともある。
const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.zip': 'application/zip', // pixiv うごイラのアーカイブ（#119 St3）＝main が読んで IPC 越しにプレイヤーへ渡す。描画はしない
};
function mimeForFile(name) {
  return EXT_MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';
}

// サムネイル。画像表示のタイルのグリッドは、原寸の元画像（数 MB の pixiv / X の作品）を約180px
// のセルへ縮小して描いていた。GPU が毎回フル解像度の画像を復号するのでスクロールが引っかかった。
// 代わりに asset://…?w=N で縮小済みの JPEG/PNG を配る。生成は Chromium の隔離した画像要素で
// 1回だけ行い、ディスクにキャッシュする（キーは 名前＋mtime＋幅 なので、移行し直せば無効になる）。
// ?w= が付かないときは今も原寸の元画像を配る（ライトボックス・ビューア）。
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif', '.svg']);
// nativeImage の同期フル復号を避け、静止形式は Chromium の隔離した画像要素へ委譲する。
const DELEGATED_DECODE_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.avif', '.svg']);
// thumb-cache は保存先フォルダではなく configDir にある。hologram.db がそうするのと同じ
//「ローカルで、ライブラリと一緒に持ち運べない」という理由（index.ts の投稿のコメント）。
function thumbCacheDir() {
  return path.join(configDir(), 'thumb-cache');
}

// タイルのグリッドは、キャッシュの無いセルへ初めてスクロールした時に asset?w= のリクエストを
// 一度に大量に投げる。ヘッダー走査と Chromium 復号を共有プールへ集約して同時実行数を制限し、
// ジョブの間ではイベントループへ譲ってメインスレッドが息を続けられるようにし、
// 同時に来た同一のリクエストは束ねて、各タイルの復号を高々1回にする。
//
// プールは lib-job-pool.ts にあり、同時に最大2本まで入り、ジョブの間に setImmediate の譲りが
// 入る。
const _thumbInflight = new Map<string, Promise<ThumbnailResult | null>>(); // cachePath → 生成中の結果
// 昔の専用プールは、ジョブが例外を投げると null で解決していた。共有のプールは拒否する（索引の
// ジョブは「何も作らなかった」と「投げた」を区別しなければならない）。ここでは昔の取り決めへ
// 戻す。ここでの「サムネイルは無い」は正当な答えで、プロトコル側が原画像へ戻さず拒否する。
function runThumbJob<T>(fn: () => Promise<T>): Promise<T | null> {
  return sharedJobPool.run(fn).catch(() => null);
}

// 静止形式のレンダラー委譲復号。OS に入っているコーデックへ頼るのでも、新しい wasm・
// ネイティブの依存を足すのでもなく、隠しの
// BrowserWindow が Chromium 自身に復号を頼み＝アプリのほかの場所で <img> タグに描いているのと
// 同じエンジン＝透過の要否に応じて JPEG/PNG を返す。
//
// win.webContents.executeJavaScript() は「main → IPC → 復号 → IPC → main」の往復を丸ごと1回の
// 呼び出しで行う（Electron が自前の CDP に似た内部チャンネルで運ぶ）。ページ側のスクリプトには
// 何も公開せず、main 自身が注入するコードにだけ公開するので、preload や contextBridge の配線は
// 要らない。
let _decodeWin: BrowserWindow | null = null;
let _decodeWinIdleTimer: NodeJS.Timeout | null = null;
// THUMB_POOL は復号のジョブを同時に最大2本走らせる＝これが無いと、最初のウィンドウが
// about:blank の読み込みを終える前に届いた webp / avif の2つのリクエストが、どちらも
// _decodeWin をまだ null と見て自分の BrowserWindow を立ててしまい、競争に負けた方が漏れる
// （片付けに手が届くのは、最後に _decodeWin へ代入されたものだけ）。
let _decodeWinCreating: Promise<BrowserWindow> | null = null;
// 隠しウィンドウの GPU・コンポジタの資源は、しばらく誰も復号を頼まなくなったら回収する。
// アプリのセッション全体にわたって生かしておくのではなく。#66 の、暇なウィンドウについての
// 別の観察とは別物（GPU・メモリのトレースを読むときに混同しないこと）。
const DECODE_WIN_IDLE_MS = 30_000;
// ローカル取り込みは高品質な原稿も受け付ける。ファイル全体を main へ読まず Chromium に直接
// 渡す経路なので、通常のブラウザー保存上限より大きい入力も、有限の上限までは扱える。
const MAX_THUMBNAIL_INPUT_BYTES = 512 * 1024 * 1024;
// アニメーションは静止 PNG へ潰さず原本を返すため、フレーム総数を安価に証明できない形式には
// 従来の厳しい入力上限を残す。
const MAX_ANIMATED_THUMBNAIL_BYTES = 25 * 1024 * 1024;
// RGBA の復号面で最大約160 MiB。入力が小さくても巨大な寸法を宣言できるので、バイト数とは
// 別に制限する。二重の防御としてレンダラー側でも同じ値を検査する。
const MAX_THUMBNAIL_PIXELS = 40_000_000;
const THUMBNAIL_HEADER_BYTES = 256 * 1024;
// PNG の透過保持で圧縮率が悪い入力でも、IPC の data URL とディスクキャッシュを無制限にしない。
const MAX_THUMBNAIL_OUTPUT_BYTES = 16 * 1024 * 1024;

// 1つの隠しウィンドウを使い回すため、loadURL とそれに続く canvas 読み出しを直列化する。
// 共有ジョブプールの別ジョブによるナビゲーションで、処理中の画像を入れ替えさせない。
let _delegatedDecodeTail: Promise<void> = Promise.resolve();

async function getDecodeWindow(): Promise<BrowserWindow> {
  if (_decodeWinIdleTimer) {
    clearTimeout(_decodeWinIdleTimer);
    _decodeWinIdleTimer = null;
  }
  if (_decodeWin && !_decodeWin.isDestroyed()) return _decodeWin;
  if (!_decodeWinCreating) {
    _decodeWinCreating = (async () => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, offscreen: false },
      });
      await win.loadURL('about:blank');
      _decodeWin = win;
      return win;
    })();
  }
  try {
    return await _decodeWinCreating;
  } finally {
    _decodeWinCreating = null;
  }
}

function scheduleDecodeWinDispose() {
  if (_decodeWinIdleTimer) clearTimeout(_decodeWinIdleTimer);
  _decodeWinIdleTimer = setTimeout(() => {
    _decodeWinIdleTimer = null;
    const win = _decodeWin;
    _decodeWin = null;
    if (win && !win.isDestroyed()) win.destroy();
  }, DECODE_WIN_IDLE_MS);
}

// 短い辺を基準に縮小する。正方形のタイル＋object-fit:cover では短い辺がタイルに対応するので、`w` を超えては
// いけないのはその辺。
function delegatedDecodeScript(sourceUrl: string, w: number, mime: string): string {
  return `(async () => {
    try {
      const source = new Image();
      source.src = ${JSON.stringify(sourceUrl)};
      await source.decode();
      const bitmap = await createImageBitmap(source);
      if (bitmap.width * bitmap.height > ${MAX_THUMBNAIL_PIXELS}) {
        bitmap.close();
        return null;
      }
      const shortEdge = Math.min(bitmap.width, bitmap.height);
      const scale = shortEdge > ${w} ? ${w} / shortEdge : 1;
      const dw = Math.max(1, Math.round(bitmap.width * scale));
      const dh = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(dw, dh);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, dw, dh);
      bitmap.close();
      const blob = await canvas.convertToBlob({ type: ${JSON.stringify(mime)}, quality: 0.9 });
      if (blob.size > ${MAX_THUMBNAIL_OUTPUT_BYTES}) return null;
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  })()`;
}

function svgDimensions(header: Buffer): { width: number; height: number } | null {
  const documentStart = header
    .toString('utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!doctype[\s\S]*?\]>/gi, '')
    .replace(/<!doctype[^>]*>/gi, '')
    .trimStart();
  const open = /^<svg\b[^>]*>/i.exec(documentStart)?.[0];
  if (!open) return null;
  const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(open)?.[1];
  const length = (value: string | undefined) => {
    const match = value?.trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
    return match ? Number(match[1]) : null;
  };
  const width = length(attr('width'));
  const height = length(attr('height'));
  if (width && height) return { width, height };
  const viewBox = attr('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) return { width: viewBox[2], height: viewBox[3] };
  // SVG の置換要素としての既定 intrinsic size。
  return { width: 300, height: 150 };
}

interface InspectedThumbnailInput {
  width: number;
  height: number;
  size: number;
  header: Buffer;
}

// APP1 の Exif や APP2 の ICC が大きくても、各 marker の長さだけを読み、SOF までファイル位置を
// 進める。走査は16MiB・4096 markerまでに制限し、巨大な metadata を main の Buffer に積まない。
async function jpegDimensions(handle: fs.promises.FileHandle, size: number): Promise<{ width: number; height: number } | null> {
  const marker = Buffer.alloc(4);
  let offset = 2;
  let markerCount = 0;
  const scanEnd = Math.min(size, 16 * 1024 * 1024);
  while (offset + 4 <= scanEnd && markerCount++ < 4096) {
    const { bytesRead } = await handle.read(marker, 0, 4, offset);
    if (bytesRead !== 4 || marker[0] !== 0xff) return null;
    let code = marker[1];
    while (code === 0xff) {
      offset++;
      const one = Buffer.alloc(1);
      if ((await handle.read(one, 0, 1, offset + 1)).bytesRead !== 1) return null;
      code = one[0];
    }
    if (code === 0xd9 || code === 0xda) return null;
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = marker.readUInt16BE(2);
    if (segmentLength < 2 || offset + 2 + segmentLength > size) return null;
    if ((code >= 0xc0 && code <= 0xc3) || (code >= 0xc5 && code <= 0xc7) || (code >= 0xc9 && code <= 0xcb) || (code >= 0xcd && code <= 0xcf)) {
      const sof = Buffer.alloc(5);
      if ((await handle.read(sof, 0, 5, offset + 4)).bytesRead !== 5) return null;
      return { height: sof.readUInt16BE(1), width: sof.readUInt16BE(3) };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

async function inspectThumbnailInput(resolved: string, ext = path.extname(resolved).toLowerCase()): Promise<InspectedThumbnailInput | null> {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(resolved, 'r');
    const st = await handle.stat();
    if (!st.isFile() || st.size <= 0 || st.size > MAX_THUMBNAIL_INPUT_BYTES) return null;
    if (ext === '.svg' && st.size > MAX_ANIMATED_THUMBNAIL_BYTES) return null;
    const header = Buffer.alloc(Math.min(st.size, THUMBNAIL_HEADER_BYTES));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const actualHeader = header.subarray(0, bytesRead);
    let dims = ext === '.svg' ? svgDimensions(actualHeader) : imageSize(actualHeader);
    if (!dims && ['.jpg', '.jpeg', '.jfif'].includes(ext) && actualHeader[0] === 0xff && actualHeader[1] === 0xd8) dims = await jpegDimensions(handle, st.size);
    if (!dims || dims.width <= 0 || dims.height <= 0 || dims.width * dims.height > MAX_THUMBNAIL_PIXELS) return null;
    return { ...dims, size: st.size, header: actualHeader };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function getDelegatedThumbnail(resolved: string, w: number, mime = 'image/jpeg', inspected = false): Promise<Buffer | null> {
  if (!inspected && !(await inspectThumbnailInput(resolved))) return null;

  const previous = _delegatedDecodeTail;
  let release!: () => void;
  _delegatedDecodeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const win = await getDecodeWindow();
    // 画像そのものをトップレベル文書として開かない。特に SVG は <img> 文脈なら script を
    // 実行しない。file: の安全な空ページから、検査済み原本だけを子画像として読む。
    const shell = path.join(thumbCacheDir(), 'decode-shell.html');
    await fs.promises.mkdir(thumbCacheDir(), { recursive: true });
    await fs.promises.writeFile(shell, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file:">');
    await win.loadURL(pathToFileURL(shell).href);
    const dataUrl = await win.webContents.executeJavaScript(delegatedDecodeScript(pathToFileURL(resolved).href, w, mime));
    scheduleDecodeWinDispose();
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(`data:${mime};base64,`)) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const output = Buffer.from(dataUrl.slice(comma + 1), 'base64');
    return output.length <= MAX_THUMBNAIL_OUTPUT_BYTES ? output : null;
  } catch {
    scheduleDecodeWinDispose();
    return null; // 復号に失敗した（壊れたファイル、非対応の派生）＝原本へ戻さず拒否する
  } finally {
    release();
  }
}

type ThumbnailResult = { bytes: Buffer; mime: 'image/jpeg' | 'image/png' } | { original: true };

async function getThumbnail(resolved, name, w): Promise<ThumbnailResult | null> {
  const ext = path.extname(name).toLowerCase();
  const isImageExt = THUMB_EXT.has(ext);
  const isDelegated = DELEGATED_DECODE_EXT.has(ext);
  let st: any;
  try {
    st = await fs.promises.stat(resolved);
  } catch {
    return null;
  }
  // キャッシュ済みであっても原本は後から置換できる。復号予算を導入する前のキャッシュを返したり、
  // 現在の過大な原本を検査せず成功扱いにしたりしないよう、キャッシュ参照より先に検査する。
  const inspected = isImageExt ? await inspectThumbnailInput(resolved, ext) : null;
  if (isImageExt && !inspected) return null;
  // GIF と animation WebP は静止画へ平坦化しない。事前検査を通り、さらに厳しいアニメーション
  // 専用バイト予算内の原本だけを意図的に返す。これは復号失敗後の無検査 fallback ではない。
  const preserveAnimation = ext === '.gif' || (ext === '.webp' && webpIsAnimated(inspected?.header));
  if (preserveAnimation) return inspected && inspected.size <= MAX_ANIMATED_THUMBNAIL_BYTES ? { original: true } : null;
  const outputMime: 'image/jpeg' | 'image/png' = ['.jpg', '.jpeg', '.jfif'].includes(ext) ? 'image/jpeg' : 'image/png';
  const cacheExt = outputMime === 'image/png' ? 'png' : 'jpg';
  // q3: 幅ではなく短い辺で縮小する。タイルは正方形＋object-fit:cover なので、タイルに対応する
  // のは短い辺。幅で縮小すると横長の画像（1920x1080 など）が 180x101 になり、それが正方形の
  // タイルへ縦に引き伸ばされて → ひどくぼやけた。
  // q6: Chromium の安全な <img> 復号へ統一し、透過形式は PNG キャッシュにした世代。
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q6.${cacheExt}`.replace(/[^\w.-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try {
    const cached = await fs.promises.readFile(cachePath);
    // キャッシュされた否定の結果（#236。#8 で委譲する復号の経路へも広げた）。この
    // 名前＋mtime＋幅 の組で生成は既に1回試され、何も作れなかった＝空のファイルがその番兵。
    // だから、いつまでもサムネイルが付かないカードが、スクロールで戻るたびに OS のシェル
    // 呼び出しや隠しウィンドウの復号を引き直すことはない。本物の画像のサムネイルが
    // ゼロバイトになることはない。
    return cached.length ? { bytes: cached, mime: outputMime } : null;
  } catch {
    /* キャッシュに無い */
  }
  // 束ねる。このタイルがちょうど今生成中なら、重複した復号を始めずにそのジョブを待つ
  // （グリッドの作り直しは、最初の復号が飛行中のまま、まだ見えているタイルを要求し直す）。
  const pending = _thumbInflight.get(cachePath);
  if (pending) return pending;
  const job = runThumbJob(async () => {
    let buf: Buffer | null = null;
    // nativeImage の同期フル復号は使わない。対応する静止形式はすべて、事前検査後に共有された
    // Chromium デコーダーへ直列に委譲する。
    if (isDelegated) {
      buf = await getDelegatedThumbnail(resolved, w, outputMime, true);
    }
    await fs.promises.mkdir(thumbCacheDir(), { recursive: true }).catch(() => {
      /* キャッシュはできる範囲で */
    });
    // buf===null は書き込みを飛ばすのではなく、ゼロバイトの番兵としてキャッシュする（上の
    // 読み側のコメントを参照）＝そこが要点。
    await fs.promises.writeFile(cachePath, buf || Buffer.alloc(0)).catch(() => {
      /* キャッシュはできる範囲で */
    });
    return buf ? { bytes: buf, mime: outputMime } : null;
  });
  _thumbInflight.set(cachePath, job);
  try {
    return await job;
  } finally {
    _thumbInflight.delete(cachePath);
  }
}

function registerImageProtocol({ resolveInFolder }: ImageProtocolDeps) {
  protocol.handle('asset', async (request) => {
    try {
      const folder = getSaveFolder();
      if (!folder) return new Response('No save folder', { status: 404 });

      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel === '.' || rel === '..') return new Response('Not found', { status: 404 });

      // すべてのファイルハンドラと同じ内包の規則。現行項目の items/<id>/<file>、共有リソース、
      // ごみ箱、移行前の直下ファイルだけを受け付ける。resolveInFolder は、解決したパスが
      // 保存先フォルダの厳密に内側へ着地することを保証する。
      const resolved = resolveInFolder(rel);
      if (!resolved) return new Response('Forbidden', { status: 403 });
      const name = path.basename(resolved);

      const w = Number.parseInt(url.searchParams.get('w') || '', 10);
      let inspectedOriginal = false;
      if (Number.isFinite(w) && w >= 64 && w <= 720) {
        const thumb = await getThumbnail(resolved, name, w);
        // キャッシュのキーに mtime と幅が入っていて、キャプチャのファイル名は内容が安定して
        // いる（captureId は一意で、書き込みは1回きり）→ immutable にすると、Chromium は復号
        // 済みのビットマップを保持し、スクロールで戻ったときの読み直し・復号し直しを省ける。
        if (thumb && 'bytes' in thumb) return new Response(Uint8Array.from(thumb.bytes), { headers: { ...assetSecurityHeaders(), 'content-type': thumb.mime, 'cache-control': 'public, max-age=31536000, immutable' } });
        // ?w= を付けた画像は、過大・破損・非対応・復号失敗のどの場合も原本へ戻さない。
        // ここで原本を Chromium に渡すと、main の事前検査を迂回して同じ敵性入力をもう一度
        // 復号させることになる。通常の「画像以外を ?w= 付きで読む」呼び出しだけは、従来どおり
        // 下の Range 対応ストリームへ進める。
        if (THUMB_EXT.has(path.extname(name).toLowerCase()) && (!thumb || !('original' in thumb))) return new Response('Thumbnail unavailable', { status: 422, headers: assetSecurityHeaders() });
        inspectedOriginal = !!thumb && 'original' in thumb;
      }

      // 原本（特に mp4-backed GIF）は全体を main の Buffer にせず、ディスクから応答へ直接流す。
      // Range にも応じることで <video> の小さな probe が巨大な取込ファイル全体を読まない。
      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
      // 検査からストリーム開始までに差し替えられても、アニメーション原本の厳しい予算を越えない。
      if (inspectedOriginal && stat.size > MAX_ANIMATED_THUMBNAIL_BYTES) return new Response('Thumbnail unavailable', { status: 422, headers: assetSecurityHeaders() });
      const range = parseAssetByteRange(request.headers.get('range'), stat.size);
      const headers: Record<string, string> = {
        ...assetSecurityHeaders(),
        'content-type': mimeForFile(name),
        'cache-control': 'public, max-age=31536000, immutable',
        'accept-ranges': 'bytes',
      };
      if (range === 'unsatisfiable') {
        headers['content-range'] = `bytes */${stat.size}`;
        return new Response(null, { status: 416, headers });
      }

      const start = range?.start ?? 0;
      const end = range?.end ?? stat.size - 1;
      headers['content-length'] = String(Math.max(0, end - start + 1));
      if (range) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      const body = request.method === 'HEAD' || stat.size === 0 ? null : (Readable.toWeb(fs.createReadStream(resolved, { start, end })) as ReadableStream);
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

export { mimeForFile, registerImageProtocol };
