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

// nosniff は宣言された content-type を固定する。mimeForFile は拡張子から型を
// 導出するので、これが無いと、バイト列がファイル名と食い違うライブラリ
// ファイルが、こちらが選んだ型とは違う（能動的な）型としてスニフされかねない。
export function assetSecurityHeaders(): Record<string, string> {
  return { 'content-security-policy': ASSET_CSP, 'x-content-type-options': 'nosniff' };
}
