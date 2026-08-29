'use strict';

// asset:// のスキームと、その裏にあるサムネイルのキャッシュ（#227）＝index.ts の
// `// --- 画像のプロトコル ---` の塊を丸ごと移したもの。1つのモジュールにしてあるのは、
// キャッシュがこのハンドラのためだけに在るから。サムネイルを作るのは `?w=N` だけだし、縮小
// しない応答が自分を何だと言うかを決めるのは MIME の表だけ。
//
// 保存先フォルダの内包の確認はここに無い。resolveInFolder は index.ts のほかのファイルの補助と
// 一緒に残る（あれはすべてのファイルハンドラが共有する規則であって、このハンドラ固有のものでは
// ない）ので、registerImageProtocol はそれを取りに戻らず依存として受け取る。

import { protocol, nativeImage, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { configDir } from './native-host.ts';
import { getSaveFolder } from './lib-config.ts';
import { assetSecurityHeaders } from './asset-headers.ts';
import { sharedJobPool } from './lib-job-pool.ts';

/** registerImageProtocol が組み立ての側から必要とするもの。 */
export interface ImageProtocolDeps {
  /** 名前を保存先フォルダの中で解決する。外へ出てしまうなら null。 */
  resolveInFolder(name: string): string | null;
}

// スクリーンショットは JPEG。ダウンロードした元のメディアは png/webp/gif のこともある。
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
// 代わりに asset://…?w=N で縮小済みの JPEG を配る。生成は Electron 内蔵の nativeImage で1回だけ
// 行い、ディスクにキャッシュする（キーは 名前＋mtime＋幅 なので、移行し直せば無効になる）。
// ?w= が付かないときは今も原寸の元画像を配る（ライトボックス・ビューア）。
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif', '.svg']);
// #8: nativeImage が文書化しているのは PNG/JPEG（Windows では +ICO）だけ＝webp/avif は空の画像
// として復号され、以前はそこから縮小しない元画像へ抜けていた（registerImageProtocol の「抜ける」
// のコメントを参照）。この2つは代わりに下の getDelegatedThumbnail へ回す。ほかの THUMB_EXT の
// エントリは nativeImage の経路のまま変わらない。
const DELEGATED_DECODE_EXT = new Set(['.webp', '.avif']);
// thumb-cache は保存先フォルダではなく configDir にある。hologram.db がそうするのと同じ
//「ローカルで、ライブラリと一緒に持ち運べない」という理由（index.ts の投稿のコメント）。
function thumbCacheDir() {
  return path.join(configDir(), 'thumb-cache');
}

// nativeImage の復号・縮小・toJPEG は同期で、メインプロセスの唯一の JS スレッドで走る。タイルの
// グリッドは、キャッシュの無いセルへ初めてスクロールした時に asset?w= のリクエストを一度に大量に
// 投げる。制限しないとそれらが立て続けに、1つの長い同期の塊として実行され、ほかのあらゆる IPC・
// UI のメッセージを飢えさせる（最初のスクロールの引っかかり）。重い生成は、ジョブの間でイベント
// ループへ譲る（setImmediate）小さなプールへ集約してメインスレッドが息を続けられるようにし、
// 同時に来た同一のリクエストは束ねて、各タイルの復号を高々1回にする。
//
// プールは lib-job-pool.ts にあり、同時に最大2本まで入り、ジョブの間に setImmediate の譲りが
// 入る。
const _thumbInflight = new Map(); // cachePath → Promise<Buffer|null>
// 昔の専用プールは、ジョブが例外を投げると null で解決していた。共有のプールは拒否する（索引の
// ジョブは「何も作らなかった」と「投げた」を区別しなければならない）。ここでは昔の取り決めへ
// 戻す。ここでの「サムネイルは無い」は正当な答えで、呼び出し元は元画像へ抜けることで既に
// 対応している。
function runThumbJob(fn) {
  return sharedJobPool.run(fn).catch(() => null);
}

// #8: nativeImage が読めない形式のための、レンダラーへ委譲した復号。OS に入っているコーデックに
// 頼る（Issue の設計コメントいわく、avif は大半のマシンで使えない）のでも、新しい wasm・
// ネイティブの依存を足す（同じコメントで却下された wasm-vips）のでもなく、隠しの
// BrowserWindow が Chromium 自身に復号を頼み＝アプリのほかの場所で <img> タグに描いているのと
// 同じエンジン＝平坦化した JPEG を返す。
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

// 短い辺を基準に縮小する。getThumbnail の nativeImage の分岐が使うのと同じ規則（下の q3 の
// コメント）＝正方形のタイル＋object-fit:cover では短い辺がタイルに対応するので、`w` を超えては
// いけないのはその辺。
function delegatedDecodeScript(b64: string, w: number): string {
  return `(async () => {
    try {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const shortEdge = Math.min(bitmap.width, bitmap.height);
      const scale = shortEdge > ${w} ? ${w} / shortEdge : 1;
      const dw = Math.max(1, Math.round(bitmap.width * scale));
      const dh = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(dw, dh);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, dw, dh);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
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

async function getDelegatedThumbnail(resolved: string, w: number): Promise<Buffer | null> {
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(resolved);
  } catch {
    return null;
  }
  try {
    const win = await getDecodeWindow();
    const dataUrl = await win.webContents.executeJavaScript(delegatedDecodeScript(bytes.toString('base64'), w));
    scheduleDecodeWinDispose();
    if (typeof dataUrl !== 'string') return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch {
    scheduleDecodeWinDispose();
    return null; // 復号に失敗した（壊れたファイル、非対応の派生）＝呼び出し元は元画像を代わりに使う
  }
}

// #236 §4: 収蔵品（assetClass:'file'＝pdf/zip/psd/…）には THUMB_EXT の復号の経路が
// 無いが、その OS には既にサムネイルのハンドラが登録されている見込みが高い（エクスプローラや
// Finder が出している）。nativeImage.createThumbnailFromPath が頼むのはまさにそれで＝
// Electron 43、win32/darwin＝だから、#236 より前に返していた素の「サムネイルは無い」という
// null の代わりに、getThumbnail が試す2つ目の経路になる。Windows は requestedSize.height を
// 無視して幅から導出する（型自身のドキュメント注記）。{width:w, height:w} を渡すのは今も正しい
// 呼び方で、ただし結果の縦横比についての約束ではない。
async function getOsShellThumbnail(resolved: string, w: number): Promise<Buffer | null> {
  try {
    const img = await nativeImage.createThumbnailFromPath(resolved, { width: w, height: w });
    if (img.isEmpty()) return null;
    return img.toJPEG(90);
  } catch {
    return null; // この OS にはこの形式のハンドラが登録されていない＝エラーではない
  }
}

async function getThumbnail(resolved, name, w) {
  const ext = path.extname(name).toLowerCase();
  const isImageExt = THUMB_EXT.has(ext);
  const isDelegated = DELEGATED_DECODE_EXT.has(ext);
  let st: any;
  try {
    st = await fs.promises.stat(resolved);
  } catch {
    return null;
  }
  // q3: 幅ではなく短い辺で縮小する。タイルは正方形＋object-fit:cover なので、タイルに対応する
  // のは短い辺。幅で縮小すると横長の画像（1920x1080 など）が 180x101 になり、それが正方形の
  // タイルへ縦に引き伸ばされて → ひどくぼやけた。
  // q4（#8）: 世代を上げた＝webp/avif は q3 の下でゼロバイトの否定の番兵をキャッシュして
  // いた（nativeImage がどちらも復号できなかった）。そのままだと、下の委譲する復号器が実際に
  // サムネイルを作れるようになった後も、いつまでも「サムネイルは無い」と答え続けてしまう。
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q4.jpg`.replace(/[^\w.-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try {
    const cached = await fs.promises.readFile(cachePath);
    // キャッシュされた否定の結果（#236。#8 で委譲する復号の経路へも広げた）。この
    // 名前＋mtime＋幅 の組で生成は既に1回試され、何も作れなかった＝空のファイルがその番兵。
    // だから、いつまでもサムネイルが付かないカードが、スクロールで戻るたびに OS のシェル
    // 呼び出しや隠しウィンドウの復号を引き直すことはない。素の nativeImage の経路では意味を
    // 持たない＝本物の画像のサムネイルがゼロバイトになることはない。
    return cached.length ? cached : null;
  } catch {
    /* キャッシュに無い */
  }
  // 束ねる。このタイルがちょうど今生成中なら、重複した復号を始めずにそのジョブを待つ
  // （グリッドの作り直しは、最初の復号が飛行中のまま、まだ見えているタイルを要求し直す）。
  const pending = _thumbInflight.get(cachePath);
  if (pending) return pending;
  const job = runThumbJob(async () => {
    let buf: Buffer | null = null;
    if (isDelegated) {
      // #8: nativeImage は webp/avif を復号できない＝Chromium 自身は、隠しのレンダラー
      // ウィンドウを介してできる（上の getDelegatedThumbnail）。
      buf = await getDelegatedThumbnail(resolved, w);
    } else if (isImageExt) {
      let img = nativeImage.createFromPath(resolved);
      if (!img.isEmpty()) {
        const sz = img.getSize();
        if (Math.min(sz.width, sz.height) > w) {
          img = sz.width >= sz.height ? img.resize({ height: w, quality: 'good' }) : img.resize({ width: w, quality: 'good' });
        }
        buf = img.toJPEG(90);
      }
    } else {
      // #236: このハンドラが自分で復号する形式ではない＝OS に登録されたサムネイルのハンドラ
      // へ頼む（.psd/.pdf/.zip/… が「どう見えるか」についての、エクスプローラや Finder 自身の
      // 正本）。
      buf = await getOsShellThumbnail(resolved, w);
    }
    await fs.promises.mkdir(thumbCacheDir(), { recursive: true }).catch(() => {
      /* キャッシュはできる範囲で */
    });
    // buf===null は書き込みを飛ばすのではなく、ゼロバイトの番兵としてキャッシュする（上の
    // 読み側のコメントを参照）＝そこが要点。
    await fs.promises.writeFile(cachePath, buf || Buffer.alloc(0)).catch(() => {
      /* キャッシュはできる範囲で */
    });
    return buf;
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
      if (Number.isFinite(w) && w >= 64 && w <= 720) {
        const thumb = await getThumbnail(resolved, name, w);
        // キャッシュのキーに mtime と幅が入っていて、キャプチャのファイル名は内容が安定して
        // いる（captureId は一意で、書き込みは1回きり）→ immutable にすると、Chromium は復号
        // 済みのビットマップを保持し、スクロールで戻ったときの読み直し・復号し直しを省ける。
        if (thumb) return new Response(thumb, { headers: { ...assetSecurityHeaders(), 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
        // サムネイルの生成に失敗したら元画像へ抜ける
      }

      const data = await fs.promises.readFile(resolved);
      return new Response(data, { headers: { ...assetSecurityHeaders(), 'content-type': mimeForFile(name), 'cache-control': 'public, max-age=31536000, immutable' } });
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

export { mimeForFile, registerImageProtocol };
