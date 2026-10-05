'use strict';

// asset:// のすべての応答が持つセキュリティヘッダー（#215）。
//
// asset:// は `standard: true, secure: true, supportFetchAPI: true` で登録
// されているので、asset://img/* はライブラリ全体を保持する「1つの」オリジンに
// なる。そこから配信されるドキュメントは、同一オリジンの fetch で他のあらゆる
// ライブラリファイルを読める。ビューアウィンドウの `sandbox: true` は助けに
// ならない: それが落とすのは Node/IPC であって、ページのスクリプトではない。
// 応答にポリシーが無ければ、トップレベルのドキュメントとして開かれたスクリプト
// 付き SVG は、持ち出しの両方の半分——ライブラリを読み、それを POST で
// 送り出す——を揃えてしまっていた。
//
// だから応答自体がポリシーを持つ。これにより、誰がそのドキュメントを開いたかとは
// 無関係になる: 後から配線される呼び出し元も自動的にそれを引き継ぐ。サブ
// リソースの読み込み（<img>、CSS の背景、<video>）は影響を受けない——応答の
// CSP が縛るのは「その応答から作られたドキュメント」であって、それを埋め込む
// ドキュメントではない。
//
// 許可しているのは、正当な画像がそれ自身「ドキュメントである」時にまだ必要な
// もの: 自分自身を画像として、インラインの表示用 CSS（SVG は <style> を
// 持つ）、埋め込みグリフ／ビットマップ用の data:。それ以外——script、fetch/
// XHR、frame、フォームの POST——はすべて `default-src 'none'` に落ちる。
const ASSET_CSP = ["default-src 'none'", "img-src 'self' data: blob:", "media-src 'self' blob:", "style-src 'unsafe-inline'", 'font-src data:', "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');

// nosniff は script/style の MIME 不一致を拒否する。画像の復号は防がないため、
// lib-thumbnails が内容を分類し、共通画像境界を通してから配信する。
export function assetSecurityHeaders(): Record<string, string> {
  return { 'content-security-policy': ASSET_CSP, 'x-content-type-options': 'nosniff' };
}
