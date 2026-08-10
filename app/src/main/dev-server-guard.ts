'use strict';

// 「主ウィンドウがどのレンダラーを読み込むか」の番人。これは信頼境界: あの
// ウィンドウの preload は window.hologram を公開し（全消去、インポート、保存
// フォルダの移動）、読み込んだページが何であれ、その破壊的な IPC を引き継ぐ。
// electron-vite は開発サーバーのアドレスを ELECTRON_RENDERER_URL という普通の
// 環境変数経由でメインプロセスへ渡していて、これを無条件に信頼するビルドは、
// アプリの環境変数を設定できる者なら誰でも、そのブリッジを自分が支配する
// ページへ向けられてしまう（#381。この Issue は electron-vite への移行より
// 前からあり、当時はこの変数を HOLOGRAM_DEV_SERVER と呼んでいた。今のこれが
// それを置き換えた）。
//
// Electron はまさにこの dev/dist の切り分けのために app.isPackaged を公開して
// いて、そのセキュリティ指針は、信頼できない web コンテンツに Electron の
// API を渡さないこと:
//   https://www.electronjs.org/docs/latest/api/app#appispackaged-readonly
//   https://www.electronjs.org/docs/latest/tutorial/security
//
// なので: この変数を読むのはパッケージ化されていないビルドだけであり、それでも
// http: の loopback アドレスだけが通る。それ以外はすべて null に解決され、
// 呼び出し元はバンドル済みのレンダラーを読み込む——安全側に倒れる、決して
// 別の外部 URL へフォールバックはしない。この境界を Electron 無しで回帰
// テストできるよう、純粋関数にしてある。

// 拒否理由。呼び出し元のログ行のため——アドレスを打ち間違えた開発者は、古い
// ビルドを黙ってデバッグする羽目になるのではなく、なぜページがバンドルから
// 来たのか分かるべき。
type DevServerRejection =
  | 'packaged' // 配布用ビルド: この変数は一切読まない
  | 'unset' // 通常の本番経路、および開発時の `electron-vite build`
  | 'malformed' // URL になっていない
  | 'not-http' // https:/file:/data:/…——開発サーバーは http で話す
  | 'has-credentials' // user:pass@——細工された URL だけが持つ形
  | 'not-loopback'; // 実際の攻撃: この機器の外にあるアドレス

type DevServerResolution = { url: string; rejected: null } | { url: null; rejected: DevServerRejection };

// Vite の開発サーバーがバインドするホスト。WHATWG の URL は調べる前にホストを
// 正規化する（http://127.1 と http://0x7f.0.0.1 はどちらも 127.0.0.1 に正規化され、
// IPv6 は角括弧付きのまま）ので、loopback の省略記法もマッチする。127.0.0.0/8 の
// それ以外は意図して受け付けない: このリポジトリの何もそこにバインドしないし、
// この狭い集合こそがこの番人の存在意義そのもの。
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// 読み込むべきレンダラー開発サーバーの URL を解決する。バンドル済みレンダラーを
// 読み込むべきなら null。
//   rawUrl     — process.env.ELECTRON_RENDERER_URL、未検証
//   isPackaged — app.isPackaged（純粋に保つため import せず引数で渡す）
function resolveDevServerUrl(rawUrl: string | undefined | null, isPackaged: boolean): DevServerResolution {
  if (isPackaged) return { url: null, rejected: 'packaged' };
  if (!rawUrl) return { url: null, rejected: 'unset' };
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { url: null, rejected: 'malformed' };
  }
  if (u.protocol !== 'http:') return { url: null, rejected: 'not-http' };
  if (u.username !== '' || u.password !== '') return { url: null, rejected: 'has-credentials' };
  if (!LOOPBACK_HOSTS.has(u.hostname)) return { url: null, rejected: 'not-loopback' };
  // 正規化された形を返す。呼び出し元がナビゲーションガードで行うオリジンの
  // 比較と、実際に読み込む URL が、同じパース結果から導出されるように。
  return { url: u.href, rejected: null };
}

export { resolveDevServerUrl };
export type { DevServerRejection, DevServerResolution };
