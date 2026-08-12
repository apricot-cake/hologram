'use strict';

// app:// のスキームのアドレスと、その裏のファイルのゲート（#7）＝ビルド済みのレンダラーを配ること
// のうち、Electron を必要としない部分の全部。だから外へ抜ける事例を、Electron を起こさずに単体
// テストできる。これを使うハンドラは app-protocol.ts。library-files.ts が asset:// のハンドラに
// 対して既に持っているのと同じ分け方。

import path from 'node:path';

const APP_SCHEME = 'app';
/** ホストは1つ。`app://それ以外/…` はこちらのものではない。 */
const APP_HOST = 'bundle';
/** レンダラー自身の入口。 */
const APP_INDEX_PATH = '/index.html';
const APP_INDEX_URL = `${APP_SCHEME}://${APP_HOST}${APP_INDEX_PATH}`;
/** ピン留め（浮かぶミニビューア）のウィンドウの入口（#79）＝このスキームの上の2つ目の文書で、
 * それは意図してのこと。レンダラーのビルド出力と preload を共有しつつ、AppShell を載せずに
 * 自分のシェル無しの UI を描く。 */
const APP_PIN_PATH = '/pin.html';
const APP_PIN_URL = `${APP_SCHEME}://${APP_HOST}${APP_PIN_PATH}`;
/** このスキームが作ってよい最上位の文書の全部（asset:// のラスタのみの規則は、
 * 自分の別の許可リストを持つ＝isViewerImageName）。 */
const APP_ENTRY_PATHS: readonly string[] = [APP_INDEX_PATH, APP_PIN_PATH];

// ビルドの生成物だけ。意図して asset:// の MIME の表（lib-thumbnails.ts）とは別にしてある。
// あちらはライブラリのメディアを配り、こちらはコンパイル済みのバンドルを配る。共有すると、
// 片側の必要がもう片側を黙って広げてしまう。一覧に無い拡張子には、推測ではなく型を一切与えない＝
// すべての応答に nosniff が付いているので、その場合は誰も意図しなかったものとして解釈されるので
// はなく、読み込みに失敗する。
const BUNDLE_MIME: Record<string, string> = {
  '.html': 'text/html',
  // モジュールのスクリプトは厳密な MIME の検査を受ける。JavaScript の型以外だと、レンダラーが
  // 丸ごと起動を拒む。
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function mimeForBundleFile(name: string): string | null {
  return BUNDLE_MIME[path.extname(name || '').toLowerCase()] || null;
}

// URL のパス → `root` の厳密に内側の絶対パス、または null。
//
// Chromium はリクエストがハンドラへ届く前に `..` を正規化する（app:// は標準のスキームなので、
// http と同じように解析される）。だからこそ確認をそこで止められない。パーセントエンコードされた
// 区間はその正規化を生き延び、decodeURIComponent の後、ここで初めて `..` になる。
function resolveInRenderer(root: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null; // パーセントエンコードが壊れている
  }
  rel = rel.replace(/^\/+/, '');
  if (!rel) return null;
  // ドライブレターや UNC・絶対パスがあると、path.resolve が root を無視してしまう。
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const resolved = path.resolve(root, rel);
  const inside = path.relative(root, resolved);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return resolved;
}

/** レンダラーの入口。ウィンドウが渡す起動時のクエリを載せる。 */
function appIndexUrl(query: Record<string, string>): string {
  const u = new URL(APP_INDEX_URL);
  u.search = new URLSearchParams(query).toString();
  return u.href;
}

/** ピン留めのウィンドウの入口（#79）。appIndexUrl と同じ形で起動時のクエリを載せる。 */
function pinIndexUrl(query: Record<string, string>): string {
  const u = new URL(APP_PIN_URL);
  u.search = new URLSearchParams(query).toString();
  return u.href;
}

/** このスキーム自身の入口の文書のどちらかなら true（クエリとハッシュは見ない）。 */
function isAppRendererUrl(u: URL): boolean {
  return u.protocol === `${APP_SCHEME}:` && u.hostname === APP_HOST && APP_ENTRY_PATHS.includes(u.pathname);
}

export { APP_HOST, APP_INDEX_PATH, APP_INDEX_URL, APP_PIN_PATH, APP_PIN_URL, APP_SCHEME, appIndexUrl, isAppRendererUrl, mimeForBundleFile, pinIndexUrl, resolveInRenderer };
