'use strict';

// レンダラーのドキュメントの Content-Security-Policy（#7。#683 が開けたまま
// 残さざるを得なかったものを仕上げる）。文字列だけ——実際にこれを届けるのは
// app-protocol.ts で、ここに electron の import を持ち込まないことが、この
// ポリシー自体を素の Node で単体テストできる（app/src/main/renderer-csp.test.ts）
// ようにしている。
//
// 以前は src/renderer/index.html の中の <meta http-equiv> に住んでいた。2つの
// ディレクティブはその方法ではまったく届けられない——frame-ancestors と
// sandbox は <meta> の中では無視される（CSP 仕様 / MDN）——そして本番ビルドは
// file:// のドキュメントで、そこでは Electron 自身のセキュリティチェックリストが
// HTTP ヘッダーによる配信は「不可能」だと言っている（electron/electron#23485）。
// だから #683 は測れる範囲のポリシーを測り、frame-ancestors は経路が無いために
// 外した。
//
// 今はレンダラーが protocol.handle('app') によって配信され、これは本物の
// Response を返す: ポリシーは応答ヘッダーに乗る。asset:// の応答が既にそう
// しているのとまったく同じ（#215。そこでは外すとビーコンが漏れることが計測
// 済み）。<meta> はもう無い——パッケージ済みレンダラーと開発サーバーの両方に
// 対して、1箇所に1つのコピーだけ。
//
// 各ディレクティブの役割:
//   default-src 'self'   — 下に名指ししていないものはすべて app://bundle から
//     来る。
//   connect-src 'self' data: — このアプリにネットワーククライアントは無い。
//     data: はバンドルされたソースが取得するもの（インライン化されたアセット）。
//     asset: は意図して「無い」: ライブラリは IPC 経由でのみ届き、レンダラーが
//     直接読めるバイト列としては決して届かない（asset:// は
//     corsEnabled も持たないので、これは同じ扉に掛かる2つ目の鍵であって、
//     唯一の鍵ではない）。
//   img-src / media-src  — ライブラリの画像と動画は asset:// スキームからサブ
//     リソースとして実際に読み込まれ、加えてレンダラー自身が組み立てるものの
//     ための blob:/data:（うごイラのフレームは IPC でバイト列として届く）。
//   style-src 'unsafe-inline' — React の style={{…}} プロパティに必要。これは
//     DOM の style 属性を書く（パネルの幅、ドラッグのオフセット、トースト）。
//     #683 で外して計測済み。nonce／hash による書き換えは範囲外。
//   frame-ancestors 'none' — ここで新たに加わったもので、このモジュールが
//     存在する理由の半分: レンダラーは preload のブリッジを持つので、何も
//     それを埋め込んではいけない。

function rendererCsp(nonce?: string): string {
  return [
    "default-src 'self'",
    "connect-src 'self' data:",
    "img-src 'self' asset: data: blob:",
    "media-src 'self' asset: blob:",
    "style-src 'self' 'unsafe-inline'",
    nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** パッケージ済みレンダラーが実際に動く条件。 */
const RENDERER_CSP = rendererCsp();

// 開発時だけ共有できない、唯一のディレクティブ。`@vitejs/plugin-react` は Fast
// Refresh の前置コードをインラインのモジュールスクリプトとして注入し、Vite も
// 自前のインラインスクリプトを注入する。`script-src 'self'` の下では Chromium が
// それらを落とし、レンダラーは何もマウントする前に
// "@vitejs/plugin-react can't detect preamble" を投げる（2026-08-02 に計測済み——
// 違反は script-src-elem の1件のみ、他は無し）。
//
// この修正は Vite 自身がこれに用意した答え: `html.cspNonce` は Vite が出す
// すべてのタグに nonce を付ける（vite/dist/node の
// injectNonceAttributeTagHook）ので、その nonce をここで名指しすることで、
// Vite のツール類だけを許可する。このアプリ自身が書いたインラインスクリプトは、
// 開発時も本番とまったく同じように失敗し続ける。これこそが共有ポリシーの
// 存在理由——`'unsafe-inline'` は同じ症状を消すためにそれを投げ捨てて
// しまっていただろう。固定の文字列で構わないのは、これが開発機から出ることは
// 一切無いから——上のパッケージ済みポリシーには nonce が一切無い。
// electron.vite.config.ts はこの定数を読むので、両者がずれることはない。
const DEV_CSP_NONCE = 'hologram-dev';
const DEV_RENDERER_CSP = rendererCsp(DEV_CSP_NONCE);

/** すべての app:// 応答が持つヘッダー: 上のポリシーに加え nosniff。 */
function rendererSecurityHeaders(): Record<string, string> {
  return { 'content-security-policy': RENDERER_CSP, 'x-content-type-options': 'nosniff' };
}

export { DEV_CSP_NONCE, DEV_RENDERER_CSP, RENDERER_CSP, rendererSecurityHeaders };
